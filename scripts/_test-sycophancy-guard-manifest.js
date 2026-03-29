'use strict';
// Minimal behavioral test for verification manifest
// Tests: (1) bare sycophancy blocked, (2) P/O/G evidence exempts
const { execSync } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'sycophancy-guard.js');
const nodePath = process.execPath;

function test(hookData) {
  try {
    execSync(`"${nodePath}" "${scriptPath}"`, {
      timeout: 5000,
      env: { ...process.env, HOOK_DATA: JSON.stringify(hookData) },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return 0;
  } catch (e) {
    return e.status;
  }
}

function pad(text, minLen = 150) {
  if (text.length >= minLen) return text;
  return text + '\n' + 'x'.repeat(minLen - text.length);
}

// Test 1: Bare sycophancy (padded >100 chars) -> should block (exit 2)
const r1 = test({
  stop_response: pad('맞습니다. 그 부분은 제가 잘못 이해했습니다. 추가 설명 부탁드립니다. 좋은 지적이네요. 수정하겠습니다. 감사합니다.')
});

// Test 2: Sycophancy after P/O/G table (behavioral evidence) -> should allow (exit 0)
const r2 = test({
  stop_response: pad('| Item | Prediction | Observation |\n|------|------------|-------------|\n| A | yes | yes |\n\n맞습니다, 검증 결과가 일치합니다.')
});

if (r1 === 2 && r2 === 0) {
  console.log('PASS:block+allow');
} else {
  console.log(`FAIL:bare=${r1},evidence=${r2}`);
  process.exit(1);
}
