'use strict';
// Unit tests for scripts/completion-drive-guard.js
// Run: node tests/_test-completion-drive-guard.js

const assert = require('assert');
const path = require('path');

// Set required env vars before requiring the module
process.env.CLAUDE_PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const {
  checkCompletionDrive,
  stripProtectedZones,
  hasUserInstructionReference,
} = require(path.join(__dirname, '../scripts/completion-drive-guard.js'));

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

console.log('\n=== completion-drive-guard tests ===\n');

// --- Detection: Korean patterns ---
// Note: short exemption is ≤30 JS string chars. Korean chars count as 1 each,
// so test strings must have JS .length > 30 to avoid the short-response exemption.
test('detects 진행합니다 (response > 30 chars)', () => {
  const response = '이제 지시하신 대로 작업을 진행합니다 파일을 지금 수정합니다';
  assert.ok(response.length > 30, `test string must be > 30 chars, got ${response.length}`);
  const result = checkCompletionDrive(response);
  assert.ok(result !== null, 'expected detection');
  assert.ok(result.includes('진행합니다'), `matched: ${result}`);
});

test('detects 시작하겠습니다 (response > 30 chars)', () => {
  const response = '요청하신 작업을 지금 바로 시작하겠습니다 코드를 작성합니다';
  assert.ok(response.length > 30, `test string must be > 30 chars, got ${response.length}`);
  const result = checkCompletionDrive(response);
  assert.ok(result !== null, 'expected detection');
});

test('detects 계속 진행하겠습니다 (response > 30 chars)', () => {
  const response = '알겠습니다 그러면 계속 진행하겠습니다 다음 단계로 넘어갑니다';
  assert.ok(response.length > 30, `test string must be > 30 chars, got ${response.length}`);
  const result = checkCompletionDrive(response);
  assert.ok(result !== null, 'expected detection');
});

test('detects 작업을 시작하겠습니다 (response > 30 chars)', () => {
  const response = '네 알겠습니다 작업을 시작하겠습니다 먼저 코드를 수정합니다';
  assert.ok(response.length > 30, `test string must be > 30 chars, got ${response.length}`);
  const result = checkCompletionDrive(response);
  assert.ok(result !== null, 'expected detection');
});

// --- Detection: English patterns ---
test('detects "I will proceed"', () => {
  const result = checkCompletionDrive('I will proceed with the implementation now.');
  assert.ok(result !== null, 'expected detection');
});

test('detects "moving forward"', () => {
  const result = checkCompletionDrive('Moving forward with the changes as planned.');
  assert.ok(result !== null, 'expected detection');
});

test('detects "proceeding with"', () => {
  const result = checkCompletionDrive('Proceeding with the file modifications.');
  assert.ok(result !== null, 'expected detection');
});

test('detects "I\'ll start"', () => {
  const result = checkCompletionDrive("I'll start by reading the configuration files.");
  assert.ok(result !== null, 'expected detection');
});

// --- Exemption: user instruction reference ---
test('exempts when response cites user instruction (English)', () => {
  const result = checkCompletionDrive('As user requested, I will proceed with the changes.');
  assert.strictEqual(result, null, 'should be exempt due to user instruction reference');
});

test('exempts when response cites user instruction (Korean)', () => {
  const result = checkCompletionDrive('사용자가 요청하신 대로 진행합니다.');
  assert.strictEqual(result, null, 'should be exempt due to Korean user instruction reference');
});

test('exempts when response has blockquote (direct user quote)', () => {
  const result = checkCompletionDrive('> 이 작업을 해주세요\n\n진행합니다.');
  // Blockquote in the ORIGINAL text but hasUserInstructionReference checks stripped text for >, not blockquote
  // The stripProtectedZones removes blockquotes so "> 이 작업을..." becomes ' '
  // hasUserInstructionReference checks for /^>\s+/m on original text before stripping
  assert.strictEqual(result, null, 'should be exempt due to blockquote (user quote)');
});

// --- Exemption: short response (≤30 chars) ---
test('exempts short response (≤30 chars)', () => {
  const result = checkCompletionDrive('진행합니다.');
  assert.strictEqual(result, null, '≤30 chars should not trigger');
});

test('detects pattern in response > 30 chars', () => {
  // Exactly > 30 chars
  const longEnough = '이제 이 작업을 바로 진행하겠습니다. 파일 수정을 시작합니다.';
  const result = checkCompletionDrive(longEnough);
  assert.ok(result !== null, `expected detection for: "${longEnough}" (len=${longEnough.length})`);
});

// --- No match: normal response without patterns ---
test('no match for normal technical response', () => {
  const result = checkCompletionDrive('The configuration file has been updated successfully. Here are the changes made to the settings.');
  assert.strictEqual(result, null, 'normal response should not trigger');
});

test('no match for null input', () => {
  const result = checkCompletionDrive(null);
  assert.strictEqual(result, null, 'null should return null');
});

test('no match for empty string', () => {
  const result = checkCompletionDrive('');
  assert.strictEqual(result, null, 'empty string should return null');
});

test('patterns in code blocks are ignored', () => {
  const response = 'Here is an example:\n```\n진행합니다\nI will proceed\n```\nThis is the expected output.';
  const result = checkCompletionDrive(response);
  assert.strictEqual(result, null, 'patterns inside code blocks should not trigger');
});

// --- stripProtectedZones ---
test('stripProtectedZones removes fenced code blocks', () => {
  const input = 'before\n```\n진행합니다\n```\nafter';
  const stripped = stripProtectedZones(input);
  assert.ok(!stripped.includes('진행합니다'), 'code block content should be stripped');
});

test('stripProtectedZones removes inline code', () => {
  const input = 'use `진행합니다` for testing';
  const stripped = stripProtectedZones(input);
  assert.ok(!stripped.includes('진행합니다'), 'inline code should be stripped');
});

// --- Summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
