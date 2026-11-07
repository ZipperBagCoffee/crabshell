// Integration tests for doc-watchdog.js
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const scriptPath = path.join(__dirname, 'doc-watchdog.js');
const nodePath = 'C:/Program Files/nodejs/node.exe';
const projectDir = 'C:\\Users\\chulg\\Documents\\memory-keeper-plugin';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label || ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- Integration test helper ---

function runScript(mode, hookData, env) {
  const json = JSON.stringify(hookData);
  try {
    const result = execSync(
      `"${nodePath}" "${scriptPath}" ${mode}`,
      {
        input: json,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...(env || {}) },
        timeout: 5000,
        encoding: 'utf8'
      }
    );
    return { exitCode: 0, stdout: result };
  } catch (e) {
    return { exitCode: e.status, stdout: e.stdout || '' };
  }
}

// --- Temp project helpers ---

function makeTmpProject() {
  const tmpDir = path.join(os.tmpdir(), 'doc-watchdog-test-' + process.pid + '-' + Date.now());
  const memDir = path.join(tmpDir, '.crabshell', 'memory');
  const ticketDir = path.join(tmpDir, '.crabshell', 'ticket');
  fs.mkdirSync(memDir, { recursive: true });
  fs.mkdirSync(ticketDir, { recursive: true });
  return { tmpDir, memDir, ticketDir };
}

function cleanupTmpProject(tmpDir) {
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
}

function readWatchdogState(memDir) {
  const f = path.join(memDir, 'doc-watchdog.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function writeRegressingState(memDir, active, ticketIds) {
  const state = { active, ticketIds: ticketIds || [], startedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify(state, null, 2));
}

function writeWatchdogState(memDir, state) {
  fs.writeFileSync(path.join(memDir, 'doc-watchdog.json'), JSON.stringify(state, null, 2));
}

// ============================================================
// TEST 1: record — code file edit → editsSinceDocUpdate increments
// ============================================================

test('record: code file edit → editsSinceDocUpdate increments', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    const hookData = {
      tool_name: 'Write',
      tool_input: { file_path: 'scripts/foo.js', content: 'console.log("hi")' }
    };
    const result = runScript('record', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 0, 'exit code');

    const state = readWatchdogState(memDir);
    assert(state !== null, 'state file should exist');
    assertEqual(state.editsSinceDocUpdate, 1, 'editsSinceDocUpdate');
    assert(state.lastCodeEditFile !== null, 'lastCodeEditFile should be set');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// TEST 2: record — doc file edit → editsSinceDocUpdate resets to 0
// ============================================================

test('record: doc file edit → editsSinceDocUpdate resets to 0', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    // Seed state with 3 edits
    writeWatchdogState(memDir, { editsSinceDocUpdate: 3, lastCodeEditAt: new Date().toISOString(), lastCodeEditFile: 'scripts/bar.js' });

    const hookData = {
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/P001_T001-some-ticket.md',
        old_string: 'old',
        new_string: 'new'
      }
    };
    const result = runScript('record', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 0, 'exit code');

    const state = readWatchdogState(memDir);
    assert(state !== null, 'state file should exist');
    assertEqual(state.editsSinceDocUpdate, 0, 'editsSinceDocUpdate should be reset to 0');
    assert(state.lastDocUpdateAt !== null, 'lastDocUpdateAt should be set');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// TEST 3: record — non-code non-doc file → no change to counter
// ============================================================

test('record: non-code non-doc file → no change to counter', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    writeWatchdogState(memDir, { editsSinceDocUpdate: 2, lastCodeEditAt: null, lastCodeEditFile: null });

    // D143_T013: a code file is any project file the runner sees (README included); a
    // file in Crabshell's own storage that is not a workflow document is neither.
    const hookData = {
      tool_name: 'Write',
      tool_input: { file_path: '.crabshell/memory/notes.md', content: '# Hello' }
    };
    const result = runScript('record', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 0, 'exit code');

    const state = readWatchdogState(memDir);
    // neither code nor a workflow document — counter should stay at 2
    assertEqual(state.editsSinceDocUpdate, 2, 'editsSinceDocUpdate should be unchanged');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// TEST 4: record — INDEX.md edit → does NOT reset counter
// ============================================================

test('record: INDEX.md edit → does NOT reset counter', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    writeWatchdogState(memDir, { editsSinceDocUpdate: 4, lastCodeEditAt: null, lastCodeEditFile: null });

    const hookData = {
      tool_name: 'Write',
      tool_input: { file_path: '.crabshell/ticket/INDEX.md', content: '# Index' }
    };
    const result = runScript('record', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 0, 'exit code');

    const state = readWatchdogState(memDir);
    // INDEX.md is excluded — counter should stay at 4
    assertEqual(state.editsSinceDocUpdate, 4, 'editsSinceDocUpdate should be unchanged for INDEX.md');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// TEST 5: gate — below threshold → exit 0, no additionalContext
// ============================================================

test('gate: below threshold → exit 0, no additionalContext', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['P001_T001']);
    writeWatchdogState(memDir, { editsSinceDocUpdate: 3, lastCodeEditAt: new Date().toISOString(), lastCodeEditFile: 'scripts/foo.js' });

    const hookData = {
      tool_name: 'Write',
      tool_input: { file_path: 'scripts/bar.js', content: 'x' }
    };
    const result = runScript('gate', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 0, 'exit code');
    assert(!result.stdout.includes('additionalContext'), 'should NOT have additionalContext below threshold');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// TEST 6: gate — at threshold + regressing active → exit 0 + additionalContext
// ============================================================

test('gate: at threshold + regressing active → exit 0 with additionalContext in stdout', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['P001_T001']);
    writeWatchdogState(memDir, { editsSinceDocUpdate: 5, lastCodeEditAt: new Date().toISOString(), lastCodeEditFile: 'scripts/foo.js' });

    const hookData = {
      tool_name: 'Edit',
      tool_input: { file_path: 'scripts/bar.js', old_string: 'a', new_string: 'b' }
    };
    const result = runScript('gate', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 0, 'exit code should be 0 (soft warning)');
    assert(result.stdout.includes('additionalContext'), 'stdout should contain additionalContext');
    assert(result.stdout.includes('DOC-WATCHDOG'), 'additionalContext should mention DOC-WATCHDOG');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// TEST 7: gate — at threshold + regressing NOT active → exit 0, no warning
// ============================================================

test('gate: at threshold + regressing NOT active → exit 0 (no warning)', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, false, []);
    writeWatchdogState(memDir, { editsSinceDocUpdate: 10, lastCodeEditAt: new Date().toISOString(), lastCodeEditFile: 'scripts/foo.js' });

    const hookData = {
      tool_name: 'Write',
      tool_input: { file_path: 'scripts/bar.js', content: 'x' }
    };
    const result = runScript('gate', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 0, 'exit code');
    assert(!result.stdout.includes('additionalContext'), 'should NOT warn when regressing not active');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// TEST 8: gate — target is doc file → exit 0, no warning (doc edits exempt)
// ============================================================

test('gate: target is doc file → exit 0 (doc edits exempt)', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['P001_T001']);
    writeWatchdogState(memDir, { editsSinceDocUpdate: 10, lastCodeEditAt: new Date().toISOString(), lastCodeEditFile: 'scripts/foo.js' });

    const hookData = {
      tool_name: 'Write',
      tool_input: { file_path: '.crabshell/ticket/P001_T001-test.md', content: 'update' }
    };
    const result = runScript('gate', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 0, 'exit code');
    assert(!result.stdout.includes('additionalContext'), 'doc file edits should be exempt from gate');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// TEST 9: stop — no regressing → exit 0
// ============================================================

test('stop: no regressing → exit 0', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, false, []);
    writeWatchdogState(memDir, { editsSinceDocUpdate: 5, lastCodeEditAt: new Date().toISOString(), lastCodeEditFile: 'scripts/foo.js' });

    const hookData = { stop_hook_active: false };
    const result = runScript('stop', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 0, 'exit code');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// TEST 10: stop — regressing + ticket with only "Created" log entry → exit 2 block
// ============================================================

test('stop: regressing + ticket with only "Created" log entry → exit 2 block', () => {
  const { tmpDir, memDir, ticketDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['P999_T001']);
    writeWatchdogState(memDir, { editsSinceDocUpdate: 2, lastCodeEditAt: new Date().toISOString(), lastCodeEditFile: 'scripts/foo.js' });

    // Ticket with only "Created" entry (single log timestamp)
    const ticketContent = `# P999_T001 - Test Ticket\n\n## Work Log\n\n### [2026-04-03 10:00]\n\nCreated.\n`;
    fs.writeFileSync(path.join(ticketDir, 'P999_T001-test.md'), ticketContent, 'utf8');

    const hookData = { stop_hook_active: false };
    const result = runScript('stop', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 2, 'exit code should be 2 (block)');
    assert(result.stdout.includes('"decision"'), 'stdout should contain decision');
    assert(result.stdout.includes('block'), 'decision should be block');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// TEST 11: stop — regressing + no code edits (lastCodeEditAt null) → exit 0
// ============================================================

test('stop: regressing + no code edits (lastCodeEditAt null) → exit 0', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['P001_T001']);
    writeWatchdogState(memDir, { editsSinceDocUpdate: 0, lastCodeEditAt: null, lastCodeEditFile: null });

    const hookData = { stop_hook_active: false };
    const result = runScript('stop', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 0, 'exit code should be 0 (no code edits = nothing to check)');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// TEST 12: stop — stop_hook_active → exit 0 (no infinite loop)
// ============================================================

test('stop: stop_hook_active → exit 0', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['P001_T001']);
    writeWatchdogState(memDir, { editsSinceDocUpdate: 5, lastCodeEditAt: new Date().toISOString(), lastCodeEditFile: 'scripts/foo.js' });

    const hookData = { stop_hook_active: true };
    const result = runScript('stop', hookData, { CLAUDE_PROJECT_DIR: tmpDir });
    assertEqual(result.exitCode, 0, 'exit code should be 0 (stop_hook_active prevents loop)');
  } finally {
    cleanupTmpProject(tmpDir);
  }
});

// ============================================================
// SUMMARY
// ============================================================

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
