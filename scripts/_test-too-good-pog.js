'use strict';
// Unit tests for checkTooGoodPOG and findGapColumnIndex in scripts/sycophancy-guard.js
// Run: node tests/_test-too-good-pog.js

const assert = require('assert');
const path = require('path');

// sycophancy-guard.js does not export these functions by default.
// We load via require (non-main module) to access exports.
process.env.CLAUDE_PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// sycophancy-guard.js exports module when required as non-main
// but checkTooGoodPOG and findGapColumnIndex are not in current exports.
// They are defined locally — we expose them by loading the file and
// accessing via a test shim approach.
// Since the file uses conditional export (require.main !== module),
// we require it and check what is available.
const guardModule = require(path.join(__dirname, '../scripts/sycophancy-guard.js'));

// If checkTooGoodPOG is not exported, we cannot test it directly.
// Verify availability and warn clearly.
const { checkTooGoodPOG, findGapColumnIndex } = guardModule;

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

function skip(name, reason) {
  console.log(`  SKIP  ${name} — ${reason}`);
}

console.log('\n=== too-good-pog tests ===\n');

// Check export availability
if (typeof checkTooGoodPOG !== 'function') {
  console.error('WARN: checkTooGoodPOG is not exported from sycophancy-guard.js');
  console.error('      These tests require the function to be added to module.exports.');
  console.error('      Add: checkTooGoodPOG, findGapColumnIndex to module.exports.\n');
  process.exit(1);
}

if (typeof findGapColumnIndex !== 'function') {
  console.error('WARN: findGapColumnIndex is not exported from sycophancy-guard.js');
  process.exit(1);
}

// --- 4-column P/O/G with all Gap=None → should detect ---
test('4-col P/O/G all Gap=None triggers detection', () => {
  const response = [
    '| Item | Prediction | Observation | Gap |',
    '|------|-----------|-------------|-----|',
    '| A | expected X | got X | None |',
    '| B | expected Y | got Y | None |',
    '| C | expected Z | got Z | None |',
  ].join('\n');
  const result = checkTooGoodPOG(response);
  assert.ok(result !== null, 'expected detection for all-None 4-col table');
  assert.strictEqual(result.rowCount, 3, `expected rowCount=3, got ${result && result.rowCount}`);
});

// --- 5-column P/O/G with all Gap=None → should detect (RA fix) ---
test('5-col P/O/G (Item|Type|Prediction|Observation|Gap) all Gap=None triggers detection', () => {
  const response = [
    '| Item | Type | Prediction | Observation | Gap |',
    '|------|------|-----------|-------------|-----|',
    '| A | behavioral | expected X | got X | None |',
    '| B | structural | expected Y | got Y | None |',
  ].join('\n');
  const result = checkTooGoodPOG(response);
  assert.ok(result !== null, 'expected detection for all-None 5-col table');
  assert.strictEqual(result.rowCount, 2, `expected rowCount=2, got ${result && result.rowCount}`);
});

// --- P/O/G with mixed gaps (some None, some real) → should NOT detect ---
test('P/O/G with mixed gaps (some real findings) does NOT trigger', () => {
  const response = [
    '| Item | Prediction | Observation | Gap |',
    '|------|-----------|-------------|-----|',
    '| A | expected X | got X | None |',
    '| B | expected Y | got different Z | Found discrepancy: Z vs Y |',
  ].join('\n');
  const result = checkTooGoodPOG(response);
  assert.strictEqual(result, null, 'mixed gaps should not trigger detection');
});

// --- No P/O/G table → should NOT detect ---
test('no P/O/G table does NOT trigger', () => {
  const response = 'Here is a summary of the changes made. Everything looks good.';
  const result = checkTooGoodPOG(response);
  assert.strictEqual(result, null, 'no table should not trigger');
});

// --- Single data row (< 2 minimum) → should NOT detect ---
test('single data row (below minimum 2) does NOT trigger', () => {
  const response = [
    '| Item | Prediction | Observation | Gap |',
    '|------|-----------|-------------|-----|',
    '| A | expected X | got X | None |',
  ].join('\n');
  const result = checkTooGoodPOG(response);
  assert.strictEqual(result, null, 'single row should not trigger (need ≥2 rows)');
});

// --- findGapColumnIndex: correctly finds Gap in 4-col header ---
test('findGapColumnIndex finds Gap at index 3 in 4-col header', () => {
  const header = '| Item | Prediction | Observation | Gap |';
  const idx = findGapColumnIndex(header);
  assert.strictEqual(idx, 3, `expected index 3, got ${idx}`);
});

// --- findGapColumnIndex: correctly finds Gap in 5-col header ---
test('findGapColumnIndex finds Gap at index 4 in 5-col header', () => {
  const header = '| Item | Type | Prediction | Observation | Gap |';
  const idx = findGapColumnIndex(header);
  assert.strictEqual(idx, 4, `expected index 4, got ${idx}`);
});

// --- findGapColumnIndex: returns -1 when no Gap column ---
test('findGapColumnIndex returns -1 when no Gap column in header', () => {
  const header = '| Item | Prediction | Observation | Notes |';
  const idx = findGapColumnIndex(header);
  assert.strictEqual(idx, -1, `expected -1, got ${idx}`);
});

// --- 없음 value (Korean none) should count as None ---
test('P/O/G with Korean 없음 as Gap value triggers detection', () => {
  const response = [
    '| Item | Prediction | Observation | Gap |',
    '|------|-----------|-------------|-----|',
    '| A | expected X | got X | 없음 |',
    '| B | expected Y | got Y | 없음 |',
  ].join('\n');
  const result = checkTooGoodPOG(response);
  assert.ok(result !== null, 'Korean 없음 should be treated as None');
});

// --- N/A value should count as None ---
test('P/O/G with N/A as Gap value triggers detection', () => {
  const response = [
    '| Item | Prediction | Observation | Gap |',
    '|------|-----------|-------------|-----|',
    '| A | expected X | got X | N/A |',
    '| B | expected Y | got Y | N/A |',
  ].join('\n');
  const result = checkTooGoodPOG(response);
  assert.ok(result !== null, 'N/A should be treated as None');
});

// --- Summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
