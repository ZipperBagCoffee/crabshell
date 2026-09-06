'use strict';

const path = require('path');
const fs = require('fs');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { readStdin, normalizePath } = require('./transcript-utils');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');
const { STORAGE_ROOT } = require('./constants');
const { isGitCommit, commandObservation, projectFingerprint, checkKeyForCommand } = require('./core/command-observation');
const { startCheck, recordCheck, currentCheck } = require('./core/check-history');
const { withStateLock } = require('./core/state-lock');

// --- Constants ---
const STATE_FILE = 'verification-state.json';
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

const EXCLUDED_DIRS = ['.crabshell/', '.claude/', 'node_modules/', '.git/', 'dist/', 'build/'];
const EXCLUDED_EXTENSIONS = [
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.lock', '.png', '.jpg', '.svg', '.env'
];
const CODE_EXTENSIONS = [
  '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go', '.rs',
  '.java', '.c', '.cpp', '.h', '.lua', '.php', '.sh'
];

const DEFAULT_STATE = {
  sessionId: null,
  lastUpdated: null,
  state: 'CLEAN',
  editsSinceTest: [],
  lastTestTs: null
};

// --- Helpers ---

function getStatePath(projectDir) {
  return path.join(projectDir, STORAGE_ROOT, 'memory', STATE_FILE);
}

function loadState(projectDir) {
  const statePath = getStatePath(projectDir);
  return readJsonOrDefault(statePath, { ...DEFAULT_STATE });
}

function saveState(projectDir, state) {
  state.lastUpdated = new Date().toISOString();
  const statePath = getStatePath(projectDir);
  writeJson(statePath, state);
}

/**
 * Check if a path is a source file (code that should require test verification).
 */
function isSourceFile(filePath) {
  if (!filePath) return false;
  const normalized = normalizePath(filePath).toLowerCase();

  // Exclude known non-source directories
  for (const dir of EXCLUDED_DIRS) {
    if (normalized.includes(dir)) return false;
  }

  // Get extension
  const ext = path.extname(normalized);
  if (!ext) return false; // No extension → not a source file (conservative: false for extensionless)

  // Exclude known non-code extensions
  if (EXCLUDED_EXTENSIONS.includes(ext)) return false;

  // Include known code extensions
  if (CODE_EXTENSIONS.includes(ext)) return true;

  // Unknown extension → conservative: treat as source
  return true;
}

/**
 * Handle session isolation: reset state if session changed and state is old.
 */
function handleSessionIsolation(state, sessionId) {
  if (!sessionId) return state;
  if (state.sessionId && state.sessionId !== sessionId) {
    const lastUpdated = state.lastUpdated ? new Date(state.lastUpdated).getTime() : 0;
    const age = Date.now() - lastUpdated;
    if (age > SESSION_TTL_MS) {
      // Old session, reset
      return { ...DEFAULT_STATE, sessionId };
    }
    // Recent — likely subagent, keep state but update sessionId
    state.sessionId = sessionId;
  } else if (!state.sessionId) {
    state.sessionId = sessionId;
  }
  return state;
}

// --- Mode: record (PostToolUse) ---

function handleRecord(hookData, projectDir, options = {}) {
  const toolName = hookData.tool_name;
  const input = hookData.tool_input || {};

  let state = loadState(projectDir);
  if (state.suspendedSessionId && state.suspendedSessionId === hookData.session_id) return 0;
  const eventTurn = hookData.turn_id || hookData.prompt_id;
  if (eventTurn && state.interruptedTurns?.includes(JSON.stringify([hookData.session_id, eventTurn]))) return 0;
  state = handleSessionIsolation(state, hookData.session_id);

  const editedPaths = ['Edit', 'Write'].includes(toolName) && input.file_path ? [input.file_path]
    : toolName === 'apply_patch' && typeof input.command === 'string'
      ? [...input.command.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(match => match[1].trim()) : [];
  if (editedPaths.length > 0) {
    const relevant = editedPaths.filter(file => {
      const relative = path.isAbsolute(file) ? path.relative(projectDir, file) : file;
      return !relative.startsWith('..' + path.sep) && isSourceFile(relative);
    });
    if (relevant.length > 0) {
      if (state.state === 'TESTED' && state.lastTestFingerprint === (options.getFingerprint ? options.getFingerprint() : projectFingerprint(projectDir))) {
        return 0;
      }
      state.state = 'EDITED';
      for (const file of relevant) {
        const normalized = normalizePath(file);
        if (!state.editsSinceTest.includes(normalized)) state.editsSinceTest.push(normalized);
        process.stderr.write(`[VERIFICATION_SEQ] Recorded source edit: ${normalized}\n`);
      }
    }
  } else if (toolName === 'Bash' && input.command) {
    const observation = Object.hasOwn(options, 'observation') ? options.observation : commandObservation(hookData, projectDir, options);
    if (observation) {
      const candidate = { ...observation, sourceFingerprint: observation.passed ? (options.getFingerprint ? options.getFingerprint() : projectFingerprint(projectDir)) : null };
      const merged = recordCheck(state, hookData, candidate);
      if (!merged.accepted) {
        saveState(projectDir, state);
        return 0;
      }
      const current = currentCheck(state);
      if (!current?.passed) {
        state.state = 'EDITED';
        state.lastTestFingerprint = null;
        process.stderr.write(`[VERIFICATION_SEQ] Latest required check failed, is running, or is undetermined; commit gate stays armed\n`);
      } else {
        state.state = 'TESTED';
        state.editsSinceTest = [];
        state.lastTestTs = new Date().toISOString();
        state.lastTestFingerprint = current.sourceFingerprint;
        process.stderr.write(`[VERIFICATION_SEQ] Recorded passing test execution, state → TESTED\n`);
      }
    }
  }

  saveState(projectDir, state);
  return 0;
}

// --- Mode: gate (PreToolUse) ---

function handleGate(hookData, projectDir) {
  const toolName = hookData.tool_name;
  const input = hookData.tool_input || {};

  let state = loadState(projectDir);
  state = handleSessionIsolation(state, hookData.session_id);

  if (toolName === 'Bash' && input.command) {
    const key = checkKeyForCommand(input.command, projectDir, input.workdir || hookData.cwd || projectDir);
    if (!state.suspendedSessionId && startCheck(state, hookData, key)) {
      state.state = 'EDITED';
      saveState(projectDir, state);
    }
  }

  // Gate: git commit without test
  if (toolName === 'Bash' && input.command && isGitCommit(input.command)) {
    if (state.state === 'TESTED' && (!state.lastTestFingerprint || state.lastTestFingerprint !== projectFingerprint(projectDir))) {
      state.state = 'EDITED';
      saveState(projectDir, state);
    }
    if (state.state === 'EDITED') {
      const files = state.editsSinceTest.join(', ');
      const output = {
        decision: 'block',
        reason: `Git commit blocked: current source has no passing required check. Edited files: [${files}]. Run the declared check and inspect its result before committing.`
      };
      return { exitCode: 2, reason: output.reason };
    }
  }

  // All other cases: allow
  return { exitCode: 0 };
}

function recordVerification(hookData, projectDir, options = {}) {
  if (hookData.is_interrupt === true || hookData.tool_response?.interrupted === true) {
    interruptVerification(projectDir, hookData);
    return 0;
  }
  return withStateLock(getStatePath(projectDir), () => handleRecord(hookData, projectDir, options));
}

function interruptVerification(projectDir, payload) {
  if (!fs.existsSync(getStatePath(projectDir))) return;
  return withStateLock(getStatePath(projectDir), () => {
    const state = loadState(projectDir);
    if (state.sessionId && payload.session_id && state.sessionId !== payload.session_id) return;
    state.state = 'EDITED';state.lastTestFingerprint = null;
    state.suspendedSessionId = payload.session_id;
    const eventTurn = payload.turn_id || payload.prompt_id;
    if (eventTurn) state.interruptedTurns = [...new Set([...(state.interruptedTurns || []), JSON.stringify([payload.session_id,eventTurn])])].slice(-16);
    if (state.checkHistory) {
      state.checkHistory.pending = {};
      state.checkHistory.results = {};
      state.checkHistory.trackedStarts = true;
    }
    saveState(projectDir, state);
  });
}

function resumeVerification(projectDir, payload) {
  if (!fs.existsSync(getStatePath(projectDir))) return;
  return withStateLock(getStatePath(projectDir), () => {
    const state = loadState(projectDir);
    if (!state.suspendedSessionId) return;
    if (state.suspendedSessionId !== payload.session_id) return;
    delete state.suspendedSessionId;
    saveState(projectDir, state);
  });
}

function gateVerification(hookData, projectDir) {
  const command = hookData.tool_input?.command;
  if (hookData.tool_name !== 'Bash' || (!isGitCommit(command)
      && !checkKeyForCommand(command, projectDir, hookData.tool_input?.workdir || hookData.cwd || projectDir))) {
    return { exitCode: 0 };
  }
  return withStateLock(getStatePath(projectDir), () => handleGate(hookData, projectDir));
}

// --- Main ---

async function main() {
  const mode = process.argv[2]; // 'record' or 'gate'
  if (!mode || (mode !== 'record' && mode !== 'gate')) {
    process.stderr.write('[VERIFICATION_SEQ] Unknown mode, exiting\n');
    process.exit(0);
    return;
  }

  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) {
    process.exit(0);
    return;
  }

  const projectDir = getProjectDir();

  if (mode === 'record') process.exit(recordVerification(hookData, projectDir));
  const result = gateVerification(hookData, projectDir);
  if (result.reason) {
    process.stderr.write(`[VERIFICATION_SEQ] ${result.reason}\n`);
    console.log(JSON.stringify({ decision: 'block', reason: result.reason }));
  }
  process.exit(result.exitCode);
}

if (require.main === module) main().catch(e => {
  process.stderr.write(`[VERIFICATION_SEQ ERROR] ${e.message}\n`);
  process.exit(0); // fail-open
});

module.exports = { recordVerification, gateVerification, interruptVerification, resumeVerification };
