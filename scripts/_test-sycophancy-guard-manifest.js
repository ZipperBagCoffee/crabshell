'use strict';
// Minimal behavioral test for verification manifest.
//
// D103 cycle 1 (P134_T001): the agreement Stop branch was converted from
// decision:'block' + exit(2) to warn-only [BEHAVIOR-WARN] + exit(0). Test 1
// (bare sycophancy) now asserts warn-only — exit 0 + [BEHAVIOR-WARN] in stderr.
// Test 2 (P/O/G evidence exempts) is unchanged — behavioral evidence still
// short-circuits the sycophancy check, so the response is allowed cleanly
// (exit 0, no [BEHAVIOR-WARN] emitted).
const { spawnSync } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'sycophancy-guard.js');
const nodePath = process.execPath;

function runGuard(hookData) {
  const result = spawnSync(nodePath, [scriptPath], {
    timeout: 5000,
    env: { ...process.env, HOOK_DATA: JSON.stringify(hookData) },
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8'
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function pad(text, minLen = 150) {
  if (text.length >= minLen) return text;
  return text + '\n' + 'x'.repeat(minLen - text.length);
}

// Test 1: Bare sycophancy (padded) -> warn-only (exit 0 + [BEHAVIOR-WARN])
const r1 = runGuard({
  stop_response: pad('맞습니다. 그 부분은 제가 잘못 이해했습니다. 추가 설명 부탁드립니다. 좋은 지적이네요. 수정하겠습니다. 감사합니다.')
});

// Test 2: Sycophancy after P/O/G table (behavioral evidence) -> allow (exit 0, no warn)
const r2 = runGuard({
  stop_response: pad('| Item | Prediction | Observation |\n|------|------------|-------------|\n| A | yes | yes |\n\n맞습니다, 검증 결과가 일치합니다.')
});

const r1Warn = r1.exitCode === 0 && r1.stderr.includes('[BEHAVIOR-WARN]');
const r2Clean = r2.exitCode === 0 && !r2.stderr.includes('[BEHAVIOR-WARN]');

if (r1Warn && r2Clean) {
  console.log('PASS:warn+allow');
} else {
  console.log(`FAIL:bare=exit${r1.exitCode}/warn=${r1.stderr.includes('[BEHAVIOR-WARN]')},evidence=exit${r2.exitCode}/warn=${r2.stderr.includes('[BEHAVIOR-WARN]')}`);
  process.exit(1);
}
