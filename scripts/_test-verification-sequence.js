// Comprehensive verification-sequence.js test
'use strict';
// D143_T013: verification-sequence keeps only the declared checks as they ran
// (checkHistory: started, passed, failed). Edits write nothing — which checks a change
// needs comes from the runner's records — and a commit is never blocked (D143).

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { currentCheck } = require('./core/check-history');

const scriptPath = path.join(__dirname, 'verification-sequence.js');
const nodePath = process.execPath;
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-sequence-'));
const stateDir = path.join(projectDir, '.crabshell', 'memory');
const stateFile = path.join(stateDir, 'verification-state.json');

// Ensure state dir exists
if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(path.join(projectDir, '.crabshell', 'verification'), { recursive: true });
// D143_T014: the manifest alone declares checks (no package.json script is followed).
fs.writeFileSync(path.join(projectDir, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ tools: {
  coverage: 'npx jest --coverage', inject: 'node scripts/_test-inject-rules.js', app: 'node src/app.test.js',
  lint: 'npm run lint', test: 'npm test', self: 'node scripts/_test-verification-sequence.js', typecheck: 'tsc --noEmit',
} }));

let passed = 0;
let failed = 0;

function resetState(state) {
  if (state) {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } else {
    try { fs.unlinkSync(stateFile); } catch {}
  }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; }
}

function rawState() {
  try { return fs.readFileSync(stateFile, 'utf8'); } catch { return null; }
}

// The last declared check as recorded (what the recovery context shows), or null.
function lastCheck() {
  const state = readState();
  return state ? currentCheck(state) : null;
}

function runScript(mode, hookData, expectExit) {
  const json = JSON.stringify(hookData);
  try {
    const result = execSync(
      `"${nodePath}" "${scriptPath}" ${mode}`,
      {
        input: json,
        // PATHEXT as Windows sets it, so the node.exe cases mean the same on every OS.
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
        timeout: 5000,
        encoding: 'utf8'
      }
    );
    return { exitCode: 0, stdout: result };
  } catch (e) {
    return { exitCode: e.status, stdout: e.stdout || '' };
  }
}

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

// ============================================================
// Edits write nothing, whatever the file (no extension or folder list)
// ============================================================

for (const [label, payload] of [
  ['.js Edit', { tool_name: 'Edit', tool_input: { file_path: 'src/app.js', old_string: 'old', new_string: 'new' } }],
  ['README Edit', { tool_name: 'Edit', tool_input: { file_path: 'README.md', old_string: 'old', new_string: 'new' } }],
  ['.crabshell file Edit', { tool_name: 'Edit', tool_input: { file_path: '.crabshell/memory/memory-index.json', old_string: 'old', new_string: 'new' } }],
  ['.ts Write', { tool_name: 'Write', tool_input: { file_path: 'src/index.ts', content: 'x' } }],
  ['node_modules Edit', { tool_name: 'Edit', tool_input: { file_path: 'node_modules/foo/index.js', old_string: 'old', new_string: 'new' } }],
]) {
  test(`Edit records nothing: ${label} (no state file is created)`, () => {
    resetState(null);
    runScript('record', payload);
    assert(rawState() === null, `verification-state.json was written: ${rawState()}`);
  });
}

test('Edit leaves an existing record byte for byte', () => {
  resetState({ lastUpdated: '2026-01-01T00:00:00.000Z', checkHistory: { sequence: 0, pending: {}, latestStarted: {}, results: {}, trackedStarts: false } });
  const before = rawState();
  runScript('record', { tool_name: 'Edit', tool_input: { file_path: 'app.py', old_string: 'old', new_string: 'new' } });
  assert(rawState() === before, 'an edit rewrote the record');
});

// ============================================================
// Declared checks are recognized and recorded (manifest tools)
// ============================================================

test('A declared check without a result records no pass: real exit and success evidence are required', () => {
  resetState(null);
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  const check = lastCheck();
  assert(!check || check.passed !== true, `expected no pass, got ${JSON.stringify(check)}`);
});

for (const [label, command] of [
  ['npx jest', 'npx jest --coverage'],
  ['node _test-file.js', 'node scripts/_test-verification-sequence.js'],
  ['tsc', 'tsc --noEmit'],
  ['npm run lint', 'npm run lint'],
  ['node.exe _test-file.js', 'node.exe scripts/_test-verification-sequence.js'],
  ['quoted node.exe path with space', '"C:/Program Files/nodejs/node.exe" scripts/_test-inject-rules.js'],
  ['node.exe .test. pattern', 'node.exe src/app.test.js'],
]) {
  test(`Declared check is recorded as passing: ${label}`, () => {
    resetState(null);
    runScript('record', { tool_name: 'Bash', tool_input: { command }, tool_response: { exitCode: 0, stdout: '1 passed' } });
    const check = lastCheck();
    assert(check && check.passed === true && check.command === command, `expected a passing record of ${command}, got ${JSON.stringify(check)}`);
  });
}

for (const [label, command] of [['grep foo', 'grep foo src/app.js'], ['echo PASS (trivial)', 'echo PASS'], ['echo test (negative)', 'echo test passed']]) {
  test(`Not a declared check, nothing recorded: ${label}`, () => {
    resetState(null);
    runScript('record', { tool_name: 'Bash', tool_input: { command }, tool_response: { exitCode: 0, stdout: 'x' } });
    assert(rawState() === null, `recorded a non-check: ${rawState()}`);
  });
}

// ============================================================
// Failed checks are recorded as failures (C31/I078)
// ============================================================

// An error with no exit code is undetermined (no last check); one with a code is a failure.
for (const [label, command, response, determined] of [
  ['exitCode != 0', 'npm test', { stdout: '', stderr: '1 failed', exitCode: 1 }, true],
  ['is_error: true, no exit code', 'npm test', { is_error: true, content: 'boom' }, false],
  ['"Exit code 1" string response', 'node scripts/_test-verification-sequence.js', 'Exit code 1\nTests: 1 failed', true],
]) {
  test(`Failing check never counts as a pass: ${label}`, () => {
    resetState(null);
    runScript('record', { tool_name: 'Bash', tool_input: { command }, tool_response: response });
    const check = lastCheck();
    assert(determined ? check && check.passed === false : check === null, `got ${JSON.stringify(check)}`);
  });
}

test('A pass after a failure replaces it as the last check', () => {
  resetState(null);
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { exitCode: 1, stderr: 'FAIL' } });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: '52 passed', stderr: '', exitCode: 0, interrupted: false } });
  const check = lastCheck();
  assert(check && check.passed === true, `expected the pass, got ${JSON.stringify(check)}`);
});

test('An old record loses its edit-tracking fields when next written', () => {
  resetState({ lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null, lastTestFingerprint: 'x' });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { exitCode: 0, stdout: 'ok' } });
  const state = readState();
  for (const field of ['state', 'editsSinceTest', 'lastTestTs', 'lastTestFingerprint']) assert(!(field in state), `${field} kept`);
  assert(lastCheck() && lastCheck().passed === true, 'the check was not recorded');
});

// ============================================================
// Gate: a commit is never blocked (D143)
// ============================================================

for (const [label, state] of [
  ['after an edit and a failing check', null],
  ['with an old EDITED record', { lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null }],
  ['with an old TESTED label and no content identity', { lastUpdated: null, state: 'TESTED', editsSinceTest: [], lastTestTs: '2026-03-29T00:00:00.000Z' }],
]) {
  test(`Gate: git commit → exit 0, ${label}`, () => {
    resetState(state);
    if (!state) {
      runScript('record', { tool_name: 'Edit', tool_input: { file_path: 'src/main.js', old_string: 'old', new_string: 'new' } });
      runScript('record', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { exitCode: 1, stderr: 'FAIL' } });
    }
    const r = runScript('gate', { tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: x"' } });
    assert(r.exitCode === 0, `expected exit 0 (never blocked), got ${r.exitCode}`);
  });
}

test('Gate: a declared check starting is recorded as pending', () => {
  resetState(null);
  runScript('gate', { hook_event_name: 'PreToolUse', session_id: 's', tool_use_id: 't1', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  const state = readState();
  assert(state && Object.keys(state.checkHistory.pending).length === 1, `expected one pending start, got ${rawState()}`);
});

test('Gate: edits pass through with exit 0 and write nothing', () => {
  resetState(null);
  for (const payload of [{ tool_name: 'Edit', tool_input: { file_path: 'package.json', old_string: 'old', new_string: 'new' } },
    { tool_name: 'Write', tool_input: { file_path: 'config.yaml', content: 'x' } }]) {
    const r = runScript('gate', payload);
    assert(r.exitCode === 0, `expected exit 0 (allow), got ${r.exitCode}`);
  }
  assert(rawState() === null, 'the gate wrote a record for an edit');
});

// ============================================================
// Edge cases
// ============================================================

test('Empty hookData → exit 0', () => {
  resetState(null);
  const r = runScript('gate', {});
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
});

test('No tool_input → exit 0', () => {
  resetState(null);
  const r = runScript('gate', { tool_name: 'Edit' });
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
});

test('Unknown mode → exit 0', () => {
  resetState(null);
  const r = runScript('unknown', { tool_name: 'Edit', tool_input: { file_path: 'foo.js', old_string: 'old', new_string: 'new' } });
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
});

test('Bash non-commit non-test → exit 0', () => {
  resetState(null);
  const r = runScript('gate', { tool_name: 'Bash', tool_input: { command: 'ls -la' } });
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
});

// ============================================================
// Summary
// ============================================================

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);

// Cleanup
resetState(null);
try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch {}

if (failed > 0) process.exit(1);
