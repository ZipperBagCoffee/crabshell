'use strict';
/**
 * Tests for D104 IA-3 (Q4=a) — deferral-guard.js stderr message consistency
 * with sycophancy-guard.js Stop branches (P136_T002 AC5).
 *
 * Covers 5 cases:
 *  1) trailing `?`-only response with analysis body → stderr starts with
 *     `[BEHAVIOR-WARN]` + exit code 0 (warn-only preserved)
 *  2) stderr ends with `retroactively correct in next turn)` 후행구
 *  3) stderr includes `sub-agent verifier §3.logic Trailing-deferral sub-clause`
 *     reference (the cross-clause pointer)
 *  4) regression — `hasAnalysisBody=false` (≤4 lines, no analysis body) →
 *     no stderr emit (silent OK), still exit code 0
 *  5) cross-file consistency — sycophancy-guard.js 4 Stop branches (oscillation /
 *     too-good / context-length / agreement) and deferral-guard.js share the
 *     `[BEHAVIOR-WARN]` prefix and `retroactively correct in next turn` 후행구
 *
 * Spawn-based: each Stop hook case spawns deferral-guard.js with mock stdin,
 * captures stderr substring + exit code.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, 'deferral-guard.js');
const SYC_SCRIPT = path.join(__dirname, 'sycophancy-guard.js');
const NODE = process.execPath;

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

function runDeferral(hookData) {
  const env = Object.assign({}, process.env);
  delete env.CRABSHELL_BACKGROUND;
  delete env.CRABSHELL_AGENT;
  const input = JSON.stringify(hookData);
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

// Build a substantive 5-line analysis response that ends with a deferral question.
// Each line is non-empty so hasAnalysisBody() returns true.
const ANALYSIS_WITH_DEFERRAL =
  'Here is the analysis of the change:\n' +
  'First, the configuration was updated.\n' +
  'Second, the test coverage now includes edge cases.\n' +
  'Third, the documentation has been refreshed.\n' +
  'Fourth, performance benchmarks show no regression.\n' +
  'Shall I proceed?';

// Short response — only 3 non-empty lines, hasAnalysisBody=false.
const SHORT_NO_ANALYSIS =
  'Step 1 done.\n' +
  'Step 2 done.\n' +
  'Should I do step 3?';

// ---------- Case 1 — [BEHAVIOR-WARN] prefix + exit code 0 ----------
(function() {
  const r = runDeferral({ stop_response: ANALYSIS_WITH_DEFERRAL });
  const hasPrefix = r.stderr.startsWith('[BEHAVIOR-WARN]');
  const exitedZero = r.exitCode === 0;
  ok('1 trailing deferral with analysis body → [BEHAVIOR-WARN] prefix + exit 0',
     hasPrefix && exitedZero,
     'exit=' + r.exitCode + ' stderr=' + JSON.stringify(r.stderr.slice(0, 200)));
})();

// ---------- Case 2 — retroactive 후행구 ----------
(function() {
  const r = runDeferral({ stop_response: ANALYSIS_WITH_DEFERRAL });
  const hasSuffix = r.stderr.trimEnd().endsWith('retroactively correct in next turn)');
  ok('2 stderr ends with retroactive 후행구',
     hasSuffix,
     'stderr=' + JSON.stringify(r.stderr.slice(-120)));
})();

// ---------- Case 3 — §3.logic Trailing-deferral sub-clause reference ----------
(function() {
  const r = runDeferral({ stop_response: ANALYSIS_WITH_DEFERRAL });
  const hasRef = r.stderr.includes('sub-agent verifier §3.logic Trailing-deferral sub-clause');
  ok('3 stderr cites §3.logic Trailing-deferral sub-clause',
     hasRef,
     'stderr=' + JSON.stringify(r.stderr.slice(0, 240)));
})();

// ---------- Case 4 — regression: hasAnalysisBody=false → silent OK ----------
(function() {
  const r = runDeferral({ stop_response: SHORT_NO_ANALYSIS });
  const silent = !r.stderr.includes('[BEHAVIOR-WARN]');
  const exitedZero = r.exitCode === 0;
  ok('4 hasAnalysisBody=false (≤4 lines) → silent + exit 0 (regression)',
     silent && exitedZero,
     'exit=' + r.exitCode + ' stderr=' + JSON.stringify(r.stderr.slice(0, 200)));
})();

// ---------- Case 5 — cross-file consistency with sycophancy-guard.js ----------
(function() {
  // L1: read sycophancy-guard.js source, locate the 4 Stop-branch warn-only
  // emissions and verify each carries the [BEHAVIOR-WARN] prefix and the
  // `retroactively correct in next turn` suffix. Then verify deferral-guard.js
  // shares both substrings (cross-file substring grep).
  let sycSrc = '';
  let dfSrc = '';
  try { sycSrc = fs.readFileSync(SYC_SCRIPT, 'utf8'); } catch (_) {}
  try { dfSrc = fs.readFileSync(SCRIPT, 'utf8'); } catch (_) {}

  // Find every stderr.write line emitted with [BEHAVIOR-WARN] prefix in the Stop
  // branches of sycophancy-guard.js. Count occurrences.
  const sycBehaviorWarnLines = sycSrc
    .split('\n')
    .filter(l => l.includes('process.stderr.write') && l.includes('[BEHAVIOR-WARN]'));
  const sycSuffixHits = sycBehaviorWarnLines
    .filter(l => l.includes('retroactively correct in next turn'));

  // The 4 expected branches: oscillation / too-good / context-length / agreement.
  // Each writes a [BEHAVIOR-WARN] line with the suffix. Allow ≥4 (some branches
  // may have additional retry-limit lines that lack the suffix).
  const sycPrefixCountOk = sycBehaviorWarnLines.length >= 4;
  const sycSuffixCountOk = sycSuffixHits.length >= 4;

  // deferral-guard.js: exactly one [BEHAVIOR-WARN] line, with the suffix.
  const dfPrefix = dfSrc.includes("'[BEHAVIOR-WARN]") ||
                   dfSrc.includes('"[BEHAVIOR-WARN]') ||
                   dfSrc.includes('[BEHAVIOR-WARN]');
  const dfSuffix = dfSrc.includes('retroactively correct in next turn');

  // Behavioral confirmation: spawn deferral-guard with the analysis-with-deferral
  // input → stderr has both prefix and suffix.
  const r = runDeferral({ stop_response: ANALYSIS_WITH_DEFERRAL });
  const dfRuntimePrefix = r.stderr.includes('[BEHAVIOR-WARN]');
  const dfRuntimeSuffix = r.stderr.includes('retroactively correct in next turn');

  const allOk = sycPrefixCountOk && sycSuffixCountOk && dfPrefix && dfSuffix
                && dfRuntimePrefix && dfRuntimeSuffix;
  ok('5 cross-file consistency — sycophancy 4 branches + deferral share [BEHAVIOR-WARN] prefix + retroactive 후행구',
     allOk,
     'sycPrefix=' + sycBehaviorWarnLines.length + ' sycSuffix=' + sycSuffixHits.length
     + ' dfPrefix=' + dfPrefix + ' dfSuffix=' + dfSuffix
     + ' dfRuntimePrefix=' + dfRuntimePrefix + ' dfRuntimeSuffix=' + dfRuntimeSuffix);
})();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
