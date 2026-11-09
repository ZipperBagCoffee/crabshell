'use strict';


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

module.exports = { classify };
