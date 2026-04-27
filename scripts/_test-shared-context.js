'use strict';

/**
 * _test-shared-context.js — Unit tests for shared-context.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { console.log('FAIL: ' + name + ' --- ' + e.message); failed++; }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}

function cleanupDir(dirPath) {
  try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch (e) {}
}

const { COMPRESSED_CHECKLIST, getPostCompactWarning, readProjectConcept } = require('./shared-context');

// ============================================================
// 1. COMPRESSED_CHECKLIST
// ============================================================
test('COMPRESSED_CHECKLIST is a non-empty string', function() {
  assert(typeof COMPRESSED_CHECKLIST === 'string', 'should be string');
  assert(COMPRESSED_CHECKLIST.length > 0, 'should not be empty');
});

test('COMPRESSED_CHECKLIST contains key rules', function() {
  assert(COMPRESSED_CHECKLIST.includes('Understanding-First'), 'should mention Understanding-First');
  assert(COMPRESSED_CHECKLIST.includes('P/O/G'), 'should mention P/O/G table');
  assert(COMPRESSED_CHECKLIST.includes('ANALYZE'), 'should mention ANALYZE');
});

// ============================================================
// 2. getPostCompactWarning
// ============================================================
test('getPostCompactWarning returns string containing projectDir', function() {
  const warning = getPostCompactWarning('/some/project/dir');
  assert(typeof warning === 'string', 'should be string');
  assert(warning.includes('/some/project/dir'), 'should contain projectDir');
});

test('getPostCompactWarning contains POST-COMPACTION WARNING header', function() {
  const warning = getPostCompactWarning('/test/dir');
  assert(warning.includes('POST-COMPACTION WARNING'), 'should contain header');
});

test('getPostCompactWarning contains MANDATORY RECOVERY PROTOCOL', function() {
  const warning = getPostCompactWarning('/test/dir');
  assert(warning.includes('MANDATORY RECOVERY PROTOCOL'), 'should contain recovery protocol');
});

// ============================================================
// 3. readProjectConcept
// ============================================================
test('readProjectConcept returns empty string when file does not exist', function() {
  const tmpDir = makeTempDir('shared-context-test');
  try {
    // Create .crabshell dir but no project.md
    fs.mkdirSync(path.join(tmpDir, '.crabshell'), { recursive: true });
    const result = readProjectConcept(tmpDir);
    assert(result === '', 'expected empty string, got: ' + JSON.stringify(result));
  } finally {
    cleanupDir(tmpDir);
  }
});

test('readProjectConcept reads first 20 lines up to 1000 chars', function() {
  const tmpDir = makeTempDir('shared-context-test');
  try {
    const crabshellDir = path.join(tmpDir, '.crabshell');
    fs.mkdirSync(crabshellDir, { recursive: true });
    // Write 30 lines
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}: content here`);
    fs.writeFileSync(path.join(crabshellDir, 'project.md'), lines.join('\n'));

    const result = readProjectConcept(tmpDir);
    // Should have at most 20 lines
    const resultLines = result.split(/\r?\n/);
    assert(resultLines.length <= 20, 'should have at most 20 lines, got ' + resultLines.length);
    assert(result.includes('Line 1:'), 'should contain first line');
    assert(!result.includes('Line 21:'), 'should NOT contain line 21');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('readProjectConcept respects maxChars limit', function() {
  const tmpDir = makeTempDir('shared-context-test');
  try {
    const crabshellDir = path.join(tmpDir, '.crabshell');
    fs.mkdirSync(crabshellDir, { recursive: true });
    // Write content longer than 100 chars
    const content = 'A'.repeat(200);
    fs.writeFileSync(path.join(crabshellDir, 'project.md'), content);

    const result = readProjectConcept(tmpDir, 20, 100);
    assert(result.length <= 100, 'should be at most 100 chars, got ' + result.length);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('readProjectConcept default maxLines=20 maxChars=1000', function() {
  const tmpDir = makeTempDir('shared-context-test');
  try {
    const crabshellDir = path.join(tmpDir, '.crabshell');
    fs.mkdirSync(crabshellDir, { recursive: true });
    const content = 'Short project description.';
    fs.writeFileSync(path.join(crabshellDir, 'project.md'), content);

    const result = readProjectConcept(tmpDir);
    assert(result === 'Short project description.', 'expected exact content, got: ' + JSON.stringify(result));
  } finally {
    cleanupDir(tmpDir);
  }
});

test('readProjectConcept returns empty string for empty file', function() {
  const tmpDir = makeTempDir('shared-context-test');
  try {
    const crabshellDir = path.join(tmpDir, '.crabshell');
    fs.mkdirSync(crabshellDir, { recursive: true });
    fs.writeFileSync(path.join(crabshellDir, 'project.md'), '   \n\n  ');

    const result = readProjectConcept(tmpDir);
    assert(result === '', 'expected empty string for whitespace-only file, got: ' + JSON.stringify(result));
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 4. COMPRESSED_CHECKLIST item #10 wording lock (D105 P137_T002 AC1)
// ============================================================
// Locks Simple Communication 4 keyword properties into checklist item #10.
// POSITIVE: each of the 4 keywords appears at least once.
// NEGATIVE: "analogy" must NOT appear (regression guard).
test('COMPRESSED_CHECKLIST item #10 contains "reader\'s words" keyword', function() {
  assert(COMPRESSED_CHECKLIST.includes("reader's words"),
    'item #10 missing "reader\'s words" keyword');
});

test('COMPRESSED_CHECKLIST item #10 contains "conclusion first" keyword', function() {
  assert(COMPRESSED_CHECKLIST.includes('conclusion first'),
    'item #10 missing "conclusion first" keyword');
});

test('COMPRESSED_CHECKLIST item #10 contains "concrete over abstract" keyword', function() {
  assert(COMPRESSED_CHECKLIST.includes('concrete over abstract'),
    'item #10 missing "concrete over abstract" keyword');
});

test('COMPRESSED_CHECKLIST item #10 contains "self-coined" keyword', function() {
  assert(COMPRESSED_CHECKLIST.includes('self-coined'),
    'item #10 missing "self-coined" keyword');
});

test('COMPRESSED_CHECKLIST contains zero "analogy" wording (regression guard)', function() {
  const matches = (COMPRESSED_CHECKLIST.match(/analogy/gi) || []).length;
  assert(matches === 0,
    'COMPRESSED_CHECKLIST should contain zero "analogy" tokens, found ' + matches);
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
