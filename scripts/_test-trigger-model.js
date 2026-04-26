'use strict';
/**
 * Tests for D104 IA-1 — trigger 3-layer model in behavior-verifier.js.
 *
 * Covers (5 cases per ticket P136_T001 AC11):
 *  1) workflow inactive, recently fired (lastFiredTurn=5, verifierCounter=10,
 *     INTERVAL=8) → SKIP (state file unchanged from prior)
 *  2) workflow inactive, idle ≥ INTERVAL (lastFiredTurn=5, verifierCounter=14)
 *     → FIRE (state pending write, lastFiredTurn=14)
 *  3) regressing-state.active=true + length<50 → FIRE (workflow-active force
 *     bypasses length<50 + clarification bypass)
 *  4) dispatchOverdue=true, missedCount transitions 0 → 1 (escalationLevel=0
 *     i.e. L0 marker — `min(2, missedCount)` semantics)
 *  5) priorState.missedCount=1 + dispatchOverdue=true → missedCount=2,
 *     escalationLevel=Math.min(2, 2)=2 (alias L1 marker per inject-rules
 *     consumer)
 *
 * Spawn-based: each case sandboxes CLAUDE_PROJECT_DIR under os.tmpdir().
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p136t001-trigger-'));
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

function regressingStatePath(sandbox) {
  return path.join(sandbox, '.crabshell', 'memory', 'regressing-state.json');
}

function writeIndex(sandbox, idx) {
  fs.writeFileSync(indexPath(sandbox), JSON.stringify(idx, null, 2), 'utf8');
}

function writeState(sandbox, state) {
  fs.writeFileSync(statePath(sandbox), JSON.stringify(state, null, 2), 'utf8');
}

function readState(sandbox) {
  const p = statePath(sandbox);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function runStop(sandbox, hookData, extraEnv) {
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sandbox }, extraEnv || {});
  delete env.CRABSHELL_BACKGROUND;
  delete env.CRABSHELL_AGENT;
  const input = JSON.stringify(hookData);
  return spawnSync(NODE, [SCRIPT], {
    input, timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env
  });
}

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

const SUBSTANTIVE = 'I have implemented the function and verified it returns the expected value across three test cases. The behavior matches the specification.';
const SHORT = 'Done.';

// ---------- Case 1 — periodic skip ----------
(function() {
  const sb = makeSandbox();
  const PRIOR = {
    taskId: 'verify-prior-c1', lastResponseId: 'sess-c1', status: 'completed',
    launchedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    verdicts: { understanding: { pass: true, reason: '' }, verification: { pass: true, reason: '' }, logic: { pass: true, reason: '' }, simple: { pass: true, reason: '' } },
    dispatchOverdue: false,
    triggerReason: 'stop',
    lastFiredAt: new Date(Date.now() - 60 * 1000).toISOString(),
    lastFiredTurn: 5,
    missedCount: 0,
    escalationLevel: 0,
    ringBuffer: [],
    turnType: 'user-facing',
    lastUpdatedAt: new Date(Date.now() - 60 * 1000).toISOString()
  };
  writeState(sb, PRIOR);
  // verifierCounter=10, lastFiredTurn=5, INTERVAL=8 → 10 < 5+8=13 → skip
  writeIndex(sb, { verifierCounter: 10 });
  const r = runStop(sb, { stop_response: SUBSTANTIVE, session_id: 'sess-c1' });
  const post = readState(sb);
  // skip = state file unchanged: lastFiredTurn still 5, status still 'completed'
  ok('1 workflow inactive, recently fired → SKIP (state unchanged)',
     r.status === 0 && post && post.lastFiredTurn === 5 && post.status === 'completed' && post.taskId === 'verify-prior-c1',
     'exit=' + r.status + ' state=' + JSON.stringify(post));
})();

// ---------- Case 2 — periodic fire ----------
(function() {
  const sb = makeSandbox();
  const PRIOR = {
    taskId: 'verify-prior-c2', lastResponseId: 'sess-c2', status: 'completed',
    launchedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    verdicts: { understanding: { pass: true, reason: '' }, verification: { pass: true, reason: '' }, logic: { pass: true, reason: '' }, simple: { pass: true, reason: '' } },
    dispatchOverdue: false,
    triggerReason: 'stop',
    lastFiredAt: new Date(Date.now() - 60 * 1000).toISOString(),
    lastFiredTurn: 5,
    missedCount: 0,
    escalationLevel: 0,
    ringBuffer: [],
    turnType: 'user-facing',
    lastUpdatedAt: new Date(Date.now() - 60 * 1000).toISOString()
  };
  writeState(sb, PRIOR);
  // verifierCounter=14, lastFiredTurn=5, INTERVAL=8 → 14 >= 5+8=13 → fire
  writeIndex(sb, { verifierCounter: 14 });
  const r = runStop(sb, { stop_response: SUBSTANTIVE, session_id: 'sess-c2' });
  const post = readState(sb);
  ok('2 workflow inactive, idle ≥ INTERVAL → FIRE (state pending, lastFiredTurn=14)',
     r.status === 0 && post && post.status === 'pending' && post.lastFiredTurn === 14
     && (post.triggerReason === 'periodic' || post.triggerReason === 'stop'),
     'exit=' + r.status + ' state=' + JSON.stringify(post));
})();

// ---------- Case 3 — regressing active + length<50 → FIRE (force) ----------
(function() {
  const sb = makeSandbox();
  // regressing-state.active=true makes workflowActive=true → length<50 bypass ignored.
  fs.writeFileSync(regressingStatePath(sb), JSON.stringify({
    active: true, topic: 'D104', cycleCap: 10, cycleNum: 1
  }, null, 2), 'utf8');
  // No prior state → first fire ever, but workflow-active forces fire even on
  // length<50 SHORT response.
  writeIndex(sb, { verifierCounter: 1 });
  const r = runStop(sb, { stop_response: SHORT, session_id: 'sess-c3' });
  const post = readState(sb);
  // Note: turnType='trivial' here because classifyTurnType cascade checks
  // length<50 ('trivial') BEFORE workflowActive ('workflow-internal'). The
  // FIRE itself is what's gated by workflowActive (bypass override) — trigger
  // succeeds, triggerReason='workflow-active'. turnType is the orthogonal
  // labelling for prompt-side conditional gating.
  ok('3 regressing active + length<50 → FIRE (workflow-active force, trigger gate overridden)',
     r.status === 0 && post && post.status === 'pending'
     && post.triggerReason === 'workflow-active',
     'exit=' + r.status + ' state=' + JSON.stringify(post));
})();

// ---------- Case 4 — dispatchOverdue → missedCount 0→1, escalationLevel=1 (L0 marker) ----------
(function() {
  const sb = makeSandbox();
  const priorIso = new Date(Date.now() - 60 * 1000).toISOString();
  // Prior pending + no Task call in transcript → dispatchOverdue=true
  const PRIOR = {
    taskId: 'verify-prior-c4', lastResponseId: 'sess-c4', status: 'pending',
    launchedAt: priorIso, verdicts: null,
    dispatchOverdue: false,
    triggerReason: 'stop',
    lastFiredAt: priorIso,
    lastFiredTurn: 0,
    missedCount: 0,
    escalationLevel: 0,
    ringBuffer: [],
    turnType: 'user-facing',
    lastUpdatedAt: priorIso
  };
  writeState(sb, PRIOR);
  // Empty transcript (no Task tool_use since priorIso) → dispatchOverdue triggers
  const tp = path.join(sb, 'transcript.jsonl');
  fs.writeFileSync(tp, JSON.stringify({
    type: 'assistant', timestamp: new Date().toISOString(),
    message: { content: [{ type: 'text', text: 'just text, no Task' }] }
  }) + '\n', 'utf8');
  // verifierCounter=20 (large enough to clear periodic gate)
  writeIndex(sb, { verifierCounter: 20 });
  const r = runStop(sb, {
    stop_response: SUBSTANTIVE, session_id: 'sess-c4', transcript_path: tp
  });
  const post = readState(sb);
  ok('4 dispatchOverdue=true, missedCount 0→1, escalationLevel=1 (L0 marker)',
     r.status === 0 && post && post.dispatchOverdue === true
     && post.missedCount === 1 && post.escalationLevel === 1,
     'exit=' + r.status + ' state=' + JSON.stringify(post));
})();

// ---------- Case 5 — missedCount=1 → 2, escalationLevel=2 (L1 marker) ----------
(function() {
  const sb = makeSandbox();
  const priorIso = new Date(Date.now() - 60 * 1000).toISOString();
  const PRIOR = {
    taskId: 'verify-prior-c5', lastResponseId: 'sess-c5', status: 'pending',
    launchedAt: priorIso, verdicts: null,
    dispatchOverdue: true,
    triggerReason: 'escalation',
    lastFiredAt: priorIso,
    lastFiredTurn: 0,
    missedCount: 1,
    escalationLevel: 1,
    ringBuffer: [],
    turnType: 'user-facing',
    lastUpdatedAt: priorIso
  };
  writeState(sb, PRIOR);
  // Empty transcript → dispatchOverdue continues, missedCount 1→2.
  const tp = path.join(sb, 'transcript.jsonl');
  fs.writeFileSync(tp, JSON.stringify({
    type: 'assistant', timestamp: new Date().toISOString(),
    message: { content: [{ type: 'text', text: 'still no Task' }] }
  }) + '\n', 'utf8');
  writeIndex(sb, { verifierCounter: 20 });
  const r = runStop(sb, {
    stop_response: SUBSTANTIVE, session_id: 'sess-c5', transcript_path: tp
  });
  const post = readState(sb);
  ok('5 missedCount=1 → 2, escalationLevel=2 (L1 marker semantics)',
     r.status === 0 && post && post.dispatchOverdue === true
     && post.missedCount === 2 && post.escalationLevel === 2,
     'exit=' + r.status + ' state=' + JSON.stringify(post));
})();

// Cleanup
for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
