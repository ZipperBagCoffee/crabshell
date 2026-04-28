'use strict';
/**
 * D107 cycle 1 (P143_T001 WA3) — inject-rules.js enhancement regression tests.
 *
 * Covers WA1 + WA2 implementations via E2E spawn (sandboxed CLAUDE_PROJECT_DIR
 * + priorState fixture). Assertions mirror authored constants byte-for-byte
 * — NOT designed from source specs (string-byte parity per P143 Cross-Review
 * Decision condition 3).
 *
 * Cases:
 *  1) 5-field skeleton — all 5 Korean markers ([의도]/[이해]/[검증]/[논리]/[쉬운 설명])
 *     present (AND form, not OR — per P143 Cross-Review fix).
 *  2) anti-patterns inline — 9 PROHIBITED key Korean phrases + 4 AVOID Korean
 *     phrases all present.
 *  3) ringBuffer FAIL surface — fresh u/l FAIL fixture → header + HH:MM:SS data
 *     line + position before [의도].
 *  3a) PASS-only last entry → no FAIL surface.
 *  3b) empty ringBuffer → no FAIL surface.
 *  3c) no behavior-verifier-state.json → no FAIL surface.
 *  3d) stale (>30 min) last entry → no FAIL surface (TTL gate).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE = process.execPath;
const IR_SCRIPT = path.join(__dirname, 'inject-rules.js');

let passed = 0;
let failed = 0;
const tmpDirs = [];

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd107-cycle1-inject-'));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function statePath(sandbox) {
  return path.join(sandbox, '.crabshell', 'memory', 'behavior-verifier-state.json');
}

function writeState(sandbox, state) {
  fs.writeFileSync(statePath(sandbox), JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Spawn inject-rules.js with sandboxed CLAUDE_PROJECT_DIR. Returns the
 * additionalContext string from JSON stdout (or '' on parse failure).
 * env scoping per RA3 — CRABSHELL_BACKGROUND must be deleted to permit
 * non-background execution path.
 */
function runInjectRules(sandbox) {
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sandbox });
  delete env.CRABSHELL_BACKGROUND;
  const result = spawnSync(NODE, [IR_SCRIPT], {
    input: JSON.stringify({ prompt: 'next turn' }),
    timeout: 10000,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env
  });
  let parsed = null;
  try { parsed = JSON.parse(result.stdout || '{}'); } catch (_) {}
  const ctx = (parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext) || '';
  return { exitCode: result.status, ctx, stdout: result.stdout, stderr: result.stderr };
}

function ok(name, cond, detail) {
  if (cond) {
    console.log('PASS:' + name);
    passed++;
  } else {
    console.log('FAIL:' + name + (detail ? ' -- ' + detail : ''));
    failed++;
  }
}

// ---------- Case 1 — 5-field skeleton Korean markers (AND form) ----------
(function() {
  const sb = makeSandbox();
  // No state file — focus on always-present skeleton.
  const r = runInjectRules(sb);
  const markers = ['[의도]', '[이해]', '[검증]', '[논리]', '[쉬운 설명]'];
  const missing = markers.filter(m => !r.ctx.includes(m));
  ok('1 5-field skeleton — all 5 Korean markers present (AND)',
     r.exitCode === 0 && missing.length === 0,
     'exit=' + r.exitCode + ' missing=' + JSON.stringify(missing) + ' ctx_len=' + r.ctx.length);
})();

// ---------- Case 2 — anti-patterns inline Korean phrases ----------
// Phrase anchors extracted byte-for-byte from WA1's authored
// ANTI_PATTERNS_INLINE constant (scripts/inject-rules.js L329-349).
(function() {
  const sb = makeSandbox();
  const r = runInjectRules(sb);
  // 9 PROHIBITED key phrases (Korean exact, from authored constant body).
  const prohibitedPhrases = [
    'Scope reduction without approval',           // #1
    "'Verified' without Bash",                    // #2
    'Agreement without evidence',                 // #3
    'Same fix repeated',                          // #4
    'Prediction = Observation verbatim',          // #5
    "'Takes too long' justification",             // #6
    'Suggesting to stop/defer',                   // #7
    'Direction change without stated reasoning',  // #8
    'Default-First (Externalization Avoidance)'   // #9
  ];
  // 4 AVOID phrases (Korean exact).
  const avoidPhrases = [
    'AVOID-1. Analogy 회귀',
    'AVOID-2. Regex 측정 신호',
    'AVOID-3. User catch 신호',
    'AVOID-4. Measurement system 전반'
  ];
  const allPhrases = prohibitedPhrases.concat(avoidPhrases);
  const missing = allPhrases.filter(p => !r.ctx.includes(p));
  ok('2 anti-patterns inline — 9 PROHIBITED + 4 AVOID Korean phrases present',
     r.exitCode === 0 && missing.length === 0,
     'exit=' + r.exitCode + ' missing=' + JSON.stringify(missing));
})();

// ---------- Case 3 — ringBuffer FAIL surface (fresh, multi-axis) ----------
(function() {
  const sb = makeSandbox();
  const ts = '2026-04-27T10:05:00.000Z';
  // Set ts to recent (within TTL) — use now-1min for freshness, but keep
  // HH:MM:SS substring deterministic by anchoring assertions on the actual
  // emitted slice from the fixture ts. To pass TTL gate (30 min), we must
  // pick a ts within the last 30 min — use ISO of (now - 1 min) and assert
  // the HH:MM:SS slice from it.
  const freshTs = new Date(Date.now() - 60 * 1000).toISOString();
  const expectedHHMMSS = freshTs.slice(11, 19);
  const reason = 'intent drift + logic skip';
  writeState(sb, {
    ringBuffer: [{ ts: freshTs, u: false, l: false, v: true, s: true, reason }],
    status: 'completed'
  });
  const r = runInjectRules(sb);
  const expectedDataLine = '[' + expectedHHMMSS + '] FAIL u/l — ' + reason;
  const hasHeader = r.ctx.includes('## Prior Verifier FAIL — apply correction this turn');
  const hasDataLine = r.ctx.includes(expectedDataLine);
  // Position assertion — surface MUST appear before [의도] (top-prepend).
  const surfacePos = r.ctx.indexOf('## Prior Verifier FAIL');
  const skeletonPos = r.ctx.indexOf('[의도]');
  const positionOk = surfacePos >= 0 && skeletonPos > surfacePos;
  ok('3 ringBuffer FAIL surface — header + HH:MM:SS data line + top-prepend before [의도]',
     r.exitCode === 0 && hasHeader && hasDataLine && positionOk,
     'exit=' + r.exitCode + ' header=' + hasHeader + ' dataLine=' + hasDataLine
     + ' surfacePos=' + surfacePos + ' skeletonPos=' + skeletonPos
     + ' expectedDataLine=' + JSON.stringify(expectedDataLine));
  // ts param is unused in current assertion (kept for ref); avoid lint warning.
  void ts;
})();

// ---------- Case 3a — PASS-only last entry → no FAIL surface ----------
(function() {
  const sb = makeSandbox();
  const freshTs = new Date(Date.now() - 60 * 1000).toISOString();
  writeState(sb, {
    ringBuffer: [{ ts: freshTs, u: true, v: true, l: true, s: true, reason: 'all pass' }],
    status: 'completed'
  });
  const r = runInjectRules(sb);
  const noSurface = !r.ctx.includes('## Prior Verifier FAIL');
  ok('3a PASS-only last entry → no FAIL surface',
     r.exitCode === 0 && noSurface,
     'exit=' + r.exitCode + ' noSurface=' + noSurface);
})();

// ---------- Case 3b — empty ringBuffer → no FAIL surface ----------
(function() {
  const sb = makeSandbox();
  writeState(sb, { ringBuffer: [], status: 'completed' });
  const r = runInjectRules(sb);
  const noSurface = !r.ctx.includes('## Prior Verifier FAIL');
  ok('3b empty ringBuffer → no FAIL surface',
     r.exitCode === 0 && noSurface,
     'exit=' + r.exitCode + ' noSurface=' + noSurface);
})();

// ---------- Case 3c — no behavior-verifier-state.json → no FAIL surface ----------
(function() {
  const sb = makeSandbox();
  // Intentionally no writeState call.
  const r = runInjectRules(sb);
  const noSurface = !r.ctx.includes('## Prior Verifier FAIL');
  ok('3c no priorState file → no FAIL surface',
     r.exitCode === 0 && noSurface,
     'exit=' + r.exitCode + ' noSurface=' + noSurface);
})();

// ---------- Case 3d — stale (>30 min) → no FAIL surface (TTL gate) ----------
(function() {
  const sb = makeSandbox();
  const staleTs = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  writeState(sb, {
    ringBuffer: [{ ts: staleTs, u: false, v: true, l: true, s: true, reason: 'stale fail' }],
    status: 'completed'
  });
  const r = runInjectRules(sb);
  const noSurface = !r.ctx.includes('## Prior Verifier FAIL');
  ok('3d stale >30min last entry → no FAIL surface (TTL gate)',
     r.exitCode === 0 && noSurface,
     'exit=' + r.exitCode + ' noSurface=' + noSurface);
})();

// Cleanup
for (const d of tmpDirs) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
}

const total = passed + failed;
console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + total);
process.exit(failed > 0 ? 1 : 0);
