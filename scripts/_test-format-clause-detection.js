'use strict';
/**
 * Tests for D103 cycle 2 §1.understanding format-marker sub-clause text
 * presence (P135_T001 AC-7).
 *
 * The behavioral L1 (verifier sub-agent FAIL on missing markers) is cycle 3+
 * scope (P134 DA-2 analog). This test file is L3 — structural grep that the
 * sub-clause text matches the current 7-field Korean skeleton.
 *
 * 5 cases:
 *  1) Current 7 Korean markers all present in §1.understanding
 *  2) Stale bilingual marker set is absent from §1.understanding
 *  3) Length threshold "200" appears with sub-clause keyword
 *  4) "Format markers" / 7-marker / FAIL semantics present
 *  5) Mock current 7-field response fixture sanity check
 */

const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'behavior-verifier-prompt.md');

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

const text = fs.readFileSync(PROMPT_PATH, 'utf8');

// Locate §1.understanding body so checks are scoped correctly.
const start = text.indexOf('### 1. understanding');
const end = text.indexOf('### 2. verification');
const sec1 = (start >= 0 && end > start) ? text.slice(start, end) : '';

const CURRENT_MARKERS = ['[의도]', '[이해]', '[검증]', '[논리]', '[쉬운 설명]', '[동조화 및 일관성]', '[완결 충동]'];

// ---------- Test 1 — current Korean markers all present ----------
(function() {
  const missing = CURRENT_MARKERS.filter(m => !sec1.includes(m));
  ok('1 §1.understanding contains current 7 Korean markers', missing.length === 0,
     'missing=' + missing.join(', ') + ' sec1 first 200 = ' + sec1.slice(0, 200));
})();

// ---------- Test 2 — stale bilingual markers removed ----------
(function() {
  const stale = ['[답]', '[자기 평가]', '[Intent]', '[Answer]', '[Self-Assessment]'].filter(m => sec1.includes(m));
  ok('2 §1.understanding no longer uses stale bilingual marker set', stale.length === 0,
     'stale=' + stale.join(', '));
})();

// ---------- Test 3 — Length threshold 200 stated ----------
(function() {
  const has = /200/.test(sec1) && /(?:character|chars?|자)/i.test(sec1);
  ok('3 §1.understanding states 200 length threshold', has,
     '200_present=' + /200/.test(sec1));
})();

// ---------- Test 4 — Format markers / current semantics present ----------
(function() {
  const hasFormatMarkers = /Format markers/i.test(sec1);
  const hasSeven = /7개\s*마커|7\s*markers?/i.test(sec1);
  const hasFail = /부재\s*시\s*FAIL|missing.*FAIL/i.test(sec1);
  ok('4 sub-clause has Format markers + 7-marker + missing→FAIL semantics',
     hasFormatMarkers && hasSeven && hasFail,
     'fm=' + hasFormatMarkers + ' seven=' + hasSeven + ' fail=' + hasFail);
})();

// ---------- Test 5 — Current 7-field fixture sanity ----------
(function() {
  const fixture = '[검증]: 미검증\n[논리]: 추론 불필요 — 사유: 단순 확인\n[동조화 및 일관성]: 위반 없음\n[완결 충동]: 완결 충동 없음\n[의도]: 요청 재진술\n[이해]: 불확실 항목 없음\n[쉬운 설명]: 요약';
  const missing = CURRENT_MARKERS.filter(m => !fixture.includes(m));
  ok('5 current 7-field fixture contains every required marker',
     missing.length === 0,
     'missing=' + missing.join(', '));
})();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
