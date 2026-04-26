'use strict';
/**
 * Tests for D104 IA-4 (한글 사용자 facing role rename — 감시자 / Behavior Verifier)
 * docs/manual layer changes (P136_T003 AC6).
 *
 * Covers 5 cases:
 *  1) USER-MANUAL.md contains '감시자' ≥1 occurrence (Hooks/Guards table alias)
 *  2) README.md contains '감시자' ≥1 occurrence (version table description)
 *  3) STRUCTURE.md contains '감시자' ≥1 occurrence (version table description)
 *  4) inject-rules.js contains exactly one '## 감시자 (Behavior Verifier) Dispatch Required'
 *     header (T001 verification regression — header must remain stable)
 *  5) Code-identifier byte-identical baseline preservation — pre-T003 occurrence
 *     totals for BEHAVIOR_VERIFIER_STATE_FILE / <VERIFIER_JSON> / [CRABSHELL_BEHAVIOR_VERIFY] /
 *     CRABSHELL_AGENT='behavior-verifier' / behavior-verifier.js filename must match
 *     hard-coded expected counts (T003 must add Korean text, not change identifiers)
 *
 * L3 read-only — no spawn, no side-effects. Each case reads the target file(s) and
 * counts occurrences of a literal substring.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

function readFile(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  catch (_) { return ''; }
}

function countSubstr(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

// ---------- Case 1 — USER-MANUAL.md '감시자' ≥1 ----------
(function() {
  const src = readFile('USER-MANUAL.md');
  const count = countSubstr(src, '감시자');
  ok('1 USER-MANUAL.md contains 감시자 (≥1)',
     count >= 1,
     'count=' + count);
})();

// ---------- Case 2 — README.md '감시자' ≥1 ----------
(function() {
  const src = readFile('README.md');
  const count = countSubstr(src, '감시자');
  ok('2 README.md contains 감시자 (≥1)',
     count >= 1,
     'count=' + count);
})();

// ---------- Case 3 — STRUCTURE.md '감시자' ≥1 ----------
(function() {
  const src = readFile('STRUCTURE.md');
  const count = countSubstr(src, '감시자');
  ok('3 STRUCTURE.md contains 감시자 (≥1)',
     count >= 1,
     'count=' + count);
})();

// ---------- Case 4 — inject-rules.js dispatch header exactly 1 ----------
(function() {
  const src = readFile('scripts/inject-rules.js');
  const count = countSubstr(src, '## 감시자 (Behavior Verifier) Dispatch Required');
  ok('4 inject-rules.js dispatch header "## 감시자 (Behavior Verifier) Dispatch Required" exactly 1',
     count === 1,
     'count=' + count);
})();

// ---------- Case 5 — code identifier byte-identical baseline ----------
(function() {
  // Pre-T003 baseline counts captured 2026-04-26 (post-T002 state, no T003 edits yet).
  // T003 changes ONLY: USER-MANUAL.md / README.md / STRUCTURE.md / prompts/behavior-verifier-prompt.md L1.
  // Code identifiers below MUST remain unchanged (Phase 3 carry-over for v22).
  // Files inspected use forward-slash paths for cross-platform stability.
  const targets = [
    // [identifier, [file paths], expected total count]
    [
      'BEHAVIOR_VERIFIER_STATE_FILE',
      [
        'scripts/behavior-verifier.js',
        'scripts/constants.js',
        'scripts/inject-rules.js'
      ],
      8
    ],
    [
      '<VERIFIER_JSON>',
      [
        'scripts/_prototype-measure.js',
        'prompts/behavior-verifier-prompt.md'
      ],
      6
    ],
    [
      '[CRABSHELL_BEHAVIOR_VERIFY]',
      [
        'scripts/behavior-verifier.js',
        'scripts/_test-behavior-verifier-stop.js'
      ],
      5
    ],
    [
      "CRABSHELL_AGENT='behavior-verifier'",
      [
        // pre-T003 baseline = 0 (env literal lives elsewhere, e.g. constants or unquoted)
        'scripts/behavior-verifier.js',
        'scripts/inject-rules.js'
      ],
      0
    ],
    [
      'behavior-verifier.js',
      [
        'scripts/behavior-verifier.js',
        'scripts/counter.js',
        'scripts/inject-rules.js',
        'scripts/_test-behavior-verifier-stop.js',
        'scripts/_test-dispatch-overdue-detection.js',
        'scripts/_test-fail-open-edge-cases.js',
        'scripts/_test-trigger-model.js',
        'scripts/_test-turn-classification.js',
        'scripts/_test-verdict-ring-buffer.js',
        'hooks/hooks.json',
        'prompts/behavior-verifier-prompt.md'
      ],
      22
    ]
  ];

  const breakdown = [];
  let allMatch = true;
  for (const [needle, files, expected] of targets) {
    let total = 0;
    for (const rel of files) {
      total += countSubstr(readFile(rel), needle);
    }
    breakdown.push(needle + '=' + total + '/' + expected);
    if (total !== expected) allMatch = false;
  }

  ok('5 code identifier byte-identical baseline preserved (5 identifiers)',
     allMatch,
     breakdown.join(' | '));
})();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
