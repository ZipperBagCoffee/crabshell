'use strict';

/**
 * Tests for regressing-loop-guard.js: isRegressingActive()
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolated require: set CLAUDE_PROJECT_DIR to a temp dir
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlg-test-'));
process.env.CLAUDE_PROJECT_DIR = tmpDir;

const { isRegressingActive } = require('./regressing-loop-guard');

let passed = 0;
let failed = 0;

function test(name, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name} — expected ${expected}, got ${actual}`);
    failed++;
  }
}

// Set up .crabshell/memory directory
const crabDir = path.join(tmpDir, '.crabshell', 'memory');
fs.mkdirSync(crabDir, { recursive: true });
const statePath = path.join(crabDir, 'regressing-state.json');

console.log('--- isRegressingActive() ---');

// TC1: No state file — should return false
if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
test('no state file → false', isRegressingActive(), false);

// TC2: State file with active: true
fs.writeFileSync(statePath, JSON.stringify({ active: true }));
test('active:true → true', isRegressingActive(), true);

// TC3: State file with active: false
fs.writeFileSync(statePath, JSON.stringify({ active: false }));
test('active:false → false', isRegressingActive(), false);

// TC4: State file with no active field
fs.writeFileSync(statePath, JSON.stringify({ phase: 'execution' }));
test('no active field → false', isRegressingActive(), false);

// TC5: Malformed JSON — fail-open, return false
fs.writeFileSync(statePath, 'not valid json{{{');
test('malformed JSON → false', isRegressingActive(), false);

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAIL: some tests failed');
  process.exit(1);
} else {
  console.log('PASS: all tests passed');
  process.exit(0);
}
