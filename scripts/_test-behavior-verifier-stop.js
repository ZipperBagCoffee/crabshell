'use strict';
/**
 * Tests for behavior-verifier.js Stop hook (P132_T003 AC-5).
 *
 * Covers ≥7 cases:
 *  1) baseline substantive response → state file written + sentinel emitted
 *  2) CRABSHELL_BACKGROUND=1        → exit 0, no state, no sentinel
 *  3) CRABSHELL_AGENT=behavior-verifier → exit 0, no state, no sentinel
 *  4) hookData.stop_hook_active=true → exit 0, no state
 *  5) length<50 short response       → exit 0, no state
 *  6) clarification-only (?-only)    → exit 0, no state
 *  7) malformed JSON stdin           → exit 0 fail-open, no state
 *  8) state write fail (ENOTDIR)     → exit 0 fail-open + stderr error log
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT = path.join(__dirname, 'behavior-verifier.js');
const NODE = process.execPath;

let passed = 0;
let failed = 0;
const tmpDirs = [];

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p132t003-stop-'));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function makeBlockedSandbox() {
  // Create a project dir where .crabshell is a regular FILE, not a directory —
  // forces ENOTDIR on mkdir, exercising the writeJson outer try/catch.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p132t003-stop-blocked-'));
  fs.writeFileSync(path.join(dir, '.crabshell'), 'not a directory', 'utf8');
  tmpDirs.push(dir);
  return dir;
}

function statePath(sandbox) {
  return path.join(sandbox, '.crabshell', 'memory', 'behavior-verifier-state.json');
}

function runStop(sandbox, hookData, extraEnv) {
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sandbox }, extraEnv || {});
  delete env.CRABSHELL_BACKGROUND;
  delete env.CRABSHELL_AGENT;
  if (extraEnv) {
    for (const k in extraEnv) { env[k] = extraEnv[k]; }
  }
  const input = (typeof hookData === 'string') ? hookData : JSON.stringify(hookData);
  const result = spawnSync(NODE, [SCRIPT], {
    input, timeout: 5000, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], env
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

const SUBSTANTIVE = 'I have implemented the function and verified it returns the expected value across three test cases. The behavior matches the specification.';

// 1 — baseline
(function() {
  const sb = makeSandbox();
  const r = runStop(sb, { stop_response: SUBSTANTIVE, session_id: 'sess-AC1' });
  const exists = fs.existsSync(statePath(sb));
  let state = null;
  try { state = JSON.parse(fs.readFileSync(statePath(sb), 'utf8')); } catch {}
  const sentinel = r.stderr.includes('[CRABSHELL_BEHAVIOR_VERIFY] file=behavior-verifier-state.json taskId=verify-');
  ok('1 baseline → state pending + sentinel',
     r.exitCode === 0 && exists && state && state.status === 'pending' && sentinel,
     'exit=' + r.exitCode + ' exists=' + exists + ' status=' + (state && state.status) + ' sentinel=' + sentinel);
})();

// 2 — CRABSHELL_BACKGROUND=1
(function() {
  const sb = makeSandbox();
  const r = runStop(sb, { stop_response: SUBSTANTIVE, session_id: 's2' }, { CRABSHELL_BACKGROUND: '1' });
  const exists = fs.existsSync(statePath(sb));
  ok('2 CRABSHELL_BACKGROUND=1 → exit 0, no state',
     r.exitCode === 0 && !exists && r.stderr === '');
})();

// 3 — CRABSHELL_AGENT=behavior-verifier
(function() {
  const sb = makeSandbox();
  const r = runStop(sb, { stop_response: SUBSTANTIVE, session_id: 's3' }, { CRABSHELL_AGENT: 'behavior-verifier' });
  const exists = fs.existsSync(statePath(sb));
  ok('3 CRABSHELL_AGENT=behavior-verifier → exit 0, no state',
     r.exitCode === 0 && !exists && r.stderr === '');
})();

// 4 — stop_hook_active=true
(function() {
  const sb = makeSandbox();
  const r = runStop(sb, { stop_response: SUBSTANTIVE, session_id: 's4', stop_hook_active: true });
  const exists = fs.existsSync(statePath(sb));
  ok('4 stop_hook_active=true → exit 0, no state', r.exitCode === 0 && !exists);
})();

// 5 — length<50
(function() {
  const sb = makeSandbox();
  const r = runStop(sb, { stop_response: 'short.', session_id: 's5' });
  const exists = fs.existsSync(statePath(sb));
  ok('5 length<50 → exit 0, no state', r.exitCode === 0 && !exists);
})();

// 6 — clarification-only
(function() {
  const sb = makeSandbox();
  const r = runStop(sb, { stop_response: 'Which file did you want me to inspect? Should I check the test file or the source file?', session_id: 's6' });
  const exists = fs.existsSync(statePath(sb));
  ok('6 clarification-only → exit 0, no state', r.exitCode === 0 && !exists);
})();

// 7 — malformed JSON stdin
(function() {
  const sb = makeSandbox();
  const r = runStop(sb, '{this is not valid json');
  const exists = fs.existsSync(statePath(sb));
  ok('7 malformed JSON stdin → exit 0 fail-open, no state', r.exitCode === 0 && !exists);
})();

// 8 — state write fail (ENOTDIR)
(function() {
  const sb = makeBlockedSandbox();
  const r = runStop(sb, { stop_response: SUBSTANTIVE, session_id: 's8' });
  // mkdir on .crabshell/memory fails because .crabshell is a file → outer
  // try/catch in behavior-verifier.js catches and exit 0 with stderr log.
  const errLog = r.stderr.includes('[CRABSHELL_BEHAVIOR_VERIFY] state write failed:');
  ok('8 state write fail (ENOTDIR) → exit 0 fail-open + stderr error',
     r.exitCode === 0 && errLog,
     'exit=' + r.exitCode + ' stderr=' + r.stderr.slice(0, 200));
})();

// Cleanup
for (const d of tmpDirs) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
}

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
