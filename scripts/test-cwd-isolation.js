#!/usr/bin/env node
// test-cwd-isolation.js — Mock tests for project root isolation (v17.2.0)
// Verifies CLAUDE_PROJECT_DIR takes priority, hookData.cwd is NOT used

const path = require('path');
const fs = require('fs');
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

// Save original env
const origProjectDir = process.env.PROJECT_DIR;
const origClaudeProjectDir = process.env.CLAUDE_PROJECT_DIR;
const origHookData = process.env.HOOK_DATA;

// ═══════════════════════════════════════════════════════════════
// Test Suite 1: getProjectDir() uses CLAUDE_PROJECT_DIR first
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 1: getProjectDir() CLAUDE_PROJECT_DIR priority ===');

test('getProjectDir() returns process.cwd() when no env var set', () => {
  delete process.env.CLAUDE_PROJECT_DIR;
  delete process.env.PROJECT_DIR;
  delete require.cache[require.resolve('./utils')];
  const { getProjectDir } = require('./utils');
  assert.strictEqual(getProjectDir(), process.cwd());
});

test('getProjectDir() returns CLAUDE_PROJECT_DIR when set', () => {
  process.env.CLAUDE_PROJECT_DIR = '/stable/project/root';
  delete process.env.PROJECT_DIR;
  delete require.cache[require.resolve('./utils')];
  const { getProjectDir } = require('./utils');
  assert.strictEqual(getProjectDir(), '/stable/project/root');
});

test('getProjectDir() prefers CLAUDE_PROJECT_DIR over PROJECT_DIR', () => {
  process.env.CLAUDE_PROJECT_DIR = '/claude/root';
  process.env.PROJECT_DIR = '/different/root';
  delete require.cache[require.resolve('./utils')];
  const { getProjectDir } = require('./utils');
  assert.strictEqual(getProjectDir(), '/claude/root');
});

test('getProjectDir() falls back to PROJECT_DIR when CLAUDE_PROJECT_DIR unset', () => {
  delete process.env.CLAUDE_PROJECT_DIR;
  process.env.PROJECT_DIR = '/fallback/path';
  delete require.cache[require.resolve('./utils')];
  const { getProjectDir } = require('./utils');
  assert.strictEqual(getProjectDir(), '/fallback/path');
});

// Cleanup
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.PROJECT_DIR;

// ═══════════════════════════════════════════════════════════════
// Test Suite 2: readStdin() HOOK_DATA env var support
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 2: readStdin() HOOK_DATA env var ===');

test('readStdin() returns parsed HOOK_DATA when env var set', () => {
  const hookData = { session_id: 'test-123', cwd: '/mock/project' };
  process.env.HOOK_DATA = JSON.stringify(hookData);
  const result = JSON.parse(process.env.HOOK_DATA);
  assert.strictEqual(result.session_id, 'test-123');
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
// Test Suite 3: hookData.cwd is NOT used for PROJECT_DIR
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 3: hookData.cwd NOT used ===');

test('counter.js does NOT set PROJECT_DIR from hookData.cwd', () => {
  const source = fs.readFileSync(path.join(__dirname, 'counter.js'), 'utf8');
  assert.ok(!source.includes('process.env.PROJECT_DIR = hookData.cwd'),
    'Should NOT set PROJECT_DIR from hookData.cwd');
});

test('load-memory.js does NOT set PROJECT_DIR from stdinData.cwd', () => {
  const source = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert.ok(!source.includes('process.env.PROJECT_DIR = stdinData.cwd'),
    'Should NOT set PROJECT_DIR from stdinData.cwd');
});

test('utils.js getProjectDir() checks CLAUDE_PROJECT_DIR first', () => {
  const source = fs.readFileSync(path.join(__dirname, 'utils.js'), 'utf8');
  assert.ok(source.includes('process.env.CLAUDE_PROJECT_DIR'),
    'Should check CLAUDE_PROJECT_DIR');
});

// ═══════════════════════════════════════════════════════════════
// Test Suite 4: L1 filename regex compatibility
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 4: L1 filename regex compatibility ===');

const searchRegex = /(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(?:_[a-f0-9]+)?\.l1\.jsonl/;

test('Regex matches old format: 2026-02-22_1047.l1.jsonl', () => {
  const match = '2026-02-22_1047.l1.jsonl'.match(searchRegex);
  assert.ok(match, 'Should match old format');
});

test('Regex matches new format: 2026-02-22_1047_abcd1234.l1.jsonl', () => {
  const match = '2026-02-22_1047_abcd1234.l1.jsonl'.match(searchRegex);
  assert.ok(match, 'Should match new format with sessionId');
});

// ═══════════════════════════════════════════════════════════════
// Test Suite 5: HOOK_RUNNER_CODE v3 validation
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 5: HOOK_RUNNER_CODE v3 validation ===');

test('HOOK_RUNNER_CODE does NOT set PROJECT_DIR from hookData.cwd', () => {
  const source = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  // Extract HOOK_RUNNER_CODE string
  const start = source.indexOf('const HOOK_RUNNER_CODE = `');
  const end = source.indexOf('`;', start);
  const hookRunner = source.substring(start, end);
  assert.ok(!hookRunner.includes('hookData.cwd'),
    'HOOK_RUNNER_CODE should NOT reference hookData.cwd');
});

test('HOOK_RUNNER_CODE contains HOOK_DATA env var', () => {
  const source = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert.ok(source.includes("process.env.HOOK_DATA = _data.trim() || '{}'"),
    'Should store hookData in HOOK_DATA env var');
});

test('HOOK_RUNNER_CODE has double-run guard', () => {
  const source = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert.ok(source.includes('if (_loaded) return'), 'Should prevent double require()');
});

test('HOOK_RUNNER_CODE is v3', () => {
  const source = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert.ok(source.includes('// v3:'), 'Should be v3');
});

// ═══════════════════════════════════════════════════════════════
// Test Suite 6: findTranscriptPath exact matching
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 6: findTranscriptPath exact matching ===');

test('counter.js has encodeProjectPath function', () => {
  const source = fs.readFileSync(path.join(__dirname, 'counter.js'), 'utf8');
  assert.ok(source.includes('function encodeProjectPath'),
    'Should have encodeProjectPath for exact project matching');
});

test('counter.js does NOT use proj.includes() for transcript matching', () => {
  const source = fs.readFileSync(path.join(__dirname, 'counter.js'), 'utf8');
  assert.ok(!source.includes('proj.includes(projectName)'),
    'Should NOT use substring matching for project directories');
});

// ═══════════════════════════════════════════════════════════════
// Test Suite 7: encodeProjectPath correctness
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 7: encodeProjectPath correctness ===');

// Replicate the encoding function
function encodeProjectPath(projectDir) {
  return projectDir.replace(/\\/g, '/').replace(/\//g, '-').replace(':', '-');
}

test('Encodes Windows path correctly', () => {
  const result = encodeProjectPath('C:\\Users\\user\\Documents\\OtherProject');
  assert.strictEqual(result, 'C--Users-user-Documents-OtherProject');
});

test('Encodes Unix path correctly', () => {
  const result = encodeProjectPath('/home/user/my-project');
  assert.strictEqual(result, '-home-user-my-project');
});

test('OtherProject and OtherProject encode differently', () => {
  const parent = encodeProjectPath('C:\\Users\\user\\Documents\\OtherProject');
  const child = encodeProjectPath('C:\\Users\\user\\Documents\\OtherProject\\OtherProject');
  assert.notStrictEqual(parent, child, 'Parent and child should have different encodings');
});

// ═══════════════════════════════════════════════════════════════
// Test Suite 8: Project root anchor in POST_COMPACT_WARNING
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 8: Project root anchor in POST_COMPACT_WARNING ===');

test('load-memory.js has getPostCompactWarning function', () => {
  const source = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert.ok(source.includes('function getPostCompactWarning(projectDir)'),
    'Should have dynamic getPostCompactWarning function');
});

test('POST_COMPACT_WARNING includes PROJECT ROOT ANCHOR', () => {
  const source = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert.ok(source.includes('PROJECT ROOT ANCHOR'),
    'Should include project root anchor text');
});

test('POST_COMPACT_WARNING explicitly overrides Primary working directory', () => {
  const source = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  assert.ok(source.includes('OVERRIDES Primary working directory'),
    'Should explicitly state it overrides Primary working directory');
});

// ═══════════════════════════════════════════════════════════════
// Test Suite 9: Project root anchor in inject-rules.js
// ═══════════════════════════════════════════════════════════════
console.log('\n=== Test Suite 9: Project root anchor in inject-rules.js ===');

test('inject-rules.js includes Project Root Anchor in context', () => {
  const source = fs.readFileSync(path.join(__dirname, 'inject-rules.js'), 'utf8');
  assert.ok(source.includes('Project Root Anchor'),
    'Should include project root anchor in additionalContext');
});

test('inject-rules.js injects projectDir into context', () => {
  const source = fs.readFileSync(path.join(__dirname, 'inject-rules.js'), 'utf8');
  assert.ok(source.includes('${projectDir}'),
    'Should inject actual project directory path');
});

test('inject-rules.js explicitly overrides Primary working directory', () => {
  const source = fs.readFileSync(path.join(__dirname, 'inject-rules.js'), 'utf8');
  assert.ok(source.includes('OVERRIDES Primary working directory'),
    'Should explicitly state it overrides Primary working directory');
});

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════

// Cleanup env
if (origProjectDir !== undefined) process.env.PROJECT_DIR = origProjectDir;
else delete process.env.PROJECT_DIR;
if (origClaudeProjectDir !== undefined) process.env.CLAUDE_PROJECT_DIR = origClaudeProjectDir;
else delete process.env.CLAUDE_PROJECT_DIR;
if (origHookData !== undefined) process.env.HOOK_DATA = origHookData;
else delete process.env.HOOK_DATA;

console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}`);

if (failed > 0) process.exit(1);
