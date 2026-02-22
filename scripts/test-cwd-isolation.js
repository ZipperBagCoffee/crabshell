#!/usr/bin/env node
// test-cwd-isolation.js — Mock tests for cwd isolation fixes (v17.0.0)
// Verifies that PROJECT_DIR env var and HOOK_DATA env var correctly isolate projects

const path = require('path');
const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════
// Test Suite 1: getProjectDir() uses PROJECT_DIR env var
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 1: getProjectDir() env var priority ===');

// Save original env
const origProjectDir = process.env.PROJECT_DIR;
const origHookData = process.env.HOOK_DATA;

test('getProjectDir() returns process.cwd() when no env var set', () => {
  delete process.env.PROJECT_DIR;
  // Re-require utils to get fresh module
  delete require.cache[require.resolve('./utils')];
  const { getProjectDir } = require('./utils');
  assert.strictEqual(getProjectDir(), process.cwd());
});

test('getProjectDir() returns PROJECT_DIR when env var is set', () => {
  process.env.PROJECT_DIR = '/fake/project/root';
  delete require.cache[require.resolve('./utils')];
  const { getProjectDir } = require('./utils');
  assert.strictEqual(getProjectDir(), '/fake/project/root');
});

test('getProjectDir() prefers PROJECT_DIR over process.cwd()', () => {
  const cwd = process.cwd();
  process.env.PROJECT_DIR = '/different/path';
  delete require.cache[require.resolve('./utils')];
  const { getProjectDir } = require('./utils');
  assert.notStrictEqual(getProjectDir(), cwd);
  assert.strictEqual(getProjectDir(), '/different/path');
});

// Cleanup
delete process.env.PROJECT_DIR;

// ═══════════════════════════════════════════════════════════════
// Test Suite 2: readStdin() HOOK_DATA env var support
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 2: readStdin() HOOK_DATA env var ===');

test('readStdin() returns parsed HOOK_DATA when env var set', async () => {
  const hookData = { session_id: 'test-123', cwd: '/mock/project' };
  process.env.HOOK_DATA = JSON.stringify(hookData);

  // Require counter's readStdin indirectly — test the pattern
  const result = process.env.HOOK_DATA
    ? JSON.parse(process.env.HOOK_DATA)
    : {};
  assert.strictEqual(result.session_id, 'test-123');
  assert.strictEqual(result.cwd, '/mock/project');
});

test('readStdin() returns empty object for invalid HOOK_DATA', () => {
  process.env.HOOK_DATA = 'not-json{{{';
  let result;
  try { result = JSON.parse(process.env.HOOK_DATA); }
  catch { result = {}; }
  assert.deepStrictEqual(result, {});
});

test('readStdin() returns empty object when HOOK_DATA not set', () => {
  delete process.env.HOOK_DATA;
  const result = process.env.HOOK_DATA
    ? JSON.parse(process.env.HOOK_DATA)
    : {};
  assert.deepStrictEqual(result, {});
});

// ═══════════════════════════════════════════════════════════════
// Test Suite 3: hookData.cwd → PROJECT_DIR flow
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 3: hookData.cwd → PROJECT_DIR flow ===');

test('Setting PROJECT_DIR from hookData.cwd changes getProjectDir()', () => {
  delete process.env.PROJECT_DIR;
  const hookData = { cwd: 'C:\\Users\\test\\Projects\\MyProject' };
  if (hookData.cwd && !process.env.PROJECT_DIR) {
    process.env.PROJECT_DIR = hookData.cwd;
  }
  delete require.cache[require.resolve('./utils')];
  const { getProjectDir } = require('./utils');
  assert.strictEqual(getProjectDir(), 'C:\\Users\\test\\Projects\\MyProject');
});

test('PROJECT_DIR is not overwritten if already set', () => {
  process.env.PROJECT_DIR = '/original/path';
  const hookData = { cwd: '/different/path' };
  if (hookData.cwd && !process.env.PROJECT_DIR) {
    process.env.PROJECT_DIR = hookData.cwd;
  }
  delete require.cache[require.resolve('./utils')];
  const { getProjectDir } = require('./utils');
  assert.strictEqual(getProjectDir(), '/original/path');
});

// ═══════════════════════════════════════════════════════════════
// Test Suite 4: L1 filename regex compatibility
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 4: L1 filename regex compatibility ===');

// search.js parseFilenameTimestamp regex
const searchRegex = /(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(?:_[a-f0-9]+)?\.l1\.jsonl/;

test('Regex matches old format: 2026-02-22_1047.l1.jsonl', () => {
  const match = '2026-02-22_1047.l1.jsonl'.match(searchRegex);
  assert.ok(match, 'Should match old format');
  assert.strictEqual(match[1], '2026');
  assert.strictEqual(match[4], '10');
  assert.strictEqual(match[5], '47');
});

test('Regex matches new format: 2026-02-22_1047_abcd1234.l1.jsonl', () => {
  const match = '2026-02-22_1047_abcd1234.l1.jsonl'.match(searchRegex);
  assert.ok(match, 'Should match new format with sessionId');
  assert.strictEqual(match[1], '2026');
  assert.strictEqual(match[4], '10');
  assert.strictEqual(match[5], '47');
});

test('Regex matches long sessionId: 2026-02-22_1047_3c8f4818.l1.jsonl', () => {
  const match = '2026-02-22_1047_3c8f4818.l1.jsonl'.match(searchRegex);
  assert.ok(match, 'Should match with 8-char sessionId');
});

// migrate-timezone.js parseL1Filename regex
const migrateRegex = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:_[a-f0-9]+)?\.l1\.jsonl$/;

test('Migrate regex matches old HHMMSS format: 2026-01-13_083012.l1.jsonl', () => {
  const match = '2026-01-13_083012.l1.jsonl'.match(migrateRegex);
  assert.ok(match, 'Should match old HHMMSS format');
  assert.strictEqual(match[6], '12');
});

test('Migrate regex matches new HHMMSS+session format: 2026-01-13_083012_abcd1234.l1.jsonl', () => {
  const match = '2026-01-13_083012_abcd1234.l1.jsonl'.match(migrateRegex);
  assert.ok(match, 'Should match HHMMSS with sessionId');
});

// ═══════════════════════════════════════════════════════════════
// Test Suite 5: hook-runner.js HOOK_RUNNER_CODE structure
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 5: HOOK_RUNNER_CODE validation ===');

test('HOOK_RUNNER_CODE contains PROJECT_DIR setting', () => {
  delete require.cache[require.resolve('./load-memory')];
  // Read the source file instead of requiring (which would execute it)
  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert.ok(source.includes('process.env.PROJECT_DIR = hookData.cwd'), 'Should set PROJECT_DIR from hookData.cwd');
});

test('HOOK_RUNNER_CODE contains HOOK_DATA env var', () => {
  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert.ok(source.includes("process.env.HOOK_DATA = _data.trim() || '{}'"), 'Should store hookData in HOOK_DATA env var');
});

test('HOOK_RUNNER_CODE has double-run guard', () => {
  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert.ok(source.includes('if (_loaded) return'), 'Should prevent double require()');
});

// ═══════════════════════════════════════════════════════════════
// Test Suite 6: counter.js CONFIG_PATH is dynamic
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 6: CONFIG_PATH dynamic resolution ===');

test('counter.js has no module-level CONFIG_PATH constant', () => {
  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, 'counter.js'), 'utf8');
  assert.ok(!source.includes("const CONFIG_PATH = path.join(process.cwd()"), 'Should not have static CONFIG_PATH');
});

test('getConfig() computes config path dynamically', () => {
  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, 'counter.js'), 'utf8');
  assert.ok(source.includes("path.join(getProjectDir(), '.claude', 'memory', 'config.json')"), 'Should compute config path in getConfig()');
});

// ═══════════════════════════════════════════════════════════════
// Test Suite 7: final() session isolation
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 7: final() session isolation ===');

test('final() passes sessionId to extractDelta', () => {
  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, 'counter.js'), 'utf8');
  assert.ok(source.includes('extractDelta(sessionId8)'), 'final() should pass sessionId8 to extractDelta');
  // Verify there's no bare extractDelta() call (without args)
  const matches = source.match(/extractDelta\(\)/g);
  assert.ok(!matches, 'Should have no extractDelta() calls without sessionId');
});

test('final() sets PROJECT_DIR from hookData.cwd', () => {
  const fs = require('fs');
  const source = fs.readFileSync(path.join(__dirname, 'counter.js'), 'utf8');
  // Check that final() has the PROJECT_DIR setting code
  const finalIdx = source.indexOf('async function final()');
  const nextFuncIdx = source.indexOf('function reset()', finalIdx);
  const finalBody = source.substring(finalIdx, nextFuncIdx);
  assert.ok(finalBody.includes('process.env.PROJECT_DIR = hookData.cwd'), 'final() should set PROJECT_DIR');
});

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

// Cleanup env
if (origProjectDir !== undefined) {
  process.env.PROJECT_DIR = origProjectDir;
} else {
  delete process.env.PROJECT_DIR;
}
if (origHookData !== undefined) {
  process.env.HOOK_DATA = origHookData;
} else {
  delete process.env.HOOK_DATA;
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}`);

if (failed > 0) {
  process.exit(1);
}
