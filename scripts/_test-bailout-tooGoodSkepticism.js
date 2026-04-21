// _test-bailout-tooGoodSkepticism.js
// Behavioral regression: BAILOUT keyword must reset all 3 pressure counters
// AND tooGoodSkepticism.retryCount to 0 in memory-index.json.
// Seeds an elevated state, spawns inject-rules.js with BAILOUT prompt,
// then asserts all 4 fields are 0.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const injectRulesPath = path.join(__dirname, 'inject-rules.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { console.log('FAIL: ' + name + ' --- ' + e.message); failed++; }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error((label || '') + ' expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function cleanupDir(dirPath) {
  try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch (e) {}
}

// Write a seeded memory-index.json into a fresh tmp dir.
// `opts` may override feedbackPressure / tooGoodSkepticism defaults.
function seedTmpDir(opts) {
  opts = opts || {};
  const tmpDir = makeTempDir('bailout-tgs');
  const memoryDir = path.join(tmpDir, '.crabshell', 'memory');
  ensureDir(memoryDir);
  ensureDir(path.join(memoryDir, 'logs'));
  const index = {
    version: 1,
    current: 'memory.md',
    rotatedFiles: [],
    stats: { totalRotations: 0, lastRotation: null },
    lastMemoryUpdateTs: null,
  };
  if (opts.feedbackPressure !== null) {
    index.feedbackPressure = opts.feedbackPressure || {
      level: 2, consecutiveCount: 3, decayCounter: 0, oscillationCount: 9, lastShownLevel: 2,
    };
  }
  if (opts.tooGoodSkepticism !== null) {
    if (opts.tooGoodSkepticism) {
      index.tooGoodSkepticism = opts.tooGoodSkepticism;
    }
    // if undefined -> leave absent
  }
  fs.writeFileSync(path.join(memoryDir, 'memory-index.json'), JSON.stringify(index, null, 2), 'utf8');
  return tmpDir;
}

function readIndex(tmpDir) {
  const indexPath = path.join(tmpDir, '.crabshell', 'memory', 'memory-index.json');
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

// Invoke real inject-rules.js synchronously with BAILOUT prompt.
function runBailout(tmpDir) {
  const hookData = JSON.stringify({ prompt: 'BAILOUT' });
  try {
    execFileSync(process.execPath, [injectRulesPath], {
      env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: tmpDir }),
      input: hookData,
      timeout: 10000,
      encoding: 'utf8',
    });
  } catch (e) {
    // inject-rules.js may exit non-zero in some error paths; we don't care here —
    // we only care about the resulting on-disk state.
  }
}

// ============================================================
// Tests
// ============================================================

// T-BAILOUT-1: seeded retryCount=7 → 0 (primary assertion of T001 fix)
test('T-BAILOUT-1: retryCount=7 reset to 0 + 3 pressure counters reset', function() {
  const tmpDir = seedTmpDir({
    feedbackPressure: { level: 2, consecutiveCount: 3, decayCounter: 0, oscillationCount: 9, lastShownLevel: 2 },
    tooGoodSkepticism: { retryCount: 7 },
  });
  try {
    runBailout(tmpDir);
    const index = readIndex(tmpDir);
    const fp = index.feedbackPressure || {};
    const tgs = index.tooGoodSkepticism || {};
    assertEqual(fp.level, 0, 'feedbackPressure.level');
    assertEqual(fp.consecutiveCount, 0, 'feedbackPressure.consecutiveCount');
    assertEqual(fp.oscillationCount, 0, 'feedbackPressure.oscillationCount');
    assertEqual(tgs.retryCount, 0, 'tooGoodSkepticism.retryCount');
  } finally {
    cleanupDir(tmpDir);
  }
});

// T-BAILOUT-2: tooGoodSkepticism absent → BAILOUT must not throw (legacy index).
test('T-BAILOUT-2: tooGoodSkepticism absent, BAILOUT does not throw', function() {
  const tmpDir = seedTmpDir({
    feedbackPressure: { level: 2, consecutiveCount: 3, decayCounter: 0, oscillationCount: 9, lastShownLevel: 2 },
    tooGoodSkepticism: null, // absent
  });
  try {
    runBailout(tmpDir);
    // If the above throws inside the subprocess, the file still exists but we want to
    // confirm the pressure counters were reset (meaning the BAILOUT branch reached
    // its body without aborting early on the absent field).
    const index = readIndex(tmpDir);
    const fp = index.feedbackPressure || {};
    assertEqual(fp.level, 0, 'feedbackPressure.level');
    assertEqual(fp.consecutiveCount, 0, 'feedbackPressure.consecutiveCount');
    assertEqual(fp.oscillationCount, 0, 'feedbackPressure.oscillationCount');
    // tooGoodSkepticism still absent — must not have been auto-created as a side effect.
    if (index.tooGoodSkepticism !== undefined) {
      // Tolerated: some hooks may initialize it; require retryCount===0 if present.
      assertEqual((index.tooGoodSkepticism || {}).retryCount || 0, 0, 'tgs.retryCount');
    }
  } finally {
    cleanupDir(tmpDir);
  }
});

// T-BAILOUT-3: oscillationCount=9 → 0 (explicit per-field check).
test('T-BAILOUT-3: oscillationCount=9 reset to 0', function() {
  const tmpDir = seedTmpDir({
    feedbackPressure: { level: 1, consecutiveCount: 1, decayCounter: 0, oscillationCount: 9, lastShownLevel: 1 },
    tooGoodSkepticism: { retryCount: 0 },
  });
  try {
    runBailout(tmpDir);
    const index = readIndex(tmpDir);
    const fp = index.feedbackPressure || {};
    assertEqual(fp.oscillationCount, 0, 'feedbackPressure.oscillationCount');
  } finally {
    cleanupDir(tmpDir);
  }
});

console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
