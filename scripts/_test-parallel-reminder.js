'use strict';
// Unit tests for shouldInjectParallelReminder in scripts/inject-rules.js
// Run: node tests/_test-parallel-reminder.js

const assert = require('assert');
const path = require('path');

// Set required env vars before requiring the module
process.env.CLAUDE_PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const { shouldInjectParallelReminder, PARALLEL_REMINDER } = require(
  path.join(__dirname, '../scripts/inject-rules.js')
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

console.log('\n=== parallel-reminder tests ===\n');

// 1. Korean parallel keyword → true
test('shouldInjectParallelReminder("병렬 처리", false) → true', () => {
  const result = shouldInjectParallelReminder('병렬 처리를 어떻게 하나요?', false);
  assert.strictEqual(result, true, 'Korean 병렬 keyword should trigger injection');
});

// 2. General question without keywords → false
test('shouldInjectParallelReminder("일반 질문", false) → false', () => {
  const result = shouldInjectParallelReminder('일반 질문입니다.', false);
  assert.strictEqual(result, false, 'General question without keywords should not trigger');
});

// 3. Regressing active → always true
test('shouldInjectParallelReminder("anything", true) → true (regressing active)', () => {
  const result = shouldInjectParallelReminder('anything', true);
  assert.strictEqual(result, true, 'isRegressingActive=true should always trigger injection');
});

// 4. null prompt, not regressing → false
test('shouldInjectParallelReminder(null, false) → false', () => {
  const result = shouldInjectParallelReminder(null, false);
  assert.strictEqual(result, false, 'null prompt should return false');
});

// 5. English "parallel" keyword → true
test('shouldInjectParallelReminder("parallel processing", false) → true', () => {
  const result = shouldInjectParallelReminder('How do I do parallel processing?', false);
  assert.strictEqual(result, true, 'English parallel keyword should trigger injection');
});

// 6. English "agent" keyword → true
test('shouldInjectParallelReminder("use an agent", false) → true', () => {
  const result = shouldInjectParallelReminder('How should I use an agent for this task?', false);
  assert.strictEqual(result, true, 'English agent keyword should trigger injection');
});

// 7. "sequential" keyword → true
test('shouldInjectParallelReminder("sequential steps", false) → true', () => {
  const result = shouldInjectParallelReminder('These are sequential steps to follow.', false);
  assert.strictEqual(result, true, 'sequential keyword should trigger injection');
});

// 8. Korean 에이전트 → true
test('shouldInjectParallelReminder("에이전트 사용", false) → true', () => {
  const result = shouldInjectParallelReminder('에이전트를 어떻게 사용하나요?', false);
  assert.strictEqual(result, true, 'Korean 에이전트 keyword should trigger injection');
});

// 9. Regressing active + empty prompt still returns true
test('shouldInjectParallelReminder("", true) → true (regressing overrides empty prompt)', () => {
  const result = shouldInjectParallelReminder('', true);
  assert.strictEqual(result, true, 'regressing active should override empty prompt');
});

// 10. PARALLEL_REMINDER constant is exported and non-empty
test('PARALLEL_REMINDER constant is exported and contains expected content', () => {
  assert.ok(typeof PARALLEL_REMINDER === 'string', 'PARALLEL_REMINDER should be a string');
  assert.ok(PARALLEL_REMINDER.includes('Parallel Execution Check'), 'should contain header text');
  assert.ok(PARALLEL_REMINDER.length > 50, 'should be non-trivial content');
});

// --- Summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
