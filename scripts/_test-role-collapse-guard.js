'use strict';

/**
 * Tests for role-collapse-guard.js: isSourceFile() and block logic.
 * Block trigger: workflow active + waCount=0 + source file write.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolated temp dir — must be set before requiring any modules
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcg-test-'));
process.env.CLAUDE_PROJECT_DIR = tmpDir;

// Set up .crabshell/memory directory
const crabMemDir = path.join(tmpDir, '.crabshell', 'memory');
fs.mkdirSync(crabMemDir, { recursive: true });

const { isSourceFile } = require('./role-collapse-guard');
const { isRegressingActive, isLightWorkflowActive, getWaCount } = require('./regressing-loop-guard');

let passed = 0;
let failed = 0;

function test(name, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name} -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

const statePath = path.join(crabMemDir, 'regressing-state.json');
const skillActivePath = path.join(crabMemDir, 'skill-active.json');
const waCountPath = path.join(crabMemDir, 'wa-count.json');

// Helper: set up regressing active
function setRegressingActive(active) {
  fs.writeFileSync(statePath, JSON.stringify({ active }));
}

// Helper: set up light-workflow active
function setLightWorkflow(active) {
  if (active) {
    fs.writeFileSync(skillActivePath, JSON.stringify({ skill: 'light-workflow', activatedAt: new Date().toISOString() }));
  } else {
    try { fs.unlinkSync(skillActivePath); } catch {}
  }
}

// Helper: set wa count
function setWaCount(n) {
  if (n === 0) {
    try { fs.unlinkSync(waCountPath); } catch {}
  } else {
    fs.writeFileSync(waCountPath, JSON.stringify({ waCount: n }));
  }
}

console.log('--- isSourceFile() classification ---');

// Source files — should return true
test('TC-SF1: scripts/foo.js → true', isSourceFile('scripts/foo.js'), true);
test('TC-SF2: hooks/hooks.json → true', isSourceFile('hooks/hooks.json'), true);
test('TC-SF3: scripts/foo.ts → true', isSourceFile('scripts/foo.ts'), true);
test('TC-SF4: scripts/find-node.sh → true', isSourceFile('scripts/find-node.sh'), true);

// Non-source files — should return false
test('TC-SF5: .crabshell/ticket/foo.md → false', isSourceFile('.crabshell/ticket/foo.md'), false);
test('TC-SF6: .crabshell/plan/P001.md → false', isSourceFile('.crabshell/plan/P001.md'), false);
test('TC-SF7: scripts/_test-foo.js → false', isSourceFile('scripts/_test-foo.js'), false);
test('TC-SF8: README.md → false', isSourceFile('README.md'), false);
test('TC-SF9: .crabshell/memory/regressing-state.json → false',
  isSourceFile('.crabshell/memory/regressing-state.json'), false);
test('TC-SF10: empty string → false', isSourceFile(''), false);

console.log('\n--- Workflow state checks via imported functions ---');

// TC1: regressing active + waCount=0 → conditions would trigger block
setRegressingActive(true);
setWaCount(0);
test('TC1: regressing active → isRegressingActive() true', isRegressingActive(), true);
test('TC1: waCount=0 → getWaCount() === 0', getWaCount(), 0);

// TC2: .crabshell/ path → isSourceFile returns false (no block)
test('TC2: .crabshell/ path → isSourceFile false (no block)', isSourceFile('.crabshell/plan/P001.md'), false);

// TC3: waCount=1 → no block
setWaCount(1);
test('TC3: waCount=1 → getWaCount() === 1 (allowed)', getWaCount(), 1);

// TC4: CRABSHELL_BACKGROUND=1 → skip (guard exits 0 at top, not testable here;
//       just verify module loads fine with env set)
const origBg = process.env.CRABSHELL_BACKGROUND;
process.env.CRABSHELL_BACKGROUND = '1';
test('TC4: CRABSHELL_BACKGROUND=1 → isSourceFile still works', isSourceFile('scripts/foo.js'), true);
process.env.CRABSHELL_BACKGROUND = origBg || '';

// TC5: No workflow active → no block (both flags off)
setRegressingActive(false);
setLightWorkflow(false);
test('TC5: regressing=false → isRegressingActive() false', isRegressingActive(), false);
test('TC5: light-workflow off → isLightWorkflowActive() false', isLightWorkflowActive(), false);

// TC6: light-workflow active + waCount=0 → conditions would trigger block
setLightWorkflow(true);
setWaCount(0);
test('TC6: light-workflow active → isLightWorkflowActive() true', isLightWorkflowActive(), true);
test('TC6: waCount=0 + light-workflow → getWaCount() === 0', getWaCount(), 0);
test('TC6: source file → isSourceFile true (block condition met)', isSourceFile('scripts/foo.js'), true);

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
