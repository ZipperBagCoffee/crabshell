'use strict';

const path = require('path');
const { readStdin, normalizePath } = require('./transcript-utils');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');
const { STORAGE_ROOT } = require('./constants');

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
  editGrepCycleCount: 0,
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
 * Detect if a Bash command is a test execution.
 */
function isTestExecution(command) {
  if (!command || typeof command !== 'string') return false;
  const cmd = command.trim();

  // Reject trivial fake tests
  if (isTrivialTest(cmd)) return false;

  // Match common test runners
  const testPatterns = [
    /\bnpm\s+test\b/,
    /\bnpm\s+run\s+(test|check|verify|lint|build)\b/,
    /\bnpx\s+(jest|mocha|vitest)\b/,
    /\bpytest\b/,
    /\bcargo\s+test\b/,
    /\bgo\s+test\b/,
    /\bmake\s+test\b/,
    /\bnode\s+\S*\.test\.\S+/,
    /\bnode\s+\S*_test[_-]\S+/,
    /\btsc\b/,
    /\beslint\b/,
    /\bjest\b/,
    /\bmocha\b/,
    /\bvitest\b/,
  ];

  for (const pattern of testPatterns) {
    if (pattern.test(cmd)) return true;
  }

  return false;
}

/**
 * Reject trivial "tests" that are just echo/printf statements.
 */
function isTrivialTest(cmd) {
  // Very short commands without a test runner
  if (cmd.length < 15 && !/\b(test|jest|mocha|vitest|pytest|tsc|eslint|lint|build|check|verify)\b/i.test(cmd)) {
    return true;
  }
  // echo + pass/ok/success patterns
  if (/^\s*(echo|printf)\s+/i.test(cmd) && /\b(pass|ok|success|true)\b/i.test(cmd)) {
    return true;
  }
  return false;
}

/**
 * Check if a Bash command is a git commit.
 */
function isGitCommit(command) {
  if (!command || typeof command !== 'string') return false;
  return /\bgit\s+commit\b/.test(command.trim());
}

/**
 * Check if a Bash command is a grep on a specific file.
 */
function isGrepOnFile(command, editedFiles) {
  if (!command || typeof command !== 'string') return false;
  const cmd = command.trim();
  if (!/\bgrep\b/.test(cmd)) return false;

  // Check if any recently edited file appears in the grep command
  for (const f of editedFiles) {
    const normalized = normalizePath(f).toLowerCase();
    const basename = path.basename(normalized);
    if (cmd.toLowerCase().includes(basename)) return true;
  }
  return false;
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

async function handleRecord(hookData, projectDir) {
  const toolName = hookData.tool_name;
  const input = hookData.tool_input || {};

  let state = loadState(projectDir);
  state = handleSessionIsolation(state, hookData.session_id);

  if ((toolName === 'Edit' || toolName === 'Write') && input.file_path) {
    if (isSourceFile(input.file_path)) {
      state.state = 'EDITED';
      const normalized = normalizePath(input.file_path);
      if (!state.editsSinceTest.includes(normalized)) {
        state.editsSinceTest.push(normalized);
      }
      process.stderr.write(`[VERIFICATION_SEQ] Recorded source edit: ${normalized}\n`);
    }
  } else if (toolName === 'Bash' && input.command) {
    if (isTestExecution(input.command)) {
      state.state = 'TESTED';
      state.editsSinceTest = [];
      state.editGrepCycleCount = 0;
      state.lastTestTs = new Date().toISOString();
      process.stderr.write(`[VERIFICATION_SEQ] Recorded test execution, state → TESTED\n`);
    } else if (isGrepOnFile(input.command, state.editsSinceTest)) {
      state.editGrepCycleCount = (state.editGrepCycleCount || 0) + 1;
      process.stderr.write(`[VERIFICATION_SEQ] Grep on edited file, cycle count → ${state.editGrepCycleCount}\n`);
    }
  }

  saveState(projectDir, state);
  process.exit(0);
}

// --- Mode: gate (PreToolUse) ---

async function handleGate(hookData, projectDir) {
  const toolName = hookData.tool_name;
  const input = hookData.tool_input || {};

  let state = loadState(projectDir);
  state = handleSessionIsolation(state, hookData.session_id);

  // Gate 1: Edit/Write on source file when edit-grep cycle count >= 3
  if ((toolName === 'Edit' || toolName === 'Write') && input.file_path) {
    if (isSourceFile(input.file_path) && state.editGrepCycleCount >= 3) {
      const output = {
        decision: 'block',
        reason: `Edit→Grep cycle detected (${state.editGrepCycleCount} cycles without testing). You are editing source files and checking with grep instead of running tests. Run the test suite first to verify your changes work, then continue editing.`
      };
      process.stderr.write(`[VERIFICATION_SEQ] Blocked: edit-grep cycle count ${state.editGrepCycleCount} >= 3\n`);
      console.log(JSON.stringify(output));
      process.exit(2);
      return;
    }
    // Non-source files always pass
    if (!isSourceFile(input.file_path)) {
      process.exit(0);
      return;
    }
  }

  // Gate 2: git commit without test
  if (toolName === 'Bash' && input.command && isGitCommit(input.command)) {
    if (state.state === 'EDITED') {
      const files = state.editsSinceTest.join(', ');
      const output = {
        decision: 'block',
        reason: `Git commit blocked: source files were edited but no tests were run. Edited files: [${files}]. Run the test suite to verify changes before committing.`
      };
      process.stderr.write(`[VERIFICATION_SEQ] Blocked: git commit in EDITED state (no test run)\n`);
      console.log(JSON.stringify(output));
      process.exit(2);
      return;
    }
  }

  // All other cases: allow
  process.exit(0);
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

  if (mode === 'record') {
    await handleRecord(hookData, projectDir);
  } else {
    await handleGate(hookData, projectDir);
  }
}

main().catch(e => {
  process.stderr.write(`[VERIFICATION_SEQ ERROR] ${e.message}\n`);
  process.exit(0); // fail-open
});
