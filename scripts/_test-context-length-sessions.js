'use strict';

/**
 * Regression for D108 cleanup: context-length Stop branch was removed from
 * sycophancy-guard.js and absorbed by behavior-verifier §3.logic.
 */

const fs = require('fs');
const path = require('path');
const guard = require('./sycophancy-guard');
const guardSrc = fs.readFileSync(path.join(__dirname, 'sycophancy-guard.js'), 'utf8');
const promptSrc = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'behavior-verifier-prompt.md'), 'utf8');

let passed = 0;
let failed = 0;

function test(name, pass, detail) {
  if (pass) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name}` + (detail ? ` -- ${detail}` : ''));
    failed++;
  }
}

console.log('--- Context-length deferral cleanup regression ---');

test('TC1: checkContextLength is not exported', typeof guard.checkContextLength === 'undefined');
test('TC2: removal note remains in sycophancy-guard.js', /checkContextLength removed/.test(guardSrc));
test('TC3: sycophancy exports still expose active checks', typeof guard.checkSycophancy === 'function' && typeof guard.checkVerificationClaims === 'function');
test('TC4: behavior-verifier prompt covers Session-length deferral', /\*\*Session-length deferral\*\*/.test(promptSrc));
test('TC5: behavior-verifier prompt covers Trailing deferral', /\*\*Trailing deferral\*\*/.test(promptSrc));

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAIL: some tests failed');
  process.exit(1);
} else {
  console.log('PASS: all tests passed');
  process.exit(0);
}
