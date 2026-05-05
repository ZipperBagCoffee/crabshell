'use strict';

const THRESHOLD_PERCENT = 30;

function classify(err, output) {
  try {
    const e = (err == null ? '' : String(err));
    const o = (output == null ? '' : String(output));
    const haystack = e + '\n' + o;

    // env-incompatible (check FIRST so spawn-ENOENT doesn't fall through to missing-file)
    if (/command not found|is not recognized|spawn .+ ENOENT|cannot find/i.test(haystack)) return 'env-incompatible';
    // missing-file (negative lookahead: NOT spawn-ENOENT)
    if (/(?:^|\W)(?:no such file|file (?:does not exist|not found))/i.test(haystack)
        || /(?<!spawn[^\n]*)ENOENT(?![^\n]*spawn)/i.test(haystack)) return 'missing-file';
    // data-drift (numeric mismatch / FAIL:count_)
    if (/expected\s+.+\s+got\s+|FAIL:count_|received\s+\d+.*expected\s+\d+/i.test(haystack)) return 'data-drift';
    // assertion-fail (test framework idioms + V012 FAIL: line-start + V022 node execSync wrapper)
    if (/AssertionError|expected.*to (?:be|equal)|test failed|^FAIL:|\nFAIL:|Command failed:.*\.exe.*_test-[\w.-]+\.js/i.test(haystack)) return 'assertion-fail';

    return 'unknown';
  } catch (_) {
    return 'unknown';  // fail-open: never throw
  }
}

function shouldWarn(results) {
  try {
    const fails = results.filter(r => r && r.status === 'FAIL');
    if (fails.length === 0) return { warn: false, ratio: 0, unknownCount: 0, failCount: 0 };
    const unk = fails.filter(r => r.failureClass === 'unknown').length;
    const ratio = (unk / fails.length) * 100;
    return { warn: ratio > THRESHOLD_PERCENT, ratio: Math.round(ratio), unknownCount: unk, failCount: fails.length };
  } catch (_) {
    return { warn: false, ratio: 0, unknownCount: 0, failCount: 0 };
  }
}

module.exports = { classify, shouldWarn, THRESHOLD_PERCENT };
