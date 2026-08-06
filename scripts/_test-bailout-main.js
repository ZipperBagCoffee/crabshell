'use strict';

const path = require('path');
const utils = require('./utils');
const jsonMode = process.argv.includes('--json');

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    if (!jsonMode) console.log(`PASS: ${label}`);
    passed++;
    return;
  }
  if (!jsonMode) {
    console.error(`FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  failed++;
}

let currentState;
let lockCount = 0;
let releaseCount = 0;
let writeCount = 0;

utils.readIndexSafe = () => currentState;
utils.readJsonOrDefault = (_filePath, fallback) => fallback;
utils.acquireIndexLock = () => {
  lockCount++;
  return true;
};
utils.releaseIndexLock = () => {
  releaseCount++;
};
utils.writeJson = () => {
  writeCount++;
};

const { main } = require('./inject-rules');
const projectDir = path.resolve(__dirname, '..');

async function runPrompt(prompt, host) {
  let output = '';
  const originalLog = console.log;
  const originalError = console.error;
  console.log = value => {
    output += String(value);
  };
  console.error = () => {};
  try {
    await main({
      hookData: { prompt },
      projectDir,
      host,
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return output;
}

async function testBailoutKeyword(keyword, host) {
  currentState = {
    feedbackPressure: {
      level: 3,
      consecutiveCount: 3,
      decayCounter: 2,
      oscillationCount: 4,
      lastShownLevel: 3,
    },
    tooGoodSkepticism: {
      retryCount: 5,
    },
  };
  lockCount = 0;
  releaseCount = 0;
  writeCount = 0;

  const output = await runPrompt(keyword, host);

  const label = `${host} ${keyword}`;
  assertEqual(lockCount, 1, `${label}: acquires the index lock`);
  assertEqual(releaseCount, 1, `${label}: releases the index lock`);
  assertEqual(writeCount, 1, `${label}: persists the reset`);
  assertEqual(currentState.feedbackPressure.level, 0, `${label}: resets level`);
  assertEqual(currentState.feedbackPressure.consecutiveCount, 0, `${label}: resets consecutiveCount`);
  assertEqual(currentState.feedbackPressure.decayCounter, 0, `${label}: keeps decayCounter at zero`);
  assertEqual(currentState.feedbackPressure.oscillationCount, 0, `${label}: resets oscillationCount`);
  assertEqual(currentState.feedbackPressure.lastShownLevel, 0, `${label}: resets lastShownLevel`);
  assertEqual(currentState.tooGoodSkepticism.retryCount, 0, `${label}: resets retryCount`);
  assertEqual(/PRESSURE L3|Pressure L3/.test(output), false, `${label}: does not reinject L3 pressure`);
}

async function testQuestionRemainsReadOnly() {
  currentState = {
    feedbackPressure: {
      level: 3,
      consecutiveCount: 3,
      decayCounter: 2,
      oscillationCount: 4,
      lastShownLevel: 3,
    },
    tooGoodSkepticism: {
      retryCount: 5,
    },
  };
  lockCount = 0;
  releaseCount = 0;
  writeCount = 0;

  const output = await runPrompt('이 압력 상태가 왜 유지되는 거야?', 'claude');

  assertEqual(lockCount, 0, 'ordinary question: does not acquire the index lock');
  assertEqual(releaseCount, 0, 'ordinary question: does not release an unheld lock');
  assertEqual(writeCount, 0, 'ordinary question: does not persist state');
  assertEqual(currentState.feedbackPressure.level, 3, 'ordinary question: leaves pressure unchanged');
  // v21.113.0 (I083 R4): pressure is telemetry-only — never reinjected into model context
  assertEqual(/PRESSURE L3|Pressure L3/.test(output), false, 'ordinary question: does not surface pressure to the model');
}

(async () => {
  await testBailoutKeyword('봉인해제', 'claude');
  await testBailoutKeyword('UNLEASH', 'codex');
  await testQuestionRemainsReadOnly();

  if (jsonMode) {
    console.log(JSON.stringify({
      passed: failed === 0,
      passedCount: passed,
      failedCount: failed,
    }));
  } else {
    console.log('');
    console.log(`Results: ${passed} passed, ${failed} failed`);
  }
  process.exit(failed > 0 ? 1 : 0);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
