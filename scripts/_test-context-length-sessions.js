'use strict';

/**
 * Regression for D108/D110 cleanup: context-length handling remains in the
 * parent-owned rules after the behavior-verifier consumer is retired.
 */

const fs = require('fs');
const path = require('path');
const guard = require('./sycophancy-guard');
const guardSrc = fs.readFileSync(path.join(__dirname, 'sycophancy-guard.js'), 'utf8');
const injectSrc = fs.readFileSync(path.join(__dirname, 'inject-rules.js'), 'utf8');

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
// Case-insensitive since v21.115.0 (I085): the failure rule was rewritten and the
// clause now starts a sentence ("Never recommend giving up.").
test('TC4: injected rules prohibit unsupported give-up recommendations', /never recommend giving up/i.test(injectSrc));
test('TC5: active guard assigns decisive re-checking to the parent', /parent must re-check decisive evidence/.test(guardSrc) && !/sub-agent verifier|retroactively correct/.test(guardSrc));

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAIL: some tests failed');
  process.exit(1);
} else {
  console.log('PASS: all tests passed');
  process.exit(0);
}
