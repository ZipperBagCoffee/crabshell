'use strict';

/**
 * _test-shared-context.js — Unit tests for shared-context.js and the readers moved out of it
 * (core/first-turn-context getPostCompactWarning, core/project-memory readProjectConcept)
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

const { COMPRESSED_CHECKLIST } = require('./shared-context');
const { getPostCompactWarning } = require('./core/first-turn-context');
const { readProjectConcept } = require('./core/project-memory');

// ============================================================
// 1. COMPRESSED_CHECKLIST
// ============================================================
test('COMPRESSED_CHECKLIST is a non-empty string', function() {
  assert(typeof COMPRESSED_CHECKLIST === 'string', 'should be string');
  assert(COMPRESSED_CHECKLIST.length > 0, 'should not be empty');
});

// The checklist's sentences are not pinned (D151_T005): a check that they hold certain words
// fails on every rewording. _test-rule-wording.js checks that every line reaches the model.
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

test('getPostCompactWarning preserves scoped continuation and working rules', function() {
  const warning = getPostCompactWarning('/test/dir');
  const missing = COMPRESSED_CHECKLIST.split('\n').map(line => line.trim()).filter(Boolean).filter(line => !warning.includes(line));
  assert(missing.length === 0, 'checklist lines missing after compaction: ' + missing.slice(0, 2).join(' | '));
  assert(!warning.includes("Wait for user's next instruction"), 'compaction alone is not a new approval gate');
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
// 4. Retired wording stays out of the checklist (D105, v21.115.0; D151_T005)
// ============================================================
test('COMPRESSED_CHECKLIST: retired wording stays out', function() {
  const retired = [
    'D/P/T/I/H',    // v21.115.0: the report format is not routed to documents
    /no table, no/, // v21.115.1: no prohibition list next to the report format
    /analogy/i,     // D105: the externalized default that kept coming back
  ];
  const back = retired.filter(item => (item instanceof RegExp ? item.test(COMPRESSED_CHECKLIST) : COMPRESSED_CHECKLIST.includes(item)));
  assert(back.length === 0, 'retired wording is back in the checklist: ' + back.join(' | '));
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
