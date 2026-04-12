'use strict';

/**
 * Tests for sycophancy-guard.js context-length "session deferral" patterns (IA-1 additions).
 * Covers Korean "세션" + deferral/stoppage word patterns and narrowed English patterns.
 */

const { checkContextLength } = require('./sycophancy-guard');

let passed = 0;
let failed = 0;

function test(name, actual, expected) {
  const pass = expected === null ? actual === null : actual !== null;
  if (pass) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    const got = actual === null ? 'null (no match)' : `"${actual}"`;
    const exp = expected === null ? 'null (no match)' : 'non-null (match)';
    console.log(`  FAIL: ${name} -- expected ${exp}, got ${got}`);
    failed++;
  }
}

console.log('--- Context-length session deferral patterns (new IA-1 additions) ---');

// TC1: Korean "다음 세션" — deferral framing
test('TC1: "다음 세션에서 할까요?" → detected',
  checkContextLength('다음 세션에서 할까요?'), 'match');

// TC2: Korean stoppage indicator "여기까지"
test('TC2: "이번 세션에서는 여기까지만 하겠습니다" → detected',
  checkContextLength('이번 세션에서는 여기까지만 하겠습니다'), 'match');

// TC3: Korean "새 세션" deferral
test('TC3: "새 세션에서 이어서 진행하겠습니다" → detected',
  checkContextLength('새 세션에서 이어서 진행하겠습니다'), 'match');

// TC4: English deferral verb + session (narrowed pattern)
test('TC4: "continue in a new session" → detected',
  checkContextLength('We can continue in a new session.'), 'match');

// TC5: Regression check — original Korean pattern still works
test('TC5: "세션이 너무 길어서" → still detected (regression)',
  checkContextLength('세션이 너무 길어서 계속하기 어렵습니다'), 'match');

// TC6: False positive check — "new session" in technical context should NOT match
test('TC6: "new session created for DB" → NOT detected (FP guard)',
  checkContextLength('new session created for the database connection pool'), null);

// TC7: "다음번에" in deferral list
test('TC7: "세션이 깁니다. 다음번에 하죠." → detected',
  checkContextLength('세션이 깁니다. 다음번에 하죠.'), 'match');

// TC8: English — not matching without deferral verb
test('TC8: "next session of the conference" → NOT detected',
  checkContextLength('next session of the conference starts at 3pm'), null);

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAIL: some tests failed');
  process.exit(1);
} else {
  console.log('PASS: all tests passed');
  process.exit(0);
}
