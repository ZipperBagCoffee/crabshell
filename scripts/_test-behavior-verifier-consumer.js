'use strict';
/**
 * Tests for behavior-verifier consumer logic in scripts/inject-rules.js.
 *
 * Covers (P132_T003 AC-5):
 *  1) state file missing            → silent skip
 *  2) malformed JSON state file     → silent skip
 *  3) status='pending' within TTL    → dispatch instruction emitted
 *  4) status='pending' beyond TTL    → status='stale' transition, no dispatch
 *  5) status='completed' + failures  → correction emitted, status→consumed
 *  6) status='completed' + all pass  → no correction, status→consumed
 *  7) status='consumed'              → no-op
 *  8) byte cap per-item (600B)       → reason truncated to 600 + '...'
 *  9) byte cap total (1500B)         → trailing '...(truncated)' marker
 * 10) RMW race (two concurrent runs) → only ONE invocation emits correction
 *
 * Spawn-based: each case spawns inject-rules.js with a sandboxed
 * CLAUDE_PROJECT_DIR under os.tmpdir() so live .crabshell/ is untouched.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT = path.join(__dirname, 'inject-rules.js');
const NODE = process.execPath;

let passed = 0;
let failed = 0;
const tmpDirs = [];

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p132t003-consumer-'));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function writeState(sandbox, stateObj) {
  const p = path.join(sandbox, '.crabshell', 'memory', 'behavior-verifier-state.json');
  fs.writeFileSync(p, JSON.stringify(stateObj, null, 2), 'utf8');
}

function writeRawState(sandbox, raw) {
  const p = path.join(sandbox, '.crabshell', 'memory', 'behavior-verifier-state.json');
  fs.writeFileSync(p, raw, 'utf8');
}

function readState(sandbox) {
  const p = path.join(sandbox, '.crabshell', 'memory', 'behavior-verifier-state.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function runInjectRules(sandbox, prompt) {
  const env = Object.assign({}, process.env, {
    CLAUDE_PROJECT_DIR: sandbox,
    CRABSHELL_BACKGROUND: '' // ensure not skipped
  });
  delete env.CRABSHELL_BACKGROUND;
  const input = JSON.stringify({ prompt: prompt || 'test prompt' });
  const result = spawnSync(NODE, [SCRIPT], {
    input, timeout: 10000, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], env
  });
  let parsed = null;
  try { parsed = JSON.parse(result.stdout || '{}'); } catch { parsed = null; }
  const ctx = (parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext) || '';
  return { exitCode: result.status, stdout: result.stdout || '', stderr: result.stderr || '', ctx };
}

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

// Test 1 — missing state file
(function() {
  const sb = makeSandbox();
  const r = runInjectRules(sb);
  const noDispatch = !r.ctx.includes('Behavior Verifier Dispatch Required');
  const noCorrection = !r.ctx.includes('Behavior Correction');
  ok('1 missing state file → silent skip', r.exitCode === 0 && noDispatch && noCorrection,
     'exit=' + r.exitCode + ' dispatch=' + r.ctx.includes('Behavior Verifier Dispatch Required'));
})();

// Test 2 — malformed JSON state file
(function() {
  const sb = makeSandbox();
  writeRawState(sb, '{not valid json');
  const r = runInjectRules(sb);
  const noDispatch = !r.ctx.includes('Behavior Verifier Dispatch Required');
  const noCorrection = !r.ctx.includes('Behavior Correction');
  ok('2 malformed JSON → silent skip', r.exitCode === 0 && noDispatch && noCorrection);
})();

// Test 3 — pending within TTL → dispatch
(function() {
  const sb = makeSandbox();
  writeState(sb, {
    taskId: 'verify-1', lastResponseId: 'sess-1', status: 'pending',
    launchedAt: new Date().toISOString(), verdicts: null,
    lastUpdatedAt: new Date().toISOString()
  });
  const r = runInjectRules(sb);
  const has = r.ctx.includes('Behavior Verifier Dispatch Required')
           && r.ctx.includes('subagent_type: general-purpose')
           && r.ctx.includes('CRABSHELL_AGENT=behavior-verifier');
  ok('3 pending within TTL → dispatch instruction', r.exitCode === 0 && has);
})();

// Test 4 — pending beyond TTL → stale transition
(function() {
  const sb = makeSandbox();
  const oldIso = new Date(Date.now() - 11 * 60 * 1000).toISOString(); // 11min ago
  writeState(sb, {
    taskId: 'verify-2', lastResponseId: 'sess-2', status: 'pending',
    launchedAt: oldIso, verdicts: null, lastUpdatedAt: oldIso
  });
  const r = runInjectRules(sb);
  const post = readState(sb);
  const noDispatch = !r.ctx.includes('Behavior Verifier Dispatch Required');
  ok('4 pending beyond TTL → status=stale, no dispatch',
     r.exitCode === 0 && noDispatch && post && post.status === 'stale');
})();

// Test 5 — completed with failures → correction + transition consumed
(function() {
  const sb = makeSandbox();
  writeState(sb, {
    taskId: 'verify-3', lastResponseId: 'sess-3', status: 'completed',
    launchedAt: new Date().toISOString(),
    verdicts: {
      understanding: { pass: false, reason: 'no intent restatement' },
      verification: { pass: false, reason: 'no Bash output cited' },
      logic: { pass: true, reason: 'derivation shown' },
      simple: { pass: true, reason: 'concise' }
    },
    lastUpdatedAt: new Date().toISOString()
  });
  const r = runInjectRules(sb);
  const has = r.ctx.includes('Behavior Correction')
           && r.ctx.includes('- understanding:')
           && r.ctx.includes('- verification:')
           && !r.ctx.includes('- logic:')
           && !r.ctx.includes('- simple:');
  const post = readState(sb);
  ok('5 completed + failures → correction + status=consumed',
     r.exitCode === 0 && has && post && post.status === 'consumed');
})();

// Test 6 — completed with all pass → no correction, transition consumed
(function() {
  const sb = makeSandbox();
  writeState(sb, {
    taskId: 'verify-4', lastResponseId: 'sess-4', status: 'completed',
    launchedAt: new Date().toISOString(),
    verdicts: {
      understanding: { pass: true, reason: 'ok' },
      verification: { pass: true, reason: 'ok' },
      logic: { pass: true, reason: 'ok' },
      simple: { pass: true, reason: 'ok' }
    },
    lastUpdatedAt: new Date().toISOString()
  });
  const r = runInjectRules(sb);
  const noCorrection = !r.ctx.includes('Behavior Correction');
  const post = readState(sb);
  ok('6 completed + all pass → no correction, status=consumed',
     r.exitCode === 0 && noCorrection && post && post.status === 'consumed');
})();

// Test 7 — already consumed → no-op
(function() {
  const sb = makeSandbox();
  writeState(sb, {
    taskId: 'verify-5', lastResponseId: 'sess-5', status: 'consumed',
    launchedAt: new Date().toISOString(),
    verdicts: { understanding: { pass: false, reason: 'old' }, verification: { pass: true, reason: '' }, logic: { pass: true, reason: '' }, simple: { pass: true, reason: '' } },
    lastUpdatedAt: new Date().toISOString()
  });
  const r = runInjectRules(sb);
  const noDispatch = !r.ctx.includes('Behavior Verifier Dispatch Required');
  const noCorrection = !r.ctx.includes('Behavior Correction');
  ok('7 already consumed → no-op', r.exitCode === 0 && noDispatch && noCorrection);
})();

// Test 8 — per-item byte cap (600B)
(function() {
  const sb = makeSandbox();
  writeState(sb, {
    taskId: 'verify-6', lastResponseId: 'sess-6', status: 'completed',
    launchedAt: new Date().toISOString(),
    verdicts: {
      understanding: { pass: false, reason: 'A'.repeat(800) },
      verification: { pass: true, reason: 'ok' },
      logic: { pass: true, reason: 'ok' },
      simple: { pass: true, reason: 'ok' }
    },
    lastUpdatedAt: new Date().toISOString()
  });
  const r = runInjectRules(sb);
  // Find the line that contains the truncated reason
  const m = r.ctx.match(/- understanding: (A+)\.\.\.\n/);
  ok('8 per-item 600B cap → reason truncated to 600 + ...',
     r.exitCode === 0 && m && m[1].length === 600,
     'matched=' + (m ? m[1].length : 'no-match'));
})();

// Test 9 — total 1500B cap
(function() {
  const sb = makeSandbox();
  writeState(sb, {
    taskId: 'verify-7', lastResponseId: 'sess-7', status: 'completed',
    launchedAt: new Date().toISOString(),
    verdicts: {
      understanding: { pass: false, reason: 'B'.repeat(500) },
      verification: { pass: false, reason: 'B'.repeat(500) },
      logic: { pass: false, reason: 'B'.repeat(500) },
      simple: { pass: false, reason: 'B'.repeat(500) }
    },
    lastUpdatedAt: new Date().toISOString()
  });
  const r = runInjectRules(sb);
  const trunc = r.ctx.includes('...(truncated)');
  // Count emitted "- " lines inside the correction block
  const idx = r.ctx.indexOf('## Behavior Correction');
  const block = idx >= 0 ? r.ctx.slice(idx) : '';
  // Stop at next "## " heading (excluding the correction header itself)
  const endIdx = block.indexOf('\n## ', 5);
  const corr = endIdx >= 0 ? block.slice(0, endIdx) : block;
  const lineCount = (corr.match(/\n- /g) || []).length;
  ok('9 total 1500B cap → ≤3 lines + (truncated) marker',
     r.exitCode === 0 && trunc && lineCount <= 3,
     'lineCount=' + lineCount + ' trunc=' + trunc);
})();

// Test 10 — RMW race: two concurrent invocations against the same state file.
// Expectation: exactly ONE invocation emits the correction.
(function() {
  const sb = makeSandbox();
  writeState(sb, {
    taskId: 'verify-8', lastResponseId: 'sess-8', status: 'completed',
    launchedAt: new Date().toISOString(),
    verdicts: {
      understanding: { pass: false, reason: 'race test' },
      verification: { pass: true, reason: 'ok' },
      logic: { pass: true, reason: 'ok' },
      simple: { pass: true, reason: 'ok' }
    },
    lastUpdatedAt: new Date().toISOString()
  });

  // Launch both children in parallel-ish then await both.
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sb });
  delete env.CRABSHELL_BACKGROUND;
  const input = JSON.stringify({ prompt: 'race' });
  const { spawn } = require('child_process');

  function runAsync() {
    return new Promise(function(resolve) {
      const p = spawn(NODE, [SCRIPT], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let so = ''; p.stdout.on('data', function(d){ so += d; });
      p.stderr.on('data', function(){});
      p.on('close', function(code) {
        let parsed = null;
        try { parsed = JSON.parse(so || '{}'); } catch {}
        const ctx = (parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext) || '';
        resolve({ code: code, ctx: ctx });
      });
      p.stdin.end(input);
    });
  }

  Promise.all([runAsync(), runAsync()]).then(function(results) {
    const emits = results.filter(function(r){ return r.ctx.indexOf('Behavior Correction') >= 0; }).length;
    const post = readState(sb);
    // Exactly one of the two should emit; the state must be 'consumed' afterwards.
    ok('10 RMW race: exactly ONE emit, status=consumed',
       emits === 1 && post && post.status === 'consumed',
       'emits=' + emits + ' status=' + (post && post.status));
    finalize();
  });
})();

function finalize() {
  // Cleanup
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
  process.exit(failed > 0 ? 1 : 0);
}
