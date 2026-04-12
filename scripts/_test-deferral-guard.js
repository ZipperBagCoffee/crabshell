'use strict';

/**
 * Tests for deferral-guard.js: hasAnalysisBody() and DEFERRAL_QUESTIONS patterns.
 * The guard is warn-only (stderr, exit 0) — tests verify detection logic only.
 */

const { hasAnalysisBody, DEFERRAL_QUESTIONS } = require('./deferral-guard');

let passed = 0;
let failed = 0;

function test(name, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name} -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

/**
 * Check if a response string ends with a trailing deferral question (same logic as guard).
 */
function hasTrailingDeferralQuestion(response) {
  const tail = response.slice(-300);
  return DEFERRAL_QUESTIONS.some(pattern => pattern.test(tail));
}

console.log('--- hasAnalysisBody() threshold (≥5 lines or ≥400 chars) ---');

// TC-HA1: 5 non-empty lines → true
const fiveLines = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
test('TC-HA1: 5 non-empty lines → true', hasAnalysisBody(fiveLines), true);

// TC-HA2: 4 lines → false (below threshold)
const fourLines = 'Line 1\nLine 2\nLine 3\nLine 4';
test('TC-HA2: 4 lines → false', hasAnalysisBody(fourLines), false);

// TC-HA3: ≥400 chars → true
const longStr = 'x'.repeat(400);
test('TC-HA3: 400 chars → true', hasAnalysisBody(longStr), true);

// TC-HA4: <400 chars and <5 lines → false
test('TC-HA4: short string → false', hasAnalysisBody('short'), false);

// TC-HA5: empty → false
test('TC-HA5: empty string → false', hasAnalysisBody(''), false);

console.log('\n--- DEFERRAL_QUESTIONS pattern matching ---');

// TC-DQ1: Korean "진행할까요?" → detected
test('TC-DQ1: "진행할까요?" → detected',
  hasTrailingDeferralQuestion('다음으로 진행할까요?'), true);

// TC-DQ2: English "shall I proceed?" → detected
test('TC-DQ2: "shall I proceed?" → detected',
  hasTrailingDeferralQuestion('Based on the analysis. Shall I proceed?'), true);

// TC-DQ3: English "would you like me to proceed?" → detected
test('TC-DQ3: "would you like me to proceed?" → detected',
  hasTrailingDeferralQuestion('Here is the plan. Would you like me to proceed?'), true);

// TC-DQ4: No trailing question → not detected
test('TC-DQ4: no trailing question → not detected',
  hasTrailingDeferralQuestion('The implementation is complete. All tests pass.'), false);

// TC-DQ5: English "do you want me to start?" → detected
test('TC-DQ5: "do you want me to start?" → detected',
  hasTrailingDeferralQuestion('I have reviewed the code. Do you want me to start the refactor?'), true);

console.log('\n--- Full compound detection (analysis body + trailing question) ---');

// TC-C1: warn condition — 5-line analysis + "진행할까요?"
const korAnalysis = '분석 결과 1\n분석 결과 2\n분석 결과 3\n분석 결과 4\n분석 결과 5\n진행할까요?';
test('TC-C1: 5-line analysis + 진행할까요? → warn condition met',
  hasAnalysisBody(korAnalysis) && hasTrailingDeferralQuestion(korAnalysis), true);

// TC-C2: warn condition — English 400+ char analysis + "shall I proceed?"
const engAnalysis = 'The analysis shows several issues:\n' +
  'First, the configuration is incorrect.\n' +
  'Second, the test coverage is insufficient.\n' +
  'Third, the documentation is outdated.\n' +
  'Fourth, performance benchmarks are missing.\n' +
  'Shall I proceed?';
test('TC-C2: multi-line analysis + "shall I proceed?" → warn condition met',
  hasAnalysisBody(engAnalysis) && hasTrailingDeferralQuestion(engAnalysis), true);

// TC-C3: short response (≤4 lines) + question → NO warn
const shortResp = 'Short line 1\nShort line 2\nShall I proceed?';
test('TC-C3: ≤4 lines + question → no warn (hasAnalysisBody false)',
  hasAnalysisBody(shortResp), false);

// TC-C4: analysis body + no trailing question → NO warn
const analysisNoQ = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nThe task is complete.';
test('TC-C4: 5-line analysis, no trailing question → no warn',
  hasAnalysisBody(analysisNoQ) && hasTrailingDeferralQuestion(analysisNoQ), false);

// TC-C5: stop_hook_active exemption — not testable here (requires hookData); just verify
// that hasAnalysisBody/hasTrailingDeferralQuestion are independent of hookData
test('TC-C5: DEFERRAL_QUESTIONS is an array', Array.isArray(DEFERRAL_QUESTIONS), true);
test('TC-C5: DEFERRAL_QUESTIONS has entries', DEFERRAL_QUESTIONS.length > 0, true);

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAIL: some tests failed');
  process.exit(1);
} else {
  console.log('PASS: all tests passed');
  process.exit(0);
}
