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

const { isRegressingActive, getPhaseContext } = require('./regressing-loop-guard');

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

console.log('\n--- getPhaseContext() ---');

// TC6: No state file — should return empty string
if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
test('no state file → empty string', getPhaseContext(), '');

// TC7: Active but missing phase/cycle/totalCycles — buildRegressingReminder returns ''
fs.writeFileSync(statePath, JSON.stringify({ active: true }));
test('active but no phase → empty string', getPhaseContext(), '');

// TC8: Full execution phase state — should include phase context
fs.writeFileSync(statePath, JSON.stringify({
  active: true, phase: 'execution', cycle: 2, totalCycles: 5,
  discussion: 'D001', ticketIds: ['T001'], lastUpdatedAt: new Date().toISOString()
}));
const execCtx = getPhaseContext();
test('execution phase → contains "Execution"', execCtx.includes('Execution'), true);
test('execution phase → contains "Cycle 2"', execCtx.includes('Cycle 2'), true);
test('execution phase → contains "D001"', execCtx.includes('D001'), true);

// TC9: Planning phase state — should include mandatory skill call
fs.writeFileSync(statePath, JSON.stringify({
  active: true, phase: 'planning', cycle: 1, totalCycles: 3,
  discussion: 'D010', planId: null, ticketIds: [], lastUpdatedAt: new Date().toISOString()
}));
const planCtx = getPhaseContext();
test('planning phase → contains "Planning"', planCtx.includes('Planning'), true);
test('planning phase → contains skill call instruction', planCtx.includes('crabshell:planning'), true);

// TC10: Feedback phase state
fs.writeFileSync(statePath, JSON.stringify({
  active: true, phase: 'feedback', cycle: 1, totalCycles: 3,
  discussion: 'D010', ticketIds: ['T001'], lastUpdatedAt: new Date().toISOString()
}));
const fbCtx = getPhaseContext();
test('feedback phase → contains "Feedback"', fbCtx.includes('Feedback'), true);

// TC11: active: false — should return empty string
fs.writeFileSync(statePath, JSON.stringify({ active: false, phase: 'execution', cycle: 1, totalCycles: 3 }));
test('active:false → empty string', getPhaseContext(), '');

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
