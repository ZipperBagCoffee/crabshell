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

// D147_T004: the edit record is per session (core/session-state), so every hook call here
// carries one session and one turn, as the host sends them.
const { MEMORY_DIR, SESSION_STATE_DIR } = require('./constants');
const TEST_SESSION = 'dwtest01-session';
const TEST_TURN = 'dw-turn-1';

function runScript(mode, hookData, env) {
  const json = JSON.stringify({ session_id: TEST_SESSION, prompt_id: TEST_TURN, ...hookData });
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

function sessionStateFile(memDir, sessionId = TEST_SESSION) {
  return path.join(memDir, SESSION_STATE_DIR, sessionId.slice(0, 8), 'doc-watchdog.json');
}

function readWatchdogState(memDir, sessionId) {
  try { return JSON.parse(fs.readFileSync(sessionStateFile(memDir, sessionId), 'utf8')); } catch { return null; }
}

function writeRegressingState(memDir, active, ticketIds, sessionId) {
  const state = { active, ticketIds: ticketIds || [], startedAt: new Date().toISOString(), ...(sessionId ? { sessionId } : {}) };
  fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify(state, null, 2));
}

function writeWatchdogState(memDir, state, sessionId) {
  const file = sessionStateFile(memDir, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

// This session asked for work in this turn (as inject-rules records it on UserPromptSubmit).
function authorize(tmpDir, sessionId = TEST_SESSION, turn = TEST_TURN, prompt = '고쳐') {
  const ids = { session_id: sessionId, prompt_id: turn };
  require('./core/completion-control').noteExecutionAuthorization(tmpDir, { ...ids, prompt });
  require('./core/turn-state').notePrompt(tmpDir, ids, { intent: 'execution', userAuthored: true, injecting: true });
}

// Ticket INDEX rows: [[id, status], ...]
function writeTicketIndex(ticketDir, rows) {
  const lines = ['# Ticket Index', '', '| ID | Title | Status | Created | Parent |', '|----|-------|--------|---------|--------|',
    ...rows.map(([id, status]) => `| [[${id}-test\\|${id}]] | t | ${status} | 2026-11-07 | |`)];
  fs.writeFileSync(path.join(ticketDir, 'INDEX.md'), lines.join('\n') + '\n');
}

function writeTicket(ticketDir, id, { logs = 1, mtime = null } = {}) {
  const file = path.join(ticketDir, `${id}-test.md`);
  const entries = Array.from({ length: logs }, (_, i) => `### [2026-11-07 10:0${i}] Entry ${i}\n`).join('\n');
  fs.writeFileSync(file, `---\nid: ${id}\nstatus: in-progress\n---\n# ${id}\n\n## Log\n\n${entries}`);
  if (mtime) fs.utimesSync(file, mtime, mtime);
  return file;
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
    authorize(tmpDir);
    writeTicketIndex(ticketDir, [['P999_T001', 'in-progress']]);

    // Ticket with only "Created" entry (single log timestamp), written before the code edit
    const ticketContent = `# P999_T001 - Test Ticket\n\n## Work Log\n\n### [2026-04-03 10:00]\n\nCreated.\n`;
    const ticketFile = path.join(ticketDir, 'P999_T001-test.md');
    fs.writeFileSync(ticketFile, ticketContent, 'utf8');
    const earlier = new Date(Date.now() - 60000);
    fs.utimesSync(ticketFile, earlier, earlier);
    writeWatchdogState(memDir, { editsSinceDocUpdate: 2, lastCodeEditAt: new Date().toISOString(), lastCodeEditFile: 'scripts/foo.js', docsWritten: {} });

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
// D147_T004: per-session record, INDEX status, logged-after-edit, owner and authorization
// ============================================================

const { stopReason } = require('./doc-watchdog');
const stopIds = { session_id: TEST_SESSION, prompt_id: TEST_TURN, stop_hook_active: false };
const before = () => new Date(Date.now() - 60000);
function codeEdit(memDir, sessionId, extra = {}) {
  writeWatchdogState(memDir, { editsSinceDocUpdate: 1, lastCodeEditAt: new Date().toISOString(), lastCodeEditFile: 'scripts/foo.js', docsWritten: {}, ...extra }, sessionId);
}

test('T004: another session\'s code edit does not remind this session', () => {
  const { tmpDir, memDir, ticketDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['D900_T001']);
    writeTicketIndex(ticketDir, [['D900_T001', 'in-progress']]);
    writeTicket(ticketDir, 'D900_T001', { mtime: before() });
    authorize(tmpDir);
    // The edit is recorded the way the old shared file kept it, and under another session.
    fs.writeFileSync(path.join(memDir, 'doc-watchdog.json'), JSON.stringify({ editsSinceDocUpdate: 1, lastCodeEditAt: new Date().toISOString(), lastCodeEditFile: 'scripts/foo.js' }));
    codeEdit(memDir, 'otherses-session');
    assertEqual(stopReason(stopIds, tmpDir), null, 'no reminder');
  } finally { cleanupTmpProject(tmpDir); }
});

test('T004: a ticket the INDEX marks verified is not a candidate, even if its file says in-progress', () => {
  const { tmpDir, memDir, ticketDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['D900_T001']);
    writeTicketIndex(ticketDir, [['D900_T001', 'verified']]);
    writeTicket(ticketDir, 'D900_T001', { mtime: before() });
    authorize(tmpDir);
    codeEdit(memDir);
    assertEqual(stopReason(stopIds, tmpDir), null, 'no reminder');
  } finally { cleanupTmpProject(tmpDir); }
});

test('T004: an unfinished ticket with several log entries but none after the code edit is named', () => {
  const { tmpDir, memDir, ticketDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['D900_T001']);
    writeTicketIndex(ticketDir, [['D900_T001', 'in-progress']]);
    writeTicket(ticketDir, 'D900_T001', { logs: 3, mtime: before() });
    authorize(tmpDir);
    codeEdit(memDir);
    const reason = stopReason(stopIds, tmpDir) || '';
    assert(reason.includes('D900_T001'), `names the ticket: ${reason}`);
    assert(reason.includes('scripts/foo.js'), 'names the edited file');
  } finally { cleanupTmpProject(tmpDir); }
});

test('T004: a ticket updated after the code edit is not named', () => {
  const { tmpDir, memDir, ticketDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['D900_T001']);
    writeTicketIndex(ticketDir, [['D900_T001', 'in-progress']]);
    authorize(tmpDir);
    codeEdit(memDir, TEST_SESSION, { lastCodeEditAt: before().toISOString() });
    writeTicket(ticketDir, 'D900_T001'); // written now, after the edit
    assertEqual(stopReason(stopIds, tmpDir), null, 'no reminder');
  } finally { cleanupTmpProject(tmpDir); }
});

test('T004: when this session wrote one of the tickets, an idle in-progress ticket is not named', () => {
  const { tmpDir, memDir, ticketDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['D900_T001', 'D900_T002']);
    writeTicketIndex(ticketDir, [['D900_T001', 'in-progress'], ['D900_T002', 'in-progress']]);
    writeTicket(ticketDir, 'D900_T001', { mtime: before() });
    writeTicket(ticketDir, 'D900_T002', { mtime: before() });
    authorize(tmpDir);
    codeEdit(memDir, TEST_SESSION, { docsWritten: { '.crabshell/ticket/D900_T001-test.md': new Date(Date.now() - 120000).toISOString() } });
    const reason = stopReason(stopIds, tmpDir) || '';
    assert(reason.includes('D900_T001'), `names the session's ticket: ${reason}`);
    assert(!reason.includes('D900_T002'), 'idle ticket not named');
  } finally { cleanupTmpProject(tmpDir); }
});

test('T004: a workflow owned by another session gives no reminder', () => {
  const { tmpDir, memDir, ticketDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['D900_T001'], 'otherses-session');
    writeTicketIndex(ticketDir, [['D900_T001', 'in-progress']]);
    writeTicket(ticketDir, 'D900_T001', { mtime: before() });
    authorize(tmpDir);
    codeEdit(memDir);
    assertEqual(stopReason(stopIds, tmpDir), null, 'no reminder');
  } finally { cleanupTmpProject(tmpDir); }
});

test('T004: a turn without an execution request gives no reminder', () => {
  const { tmpDir, memDir, ticketDir } = makeTmpProject();
  try {
    writeRegressingState(memDir, true, ['D900_T001']);
    writeTicketIndex(ticketDir, [['D900_T001', 'in-progress']]);
    writeTicket(ticketDir, 'D900_T001', { mtime: before() });
    codeEdit(memDir);
    assertEqual(stopReason(stopIds, tmpDir), null, 'not authorized → no reminder');
    authorize(tmpDir);
    require('./core/turn-state').notePrompt(tmpDir, { session_id: TEST_SESSION, prompt_id: TEST_TURN }, { intent: 'question', userAuthored: true, injecting: true });
    assertEqual(stopReason(stopIds, tmpDir), null, 'latest user message is a question → no reminder');
  } finally { cleanupTmpProject(tmpDir); }
});

test('T004: a recorded edit needs a session; a call without one records nothing', () => {
  const { tmpDir, memDir } = makeTmpProject();
  try {
    require('./doc-watchdog').recordEdit({ tool_name: 'Write', tool_input: { file_path: path.join(tmpDir, 'scripts', 'foo.js'), content: 'x' } }, tmpDir);
    assertEqual(fs.existsSync(path.join(memDir, SESSION_STATE_DIR)), false, 'no session state');
    assertEqual(fs.existsSync(path.join(memDir, 'doc-watchdog.json')), false, 'no shared file');
  } finally { cleanupTmpProject(tmpDir); }
});

// ============================================================
// SUMMARY
// ============================================================

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
