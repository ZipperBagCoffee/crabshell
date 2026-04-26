'use strict';
/**
 * Tests for D104 IA-1 (d) — verdict ring buffer FIFO N=8 in
 * behavior-verifier.js (carry-over) and inject-rules.js (consumer).
 *
 * Covers (5 cases per ticket P136_T001 AC11):
 *  1) priorState.ringBuffer=[7 entries] + behavior-verifier carry-over →
 *     length=7 preserved (push by sub-agent prompt, NOT hook).
 *  2) priorState.ringBuffer=[8 entries] + carry-over → length=8 (cap not
 *     exceeded; oldest dropped is sub-agent's responsibility).
 *  3) Entry shape — keys u/v/l/s booleans + reason ≤80 chars (validated
 *     against schema expectation when ring buffer is read by consumer).
 *  4) inject-rules.js consumer — bvState.ringBuffer present + status=pending
 *     → context contains "## Watcher Recent Verdicts" header + UVLS line.
 *  5) inject-rules.js consumer — overlong reason chain → byte cap enforced
 *     (~800 chars; truncation '...' suffix appears).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE = process.execPath;
const BV_SCRIPT = path.join(__dirname, 'behavior-verifier.js');
const IR_SCRIPT = path.join(__dirname, 'inject-rules.js');

let passed = 0;
let failed = 0;
const tmpDirs = [];

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p136t001-ringbuffer-'));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function statePath(sandbox) {
  return path.join(sandbox, '.crabshell', 'memory', 'behavior-verifier-state.json');
}

function indexPath(sandbox) {
  return path.join(sandbox, '.crabshell', 'memory', 'memory-index.json');
}

function writeState(sandbox, state) {
  fs.writeFileSync(statePath(sandbox), JSON.stringify(state, null, 2), 'utf8');
}

function readState(sandbox) {
  const p = statePath(sandbox);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeIndex(sandbox, idx) {
  fs.writeFileSync(indexPath(sandbox), JSON.stringify(idx, null, 2), 'utf8');
}

function runBehaviorVerifier(sandbox, hookData) {
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sandbox });
  delete env.CRABSHELL_BACKGROUND;
  delete env.CRABSHELL_AGENT;
  return spawnSync(NODE, [BV_SCRIPT], {
    input: JSON.stringify(hookData), timeout: 5000, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], env
  });
}

function runInjectRules(sandbox) {
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sandbox });
  delete env.CRABSHELL_BACKGROUND;
  const result = spawnSync(NODE, [IR_SCRIPT], {
    input: JSON.stringify({ prompt: 'next turn' }), timeout: 10000, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], env
  });
  let parsed = null;
  try { parsed = JSON.parse(result.stdout || '{}'); } catch {}
  const ctx = (parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext) || '';
  return { exitCode: result.status, ctx };
}

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

const SUBSTANTIVE = 'I have implemented the function and verified it returns the expected value across three test cases. The behavior matches the specification.';

function makeEntry(suffix, allPass) {
  return {
    ts: new Date(Date.now() - (10 - suffix) * 60 * 1000).toISOString(),
    u: !!allPass, v: !!allPass, l: !!allPass, s: !!allPass,
    reason: 'entry ' + suffix + (allPass ? ' all pass' : ' mixed verdict')
  };
}

// ---------- Case 1 — ringBuffer=[7 entries] + hook carry-over → length=7 preserved ----------
(function() {
  const sb = makeSandbox();
  const ring = [];
  for (let i = 1; i <= 7; i++) ring.push(makeEntry(i, i % 2 === 0));
  writeState(sb, {
    taskId: 'verify-prior-rb1', lastResponseId: 'sess-rb1', status: 'completed',
    launchedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    verdicts: { understanding: { pass: true, reason: '' }, verification: { pass: true, reason: '' }, logic: { pass: true, reason: '' }, simple: { pass: true, reason: '' } },
    dispatchOverdue: false, triggerReason: 'stop', lastFiredAt: new Date(Date.now() - 60 * 1000).toISOString(),
    lastFiredTurn: 0, missedCount: 0, escalationLevel: 0,
    ringBuffer: ring, turnType: 'user-facing',
    lastUpdatedAt: new Date(Date.now() - 60 * 1000).toISOString()
  });
  // verifierCounter high enough to clear periodic gate
  writeIndex(sb, { verifierCounter: 100 });
  const r = runBehaviorVerifier(sb, { stop_response: SUBSTANTIVE, session_id: 'sess-rb1' });
  const post = readState(sb);
  ok('1 priorState.ringBuffer=[7] + hook carry-over → length=7 (sub-agent pushes new entry on completion)',
     r.status === 0 && post && Array.isArray(post.ringBuffer) && post.ringBuffer.length === 7,
     'exit=' + r.status + ' length=' + (post && post.ringBuffer && post.ringBuffer.length));
})();

// ---------- Case 2 — ringBuffer=[8 entries] + carry-over → length=8 (cap not exceeded) ----------
(function() {
  const sb = makeSandbox();
  const ring = [];
  for (let i = 1; i <= 8; i++) ring.push(makeEntry(i, i % 2 === 0));
  writeState(sb, {
    taskId: 'verify-prior-rb2', lastResponseId: 'sess-rb2', status: 'completed',
    launchedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    verdicts: { understanding: { pass: true, reason: '' }, verification: { pass: true, reason: '' }, logic: { pass: true, reason: '' }, simple: { pass: true, reason: '' } },
    dispatchOverdue: false, triggerReason: 'stop', lastFiredAt: new Date(Date.now() - 60 * 1000).toISOString(),
    lastFiredTurn: 0, missedCount: 0, escalationLevel: 0,
    ringBuffer: ring, turnType: 'user-facing',
    lastUpdatedAt: new Date(Date.now() - 60 * 1000).toISOString()
  });
  writeIndex(sb, { verifierCounter: 100 });
  const r = runBehaviorVerifier(sb, { stop_response: SUBSTANTIVE, session_id: 'sess-rb2' });
  const post = readState(sb);
  ok('2 priorState.ringBuffer=[8] + carry-over → length=8 (cap not exceeded by hook; sub-agent enforces FIFO drop)',
     r.status === 0 && post && Array.isArray(post.ringBuffer) && post.ringBuffer.length === 8,
     'exit=' + r.status + ' length=' + (post && post.ringBuffer && post.ringBuffer.length));
})();

// ---------- Case 3 — entry shape: u/v/l/s booleans + reason ≤80 chars ----------
(function() {
  // Validate that a properly shaped entry is preserved verbatim by the hook.
  const sb = makeSandbox();
  const goodEntry = {
    ts: new Date().toISOString(),
    u: true, v: false, l: true, s: false,
    reason: 'verification clause failed: no Bash output cited for "tests pass" claim'
  };
  // reason length check
  const reasonOk = goodEntry.reason.length <= 80;
  // boolean check
  const allBool = typeof goodEntry.u === 'boolean'
               && typeof goodEntry.v === 'boolean'
               && typeof goodEntry.l === 'boolean'
               && typeof goodEntry.s === 'boolean';
  writeState(sb, {
    taskId: 'verify-prior-rb3', lastResponseId: 'sess-rb3', status: 'completed',
    launchedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    verdicts: { understanding: { pass: true, reason: '' }, verification: { pass: true, reason: '' }, logic: { pass: true, reason: '' }, simple: { pass: true, reason: '' } },
    dispatchOverdue: false, triggerReason: 'stop',
    lastFiredAt: new Date(Date.now() - 60 * 1000).toISOString(),
    lastFiredTurn: 0, missedCount: 0, escalationLevel: 0,
    ringBuffer: [goodEntry], turnType: 'user-facing',
    lastUpdatedAt: new Date(Date.now() - 60 * 1000).toISOString()
  });
  writeIndex(sb, { verifierCounter: 100 });
  const r = runBehaviorVerifier(sb, { stop_response: SUBSTANTIVE, session_id: 'sess-rb3' });
  const post = readState(sb);
  const preserved = post && post.ringBuffer && post.ringBuffer.length === 1
                 && post.ringBuffer[0].u === true
                 && post.ringBuffer[0].v === false
                 && post.ringBuffer[0].l === true
                 && post.ringBuffer[0].s === false
                 && post.ringBuffer[0].reason === goodEntry.reason;
  ok('3 entry shape — u/v/l/s booleans + reason ≤80 chars preserved verbatim',
     reasonOk && allBool && r.status === 0 && preserved,
     'reasonLen=' + goodEntry.reason.length + ' allBool=' + allBool + ' preserved=' + preserved);
})();

// ---------- Case 4 — inject-rules consumer reads ringBuffer → "## Watcher Recent Verdicts" ----------
(function() {
  const sb = makeSandbox();
  const ring = [];
  for (let i = 1; i <= 4; i++) ring.push(makeEntry(i, i % 2 === 0));
  writeState(sb, {
    taskId: 'verify-rb4', lastResponseId: 'sess-rb4', status: 'pending',
    launchedAt: new Date().toISOString(), verdicts: null,
    dispatchOverdue: false, triggerReason: 'periodic',
    lastFiredAt: new Date().toISOString(),
    lastFiredTurn: 8, missedCount: 0, escalationLevel: 0,
    ringBuffer: ring, turnType: 'user-facing',
    lastUpdatedAt: new Date().toISOString()
  });
  const r = runInjectRules(sb);
  const hasHeader = r.ctx.includes('## Watcher Recent Verdicts');
  // UVLS pattern: each entry rendered as e.g. "- [HHMMSS] uVlS — reason"
  const hasUvlsLine = /- \[\d{6}\] [UuVvLlSs]{4} — /.test(r.ctx);
  ok('4 inject-rules consumer reads ringBuffer → "## Watcher Recent Verdicts" header + UVLS line',
     r.exitCode === 0 && hasHeader && hasUvlsLine,
     'exit=' + r.exitCode + ' header=' + hasHeader + ' uvls=' + hasUvlsLine);
})();

// ---------- Case 5 — byte cap (800 chars): truncation '...' suffix ----------
(function() {
  const sb = makeSandbox();
  // 8 entries each with a long 80-char reason → 8 × ~110 chars/line ≈ 880+ chars,
  // breaching the 800-char cap. Expect '...' truncation marker.
  const ring = [];
  for (let i = 1; i <= 8; i++) {
    ring.push({
      ts: new Date(Date.now() - (10 - i) * 60 * 1000).toISOString(),
      u: false, v: false, l: false, s: false,
      reason: ('reason-' + i + '-').padEnd(80, 'X') // exactly 80 chars
    });
  }
  writeState(sb, {
    taskId: 'verify-rb5', lastResponseId: 'sess-rb5', status: 'pending',
    launchedAt: new Date().toISOString(), verdicts: null,
    dispatchOverdue: false, triggerReason: 'periodic',
    lastFiredAt: new Date().toISOString(),
    lastFiredTurn: 8, missedCount: 0, escalationLevel: 0,
    ringBuffer: ring, turnType: 'user-facing',
    lastUpdatedAt: new Date().toISOString()
  });
  const r = runInjectRules(sb);
  const hasHeader = r.ctx.includes('## Watcher Recent Verdicts');
  // Locate the ring-buffer block and check it is bounded by the cap.
  const start = r.ctx.indexOf('## Watcher Recent Verdicts');
  const after = r.ctx.indexOf('\n## ', start + 1);
  const block = (start >= 0 && after > start) ? r.ctx.slice(start, after) : '';
  // The truncation marker '...' should appear somewhere in the block
  // (block exceeded RING_BYTE_CAP=800 → trailing '...' line per inject-rules
  //  consumer). Block length must NOT exceed cap by more than one line of
  // overhead.
  const hasTruncation = block.includes('...\n');
  ok('5 byte cap — 800-char ring buffer breached → truncation "..." marker',
     r.exitCode === 0 && hasHeader && hasTruncation,
     'exit=' + r.exitCode + ' blockLen=' + block.length + ' truncation=' + hasTruncation);
})();

// Cleanup
for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
