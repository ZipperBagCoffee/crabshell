'use strict';

const path = require('path');
const fs = require('fs');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { readStdin, normalizePath } = require('./transcript-utils');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');
const { STORAGE_ROOT } = require('./constants');
const { isGitCommit, commandObservation, projectFingerprint, checkKeyForCommand, declaredCommands, hasCheckConfiguration, isSourceFile, isRequiredCheck } = require('./core/command-observation');
const { startCheck, recordCheck, currentCheck } = require('./core/check-history');
const { withStateLock } = require('./core/state-lock');

// --- Constants ---
const STATE_FILE = 'verification-state.json';

// The working tree is shared by every session in the project, so this state is
// tree-scoped: any session's source edit arms the commit gate and only a passing
// declared check on the current source content disarms it. A session id is kept
// only to scope suspension after an interrupt.
const DEFAULT_STATE = {
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

function isSuspended(state, sessionId) {
  if (!sessionId) return false;
  return state.suspendedSessionId === sessionId || (state.suspendedSessions || []).includes(sessionId);
}

// --- Mode: record (PostToolUse) ---

function handleRecord(hookData, projectDir, options = {}) {
  const toolName = hookData.tool_name;
  const input = hookData.tool_input || {};

  const state = loadState(projectDir);
  if (isSuspended(state, hookData.session_id)) return 0;
  const eventTurn = hookData.turn_id || hookData.prompt_id;
  if (eventTurn && state.interruptedTurns?.includes(JSON.stringify([hookData.session_id, eventTurn]))) return 0;
  delete state.sessionId; // legacy single-owner field; the state is tree-scoped

  const editedPaths = ['Edit', 'Write'].includes(toolName) && input.file_path ? [input.file_path]
    : toolName === 'apply_patch' && typeof input.command === 'string'
      ? [...input.command.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(match => match[1].trim()) : [];
  if (editedPaths.length > 0) {
    const relevant = editedPaths.filter(file => {
      const relative = path.isAbsolute(file) ? path.relative(projectDir, file) : file;
      return !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && isSourceFile(relative);
    });
    // Non-source edits (docs, config, styles) leave the gate as it is.
    if (relevant.length === 0) return 0;
    if (state.state === 'TESTED' && state.lastTestFingerprint === (options.getFingerprint ? options.getFingerprint() : projectFingerprint(projectDir))) {
      return 0;
    }
    state.state = 'EDITED';
    for (const file of relevant) {
      const normalized = normalizePath(file);
      if (!state.editsSinceTest.includes(normalized)) state.editsSinceTest.push(normalized);
      process.stderr.write(`[VERIFICATION_SEQ] Recorded source edit: ${normalized}\n`);
    }
    saveState(projectDir, state);
    return 0;
  }

  if (toolName === 'Bash' && input.command) {
    const observation = Object.hasOwn(options, 'observation') ? options.observation : commandObservation(hookData, projectDir, options);
    if (!observation) return 0;
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
    } else if (current.required === false) {
      // One manifest entry passing proves that entry, not the change: the gate
      // waits for the project's own check (manifest tools or package.json "test").
      process.stderr.write(`[VERIFICATION_SEQ] Passing single manifest entry recorded; the commit gate needs a manifest tools command or package.json test\n`);
    } else {
      state.state = 'TESTED';
      state.editsSinceTest = [];
      state.lastTestTs = new Date().toISOString();
      state.lastTestFingerprint = current.sourceFingerprint;
      process.stderr.write(`[VERIFICATION_SEQ] Recorded passing test execution, state → TESTED\n`);
    }
    saveState(projectDir, state);
  }

  // Reads and other tools change nothing, so nothing is written.
  return 0;
}

// --- Mode: gate (PreToolUse) ---

function handleGate(hookData, projectDir) {
  const toolName = hookData.tool_name;
  const input = hookData.tool_input || {};

  const state = loadState(projectDir);

  if (toolName === 'Bash' && input.command) {
    const key = checkKeyForCommand(input.command, projectDir, input.workdir || hookData.cwd || projectDir);
    if (!isSuspended(state, hookData.session_id) && startCheck(state, hookData, key)) {
      // Starting a single manifest entry does not re-lock a verified tree.
      if (isRequiredCheck(input.command, projectDir, input.workdir || hookData.cwd || projectDir)) state.state = 'EDITED';
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
      if (!hasCheckConfiguration(projectDir)) {
        // No manifest and no package.json test script: nothing can ever satisfy
        // the gate, so it advises instead of blocking.
        return {
          exitCode: 0,
          notice: `Unverified source edits [${files}] are being committed, but this project declares no check command. Run /verifying to declare one so commits wait for a passing check.`,
        };
      }
      if (declaredCommands(projectDir).length === 0) {
        return { exitCode: 2, reason: `Git commit blocked: the project's check configuration declares no runnable single command (unreadable manifest, or only compound shell commands). Edited files: [${files}]. Fix .crabshell/verification/manifest.json or package.json "test", run it, then commit.` };
      }
      if (!declaredCommands(projectDir).some(declaration => declaration.source !== 'entry')) {
        // Single manifest entries never unlock a commit, so without a full check
        // this block could never clear: say what to declare.
        return { exitCode: 2, reason: `Git commit blocked: the project declares no full check, and single manifest entries do not unlock commits. Edited files: [${files}]. Declare a full check as tools.test in .crabshell/verification/manifest.json ("tools": { "test": "node .crabshell/verification/run-verify.js" }) or as a package.json "test" script, run it, then commit.` };
      }
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

// An interrupt invalidates the interrupted session's own running and recorded
// checks and suspends its recording; another session's passing check on the
// shared tree stays valid. Without a session id, every check is invalidated.
function interruptVerification(projectDir, payload) {
  if (!fs.existsSync(getStatePath(projectDir))) return;
  return withStateLock(getStatePath(projectDir), () => {
    const state = loadState(projectDir);
    const sessionId = payload.session_id || null;
    const ownedByInterrupted = identity => {
      if (!sessionId) return true;
      try { return JSON.parse(identity)[0] === sessionId; } catch { return true; }
    };
    if (sessionId) {
      state.suspendedSessions = [...new Set([...(state.suspendedSessions || []), sessionId])].slice(-16);
      state.suspendedSessionId = sessionId;
    }
    const eventTurn = payload.turn_id || payload.prompt_id;
    if (eventTurn) state.interruptedTurns = [...new Set([...(state.interruptedTurns || []), JSON.stringify([payload.session_id,eventTurn])])].slice(-16);
    if (state.checkHistory) {
      for (const id of Object.keys(state.checkHistory.pending || {})) if (ownedByInterrupted(id)) delete state.checkHistory.pending[id];
      for (const [key, result] of Object.entries(state.checkHistory.results || {})) if (ownedByInterrupted(result.identity)) delete state.checkHistory.results[key];
      state.checkHistory.trackedStarts = true;
    }
    const remaining = state.checkHistory ? currentCheck(state) : null;
    if (remaining?.passed && remaining.sourceFingerprint && remaining.required !== false) {
      state.state = 'TESTED';
      state.lastTestFingerprint = remaining.sourceFingerprint;
    } else {
      state.state = 'EDITED';
      state.lastTestFingerprint = null;
    }
    saveState(projectDir, state);
  });
}

function resumeVerification(projectDir, payload) {
  if (!fs.existsSync(getStatePath(projectDir))) return;
  return withStateLock(getStatePath(projectDir), () => {
    const state = loadState(projectDir);
    if (!isSuspended(state, payload.session_id)) return;
    state.suspendedSessions = (state.suspendedSessions || []).filter(id => id !== payload.session_id);
    if (state.suspendedSessionId === payload.session_id) delete state.suspendedSessionId;
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
  if (result.notice) {
    // PreToolUse context reaches the model only inside hookSpecificOutput.
    process.stderr.write(`[VERIFICATION_SEQ] ${result.notice}\n`);
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `[CRABSHELL] ${result.notice}` } }));
  }
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
