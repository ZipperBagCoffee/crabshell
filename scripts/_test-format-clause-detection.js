'use strict';
/**
 * Tests for D103 cycle 2 §1.understanding format-marker sub-clause text
 * presence (P135_T001 AC-7).
 *
 * The behavioral L1 (verifier sub-agent FAIL on missing markers) is cycle 3+
 * scope (P134 DA-2 analog). This test file is L3 — structural grep that the
 * sub-clause text was actually added to the prompt body and that bilingual
 * EITHER-set semantics are encoded in the directive text.
 *
 * 5 cases:
 *  1) Korean markers ([의도] / [답] / [자기 평가]) all present in prompt
 *  2) English markers ([Intent] / [Answer] / [Self-Assessment]) all present
 *  3) Length threshold "200" appears with sub-clause keyword
 *  4) "Format markers" / "EITHER" / "trivial" key phrases present
 *  5) Bilingual ANY-ONE-set directive (Korean OR English): mock check —
 *     simulated response with Korean set OR English set should each be
 *     interpreted as PASS by a strict reading of the sub-clause directive.
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

// ---------- Test 1 — Korean markers all present ----------
(function() {
  const has = sec1.includes('[의도]') && sec1.includes('[답]') && sec1.includes('[자기 평가]');
  ok('1 §1.understanding contains Korean markers [의도]/[답]/[자기 평가]', has,
     'sec1 first 200 = ' + sec1.slice(0, 200));
})();

// ---------- Test 2 — English markers all present ----------
(function() {
  const has = sec1.includes('[Intent]') && sec1.includes('[Answer]') && sec1.includes('[Self-Assessment]');
  ok('2 §1.understanding contains English markers [Intent]/[Answer]/[Self-Assessment]', has);
})();

// ---------- Test 3 — Length threshold 200 stated ----------
(function() {
  const has = /200/.test(sec1) && /(?:character|chars?|자)/i.test(sec1);
  ok('3 §1.understanding states 200 length threshold', has,
     '200_present=' + /200/.test(sec1));
})();

// ---------- Test 4 — Format markers / EITHER / key directives present ----------
(function() {
  const hasFormatMarkers = /Format markers/i.test(sec1);
  const hasEither = /EITHER/i.test(sec1);
  const hasKeyComp = /Key composition directive/i.test(sec1);
  const has4Keys = /4\s+top-level\s+keys|four\s+(top-level\s+)?keys/i.test(sec1);
  ok('4 sub-clause has Format markers + EITHER + Key composition directive + 4 keys preserved',
     hasFormatMarkers && hasEither && hasKeyComp && has4Keys,
     'fm=' + hasFormatMarkers + ' either=' + hasEither + ' kc=' + hasKeyComp + ' 4keys=' + has4Keys);
})();

// ---------- Test 5 — Bilingual ANY-ONE-set semantics encoded ----------
// The directive text must enable either-set interpretation. A strict reader
// of the prompt should be able to determine that a Korean-only response and
// an English-only response are both acceptable. We mock-check by parsing the
// directive text for an explicit "Korean OR English" or "ANY ONE" phrasing.
(function() {
  const anyOnePresent = /Korean OR English|ANY[- ]ONE|EITHER set|EITHER\b.*Korean.*English|Korean.*EITHER.*English/i.test(sec1);
  // Mock: response with Korean set only should "PASS" under either-set rule.
  const koOnly = '[의도] 사용자 의도 재진술. [답] 결과 보고. [자기 평가] 정상.';
  const enOnly = '[Intent] User intent restated. [Answer] Result reported. [Self-Assessment] OK.';
  const koHasSet = koOnly.includes('[의도]') && koOnly.includes('[답]') && koOnly.includes('[자기 평가]');
  const enHasSet = enOnly.includes('[Intent]') && enOnly.includes('[Answer]') && enOnly.includes('[Self-Assessment]');
  // Fixture sanity: each language-only response must contain its own complete set.
  ok('5 ANY-ONE-set bilingual directive present + mock fixtures complete',
     anyOnePresent && koHasSet && enHasSet,
     'anyOne=' + anyOnePresent + ' ko=' + koHasSet + ' en=' + enHasSet);
})();

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
