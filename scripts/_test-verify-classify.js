'use strict';

const { classify, shouldWarn, THRESHOLD_PERCENT } = require('./verify-classify');

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL [${label}]: expected '${expected}', got '${actual}'`);
  }
}

function assertBool(label, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL [${label}]: expected ${expected}, got ${actual}`);
  }
}

// Case 1: command not found -> env-incompatible
assert('case1', classify('python3: command not found', ''), 'env-incompatible');

// Case 2: spawn ENOENT -> env-incompatible (not missing-file, negative lookahead)
assert('case2', classify('Error: spawn python3 ENOENT', ''), 'env-incompatible');

// Case 3: ENOENT without spawn context -> missing-file
assert('case3', classify('ENOENT: no such file or directory', ''), 'missing-file');

// Case 4: numeric mismatch + FAIL:count_ -> data-drift
assert('case4', classify('expected 16 got 17', 'FAIL:count_drift'), 'data-drift');

// Case 5: AssertionError -> assertion-fail
assert('case5', classify('AssertionError: expected true to be false', ''), 'assertion-fail');

// Case 6: completely unknown error -> unknown
assert('case6', classify('완전 새 에러 xyzzy', ''), 'unknown');

// Case 7: null/undefined inputs -> unknown, no throw
assert('case7', classify(null, undefined), 'unknown');

// Case 8: object/array inputs -> unknown, no throw
assert('case8', classify({}, []), 'unknown');

// Case 9: empty strings -> unknown, no throw
assert('case9', classify('', ''), 'unknown');

// Case 10: VC-3 absorbed — shouldWarn threshold test
// 4 unknown out of 10 FAIL = 40% > 30% threshold -> warn:true
const syntheticResults = [
  { status: 'FAIL', failureClass: 'unknown' },
  { status: 'FAIL', failureClass: 'unknown' },
  { status: 'FAIL', failureClass: 'unknown' },
  { status: 'FAIL', failureClass: 'unknown' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
];
const w1 = shouldWarn(syntheticResults);
assertBool('case10a-shouldWarn-above-threshold', w1.warn, true);

// 1 unknown out of 10 FAIL = 10% < 30% threshold -> warn:false
const syntheticResults2 = [
  { status: 'FAIL', failureClass: 'unknown' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
  { status: 'FAIL', failureClass: 'env-incompatible' },
];
const w2 = shouldWarn(syntheticResults2);
assertBool('case10b-shouldWarn-below-threshold', w2.warn, false);

// Case 11: V012 sample — FAIL: at line start -> assertion-fail
assert('case11-v012-line-start', classify('FAIL:dispatch=7 fm=2 ko=4 en=0', ''), 'assertion-fail');

// Case 12: V022 sample — Command failed with .exe and _test- filename -> assertion-fail
assert('case12-v022-node-exec', classify('Command failed: "C:/Program Files/nodejs/node.exe" "C:/Users/chulg/Documents/memory-keeper-plugin/scripts/_test-d107-cycle2-verifier-audit.js"', ''), 'assertion-fail');

// Case 13: V008-style mention — Command failed without .exe token -> unknown (not assertion-fail)
// "Command failed: cleanup of _test-fixture.js" has no .exe — must not match V022 regex
assert('case13-v008-no-exe', classify('Command failed: cleanup of _test-fixture.js', ''), 'unknown');

// Case 14: data-drift order preservation — FAIL:count_ must hit data-drift BEFORE assertion-fail
// (ensure the FAIL: expansion in assertion-fail doesn't swallow count_ lines)
assert('case14-data-drift-order', classify('FAIL:count_drift=expected 5 got 3', ''), 'data-drift');

// Case 15: argv[2] arg-path test — spawn run-verify.js with flag args; entries must not be empty
// (-f, --flat, target ids, and unknown flags are tested through parseArgs only)
{
  // Keep this as parse-only coverage; spawning the real runner here would
  // recursively execute this manifest entry.
  const path = require('path');
  const { parseArgs } = require(path.join(__dirname, '..', '.crabshell', 'verification', 'run-verify.js'));
  const oldFlatEnv = process.env.CRABSHELL_VERIFY_FLAT;
  delete process.env.CRABSHELL_VERIFY_FLAT;

  function assertParsed(label, argv, expected) {
    const actual = parseArgs(argv);
    assertBool(label + '-targetId', actual.targetId === expected.targetId, true);
    assertBool(label + '-flat', actual.flat === expected.flat, true);
    assertBool(label + '-error', actual.error === expected.error, true);
  }

  assertParsed('case15-f-flag', ['-f'], { targetId: null, flat: true, error: null });
  assertParsed('case15-flat-flag', ['--flat'], { targetId: null, flat: true, error: null });
  assertParsed('case15-target-only', ['AC-D109-1'], { targetId: 'AC-D109-1', flat: false, error: null });
  assertParsed('case15-flat-before-target', ['--flat', 'AC-D109-1'], { targetId: 'AC-D109-1', flat: true, error: null });
  assertParsed('case15-flat-after-target', ['AC-D109-1', '--flat'], { targetId: 'AC-D109-1', flat: true, error: null });

  const badFlag = parseArgs(['--bad']);
  assertBool('case15-unknown-flag', typeof badFlag.error === 'string' && badFlag.error.includes('--bad'), true);
  if (oldFlatEnv === undefined) delete process.env.CRABSHELL_VERIFY_FLAT;
  else process.env.CRABSHELL_VERIFY_FLAT = oldFlatEnv;
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
