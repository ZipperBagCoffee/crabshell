// Comprehensive verification-sequence.js test
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptPath = path.join(__dirname, 'verification-sequence.js');
const nodePath = process.execPath;
const projectDir = 'C:\\Users\\chulg\\Documents\\memory-keeper-plugin';
const stateDir = path.join(projectDir, '.crabshell', 'memory');
const stateFile = path.join(stateDir, 'verification-state.json');

// Ensure state dir exists
if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

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

function runScript(mode, hookData, expectExit) {
  const json = JSON.stringify(hookData);
  try {
    const result = execSync(
      `"${nodePath}" "${scriptPath}" ${mode}`,
      {
        input: json,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
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
// Unit tests: isSourceFile (via record behavior)
// ============================================================

test('Source file detection: .js = source file (state → EDITED)', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'CLEAN', editsSinceTest: [], lastTestTs: null });
  runScript('record', { tool_name: 'Edit', tool_input: { file_path: 'src/app.js' } });
  const state = readState();
  assert(state.state === 'EDITED', `expected EDITED, got ${state.state}`);
});

test('Source file detection: .md = NOT source file (state stays CLEAN)', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'CLEAN', editsSinceTest: [], lastTestTs: null });
  runScript('record', { tool_name: 'Edit', tool_input: { file_path: 'README.md' } });
  const state = readState();
  assert(state.state === 'CLEAN', `expected CLEAN, got ${state.state}`);
});

test('Source file detection: .json in .crabshell/ = NOT source file', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'CLEAN', editsSinceTest: [], lastTestTs: null });
  runScript('record', { tool_name: 'Edit', tool_input: { file_path: '.crabshell/memory/memory-index.json' } });
  const state = readState();
  assert(state.state === 'CLEAN', `expected CLEAN, got ${state.state}`);
});

test('Source file detection: .ts = source file (state → EDITED)', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'CLEAN', editsSinceTest: [], lastTestTs: null });
  runScript('record', { tool_name: 'Write', tool_input: { file_path: 'src/index.ts' } });
  const state = readState();
  assert(state.state === 'EDITED', `expected EDITED, got ${state.state}`);
});

test('Source file detection: .py = source file (state → EDITED)', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'CLEAN', editsSinceTest: [], lastTestTs: null });
  runScript('record', { tool_name: 'Edit', tool_input: { file_path: 'app.py' } });
  const state = readState();
  assert(state.state === 'EDITED', `expected EDITED, got ${state.state}`);
});

test('Source file detection: node_modules/ path = NOT source file', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'CLEAN', editsSinceTest: [], lastTestTs: null });
  runScript('record', { tool_name: 'Edit', tool_input: { file_path: 'node_modules/foo/index.js' } });
  const state = readState();
  assert(state.state === 'CLEAN', `expected CLEAN, got ${state.state}`);
});

// ============================================================
// Unit tests: isTestExecution (via record behavior)
// ============================================================

test('Test execution detection: npm test = true', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  const state = readState();
  assert(state.state === 'TESTED', `expected TESTED, got ${state.state}`);
  assert(state.editsSinceTest.length === 0, `expected empty editsSinceTest`);
});

test('Test execution detection: npx jest = true', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'npx jest --coverage' } });
  const state = readState();
  assert(state.state === 'TESTED', `expected TESTED, got ${state.state}`);
});

test('Test execution detection: node _test-file.js = true', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'node scripts/_test-verification-sequence.js' } });
  const state = readState();
  assert(state.state === 'TESTED', `expected TESTED, got ${state.state}`);
});

test('Test execution detection: grep foo = false', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'grep foo src/app.js' } });
  const state = readState();
  assert(state.state === 'EDITED', `expected EDITED (unchanged), got ${state.state}`);
});

test('Test execution detection: echo PASS = false (trivial)', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'echo PASS' } });
  const state = readState();
  assert(state.state === 'EDITED', `expected EDITED (unchanged), got ${state.state}`);
});

test('Test execution detection: tsc = true', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.ts'], lastTestTs: null });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'tsc --noEmit' } });
  const state = readState();
  assert(state.state === 'TESTED', `expected TESTED, got ${state.state}`);
});

test('Test execution detection: npm run lint = true', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'npm run lint' } });
  const state = readState();
  assert(state.state === 'TESTED', `expected TESTED, got ${state.state}`);
});

test('Test execution detection: node.exe _test-file.js = true', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'node.exe scripts/_test-verification-sequence.js' } });
  const state = readState();
  assert(state.state === 'TESTED', `expected TESTED, got ${state.state}`);
});

test('Test execution detection: quoted node.exe path with space = true', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  runScript('record', { tool_name: 'Bash', tool_input: { command: '"C:/Program Files/nodejs/node.exe" scripts/_test-inject-rules.js' } });
  const state = readState();
  assert(state.state === 'TESTED', `expected TESTED, got ${state.state}`);
});

test('Test execution detection: node.exe .test. pattern = true', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'node.exe src/app.test.js' } });
  const state = readState();
  assert(state.state === 'TESTED', `expected TESTED, got ${state.state}`);
});

test('Test execution detection: echo test = false (negative)', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  runScript('record', { tool_name: 'Bash', tool_input: { command: 'echo test passed' } });
  const state = readState();
  assert(state.state === 'EDITED', `expected EDITED (unchanged), got ${state.state}`);
});

// ============================================================
// Gate behavior: git commit blocking
// ============================================================

test('Gate: EDITED state + git commit → exit 2 (block)', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  const r = runScript('gate', { tool_name: 'Bash', tool_input: { command: 'git commit -m "test"' } });
  assert(r.exitCode === 2, `expected exit 2 (block), got ${r.exitCode}`);
});

test('Gate: TESTED state + git commit → exit 0 (allow)', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'TESTED', editsSinceTest: [], lastTestTs: '2026-03-29T00:00:00.000Z' });
  const r = runScript('gate', { tool_name: 'Bash', tool_input: { command: 'git commit -m "test"' } });
  assert(r.exitCode === 0, `expected exit 0 (allow), got ${r.exitCode}`);
});

test('Gate: CLEAN state + git commit → exit 0 (allow)', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'CLEAN', editsSinceTest: [], lastTestTs: null });
  const r = runScript('gate', { tool_name: 'Bash', tool_input: { command: 'git commit -m "initial"' } });
  assert(r.exitCode === 0, `expected exit 0 (allow), got ${r.exitCode}`);
});

// ============================================================
// Non-source files: always exit 0 through gate
// ============================================================

test('Non-source file edit: .json → exit 0', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  const r = runScript('gate', { tool_name: 'Edit', tool_input: { file_path: 'package.json' } });
  assert(r.exitCode === 0, `expected exit 0 (allow), got ${r.exitCode}`);
});

test('Non-source file edit: .yaml → exit 0', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  const r = runScript('gate', { tool_name: 'Write', tool_input: { file_path: 'config.yaml' } });
  assert(r.exitCode === 0, `expected exit 0 (allow), got ${r.exitCode}`);
});

// ============================================================
// Record: source file edit tracking
// ============================================================

test('Record: source file Edit → state becomes EDITED', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'CLEAN', editsSinceTest: [], lastTestTs: null });
  runScript('record', { tool_name: 'Edit', tool_input: { file_path: 'src/app.js' } });
  const state = readState();
  assert(state.state === 'EDITED', `expected EDITED, got ${state.state}`);
  assert(state.editsSinceTest.includes('src/app.js'), `expected app.js in editsSinceTest`);
});

test('Record: non-source file Edit → state stays CLEAN', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'CLEAN', editsSinceTest: [], lastTestTs: null });
  runScript('record', { tool_name: 'Edit', tool_input: { file_path: 'README.md' } });
  const state = readState();
  assert(state.state === 'CLEAN', `expected CLEAN, got ${state.state}`);
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
  const r = runScript('unknown', { tool_name: 'Edit', tool_input: { file_path: 'foo.js' } });
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
});

test('Bash non-commit non-test → exit 0', () => {
  resetState({ sessionId: null, lastUpdated: null, state: 'EDITED', editsSinceTest: ['src/app.js'], lastTestTs: null });
  const r = runScript('gate', { tool_name: 'Bash', tool_input: { command: 'ls -la' } });
  assert(r.exitCode === 0, `expected exit 0, got ${r.exitCode}`);
});

// ============================================================
// Full integration: record Edit → record test → gate commit
// ============================================================

test('Integration: Edit → test → commit (allowed)', () => {
  resetState(null);
  runScript('record', { tool_name: 'Edit', tool_input: { file_path: 'src/main.js' } });
  let state = readState();
  assert(state.state === 'EDITED', `step 1: expected EDITED, got ${state.state}`);

  runScript('record', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  state = readState();
  assert(state.state === 'TESTED', `step 2: expected TESTED, got ${state.state}`);

  const r = runScript('gate', { tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: add feature"' } });
  assert(r.exitCode === 0, `step 3: expected exit 0, got ${r.exitCode}`);
});

test('Integration: Edit → commit (blocked)', () => {
  resetState(null);
  runScript('record', { tool_name: 'Edit', tool_input: { file_path: 'src/main.js' } });
  const r = runScript('gate', { tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: untested"' } });
  assert(r.exitCode === 2, `expected exit 2 (block), got ${r.exitCode}`);
});

// ============================================================
// Summary
// ============================================================

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);

// Cleanup
resetState(null);

if (failed > 0) process.exit(1);
