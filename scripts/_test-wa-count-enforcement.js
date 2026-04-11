'use strict';

/**
 * Tests for WA count enforcement system (P115_T001).
 * Covers: classifyAgent, getWaCount, isLightWorkflowActive, wa-count.json state,
 * stop hook block logic, ticketing reset, PARALLEL_REMINDER content.
 *
 * Run: node scripts/_test-wa-count-enforcement.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Isolated temp dir — must be set before requiring any modules
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-count-test-'));
process.env.CLAUDE_PROJECT_DIR = tmpDir;

// Set up .crabshell/memory directory (required by regressing-loop-guard)
const crabMemDir = path.join(tmpDir, '.crabshell', 'memory');
fs.mkdirSync(crabMemDir, { recursive: true });

// --- Module imports (graceful: tests will fail with clear message if module absent) ---
let classifyAgent;
let getWaCount;
let isLightWorkflowActive;
let PARALLEL_REMINDER;

try {
  ({ classifyAgent } = require('./counter'));
} catch (e) {
  // WA1 implementation not yet landed — classifyAgent tests will fail gracefully
}

try {
  ({ getWaCount, isLightWorkflowActive } = require('./regressing-loop-guard'));
} catch (e) {
  // WA1 implementation not yet landed — getWaCount/isLightWorkflowActive tests will fail gracefully
}

try {
  ({ PARALLEL_REMINDER } = require('./inject-rules'));
} catch (e) {
  // inject-rules import failed
}

// --- Test harness ---
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

// Helper: path to wa-count.json in temp project dir
function waCountPath() {
  return path.join(tmpDir, '.crabshell', 'memory', 'wa-count.json');
}

// Helper: path to regressing-state.json in temp project dir
function regressingStatePath() {
  return path.join(crabMemDir, 'regressing-state.json');
}

// Helper: path to skill-active.json in temp project dir
function skillActivePath() {
  return path.join(crabMemDir, 'skill-active.json');
}

// Cleanup helper: remove a file if it exists
function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// =============================================================================
// classifyAgent tests (AC2, AC3)
// =============================================================================

console.log('\n=== classifyAgent() ===\n');

// TC1: prompt with "Work Agent" → returns "WA"
test('prompt with "Work Agent" → "WA"', () => {
  assert.ok(typeof classifyAgent === 'function', 'classifyAgent must be exported from counter.js');
  const result = classifyAgent({ tool_name: 'Agent', tool_input: { prompt: 'You are Work Agent 1, implement the feature.' } });
  assert.strictEqual(result, 'WA', `expected "WA", got "${result}"`);
});

// TC2: prompt with "Review Agent" → returns "RA"
test('prompt with "Review Agent" → "RA"', () => {
  assert.ok(typeof classifyAgent === 'function', 'classifyAgent must be exported from counter.js');
  const result = classifyAgent({ tool_name: 'Agent', tool_input: { prompt: 'You are Review Agent 1, verify the implementation.' } });
  assert.strictEqual(result, 'RA', `expected "RA", got "${result}"`);
});

// TC3: prompt with "verify" → returns "RA"
test('prompt with "verify" → "RA"', () => {
  assert.ok(typeof classifyAgent === 'function', 'classifyAgent must be exported from counter.js');
  const result = classifyAgent({ tool_name: 'Agent', tool_input: { prompt: 'Please verify all the changes are correct.' } });
  assert.strictEqual(result, 'RA', `expected "RA", got "${result}"`);
});

// TC4: prompt with "verification" → returns "RA"
test('prompt with "verification" → "RA"', () => {
  assert.ok(typeof classifyAgent === 'function', 'classifyAgent must be exported from counter.js');
  const result = classifyAgent({ tool_name: 'Agent', tool_input: { prompt: 'Perform verification of the output files.' } });
  assert.strictEqual(result, 'RA', `expected "RA", got "${result}"`);
});

// TC5: prompt with "implement" (no RA pattern) → returns "WA" (default)
test('prompt with "implement" (no RA pattern) → "WA"', () => {
  assert.ok(typeof classifyAgent === 'function', 'classifyAgent must be exported from counter.js');
  const result = classifyAgent({ tool_name: 'Agent', tool_input: { prompt: 'Please implement the new counter logic.' } });
  assert.strictEqual(result, 'WA', `expected "WA" (default), got "${result}"`);
});

// TC6: empty prompt → returns "WA" (default, AC3)
test('empty prompt → "WA" (default, AC3)', () => {
  assert.ok(typeof classifyAgent === 'function', 'classifyAgent must be exported from counter.js');
  const result = classifyAgent({ tool_name: 'Agent', tool_input: { prompt: '' } });
  assert.strictEqual(result, 'WA', `expected "WA" (default), got "${result}"`);
});

// TC7: null tool_input → returns "WA" (fail-safe)
test('null tool_input → "WA" (fail-safe)', () => {
  assert.ok(typeof classifyAgent === 'function', 'classifyAgent must be exported from counter.js');
  const result = classifyAgent({ tool_name: 'Agent', tool_input: null });
  assert.strictEqual(result, 'WA', `expected "WA" (fail-safe), got "${result}"`);
});

// TC8: tool_name !== Agent → returns null
test('tool_name !== "Agent" → null', () => {
  assert.ok(typeof classifyAgent === 'function', 'classifyAgent must be exported from counter.js');
  const result = classifyAgent({ tool_name: 'Bash', tool_input: { prompt: 'Work Agent 1' } });
  assert.strictEqual(result, null, `expected null for non-Agent, got "${result}"`);
});

// =============================================================================
// WA count state file tests (AC1, AC12)
// =============================================================================

console.log('\n=== getWaCount() — state file ===\n');

// TC9: wa-count.json doesn't exist → getWaCount returns 0 (AC12)
test('wa-count.json missing → getWaCount() returns 0 (AC12)', () => {
  assert.ok(typeof getWaCount === 'function', 'getWaCount must be exported from regressing-loop-guard.js');
  removeIfExists(waCountPath());
  const result = getWaCount();
  assert.strictEqual(result, 0, `expected 0 when file missing, got ${result}`);
});

// TC10: wa-count.json has waCount:3 → getWaCount returns 3
test('wa-count.json waCount:3 → getWaCount() returns 3', () => {
  assert.ok(typeof getWaCount === 'function', 'getWaCount must be exported from regressing-loop-guard.js');
  fs.writeFileSync(waCountPath(), JSON.stringify({ waCount: 3, raCount: 1 }));
  const result = getWaCount();
  assert.strictEqual(result, 3, `expected 3, got ${result}`);
  removeIfExists(waCountPath());
});

// TC11: wa-count.json is corrupt JSON → getWaCount returns 0 (fail-open)
test('wa-count.json corrupt JSON → getWaCount() returns 0 (fail-open)', () => {
  assert.ok(typeof getWaCount === 'function', 'getWaCount must be exported from regressing-loop-guard.js');
  fs.writeFileSync(waCountPath(), 'not valid json {{{');
  const result = getWaCount();
  assert.strictEqual(result, 0, `expected 0 on corrupt JSON, got ${result}`);
  removeIfExists(waCountPath());
});

// =============================================================================
// Stop hook WA count block tests (AC5, AC6, AC7, AC8)
//
// These tests check the LOGIC of whether a block would occur by inspecting
// getWaCount() and isRegressingActive()/isLightWorkflowActive() independently.
// Full stop hook integration (process.exit(2)) is validated in AC5/AC6 verification.
// =============================================================================

console.log('\n=== Stop hook WA count block logic ===\n');

// TC12: regressing active + waCount=1 → would block (AC5)
test('regressing active + waCount=1 → block condition true (AC5)', () => {
  assert.ok(typeof getWaCount === 'function', 'getWaCount must be exported');
  // Write regressing-state active
  fs.writeFileSync(regressingStatePath(), JSON.stringify({ active: true }));
  // Write wa-count with waCount=1
  fs.writeFileSync(waCountPath(), JSON.stringify({ waCount: 1, raCount: 0 }));

  const waCount = getWaCount();
  // isRegressingActive is already tested in _test-regressing-loop-guard.js
  // Here we verify that getWaCount returns 1 (the half of the block condition we can unit-test)
  assert.strictEqual(waCount, 1, `expected waCount=1, got ${waCount}`);
  // Block condition: regressing active AND waCount === 1 → both true here
  assert.ok(waCount === 1, 'waCount===1 is the WA-count half of the block condition');

  removeIfExists(regressingStatePath());
  removeIfExists(waCountPath());
});

// TC13: light-workflow active + waCount=1 → would block (AC6)
test('light-workflow active + waCount=1 → block condition true (AC6)', () => {
  assert.ok(typeof isLightWorkflowActive === 'function', 'isLightWorkflowActive must be exported from regressing-loop-guard.js');
  assert.ok(typeof getWaCount === 'function', 'getWaCount must be exported');

  // Write skill-active for light-workflow
  fs.writeFileSync(skillActivePath(), JSON.stringify({ skill: 'light-workflow', active: true }));
  fs.writeFileSync(waCountPath(), JSON.stringify({ waCount: 1, raCount: 0 }));

  const lwActive = isLightWorkflowActive();
  const waCount = getWaCount();

  assert.strictEqual(lwActive, true, `expected isLightWorkflowActive()=true, got ${lwActive}`);
  assert.strictEqual(waCount, 1, `expected waCount=1, got ${waCount}`);

  removeIfExists(skillActivePath());
  removeIfExists(waCountPath());
});

// TC14: regressing active + waCount=2 → no WA-count block (AC7)
test('regressing active + waCount=2 → no WA-count block (AC7)', () => {
  assert.ok(typeof getWaCount === 'function', 'getWaCount must be exported');

  fs.writeFileSync(regressingStatePath(), JSON.stringify({ active: true }));
  fs.writeFileSync(waCountPath(), JSON.stringify({ waCount: 2, raCount: 0 }));

  const waCount = getWaCount();
  // WA-count block only fires when waCount === 1; waCount===2 means no WA-count block
  assert.notStrictEqual(waCount, 1, `waCount=${waCount} must NOT be 1 for no-block condition`);
  assert.ok(waCount >= 2, `expected waCount>=2, got ${waCount}`);

  removeIfExists(regressingStatePath());
  removeIfExists(waCountPath());
});

// TC15: regressing active + waCount=0 → no WA-count block (AC8)
test('regressing active + waCount=0 → no WA-count block (AC8)', () => {
  assert.ok(typeof getWaCount === 'function', 'getWaCount must be exported');

  fs.writeFileSync(regressingStatePath(), JSON.stringify({ active: true }));
  fs.writeFileSync(waCountPath(), JSON.stringify({ waCount: 0, raCount: 0 }));

  const waCount = getWaCount();
  // WA-count block only fires when waCount === 1; waCount===0 means no WA-count block
  assert.strictEqual(waCount, 0, `expected waCount=0, got ${waCount}`);
  assert.ok(waCount !== 1, 'waCount===0 must not trigger WA-count block');

  removeIfExists(regressingStatePath());
  removeIfExists(waCountPath());
});

// TC16: no workflow active + waCount=1 → no block
test('no workflow active + waCount=1 → no WA-count block', () => {
  assert.ok(typeof isLightWorkflowActive === 'function', 'isLightWorkflowActive must be exported');

  // No regressing-state.json, no skill-active.json
  removeIfExists(regressingStatePath());
  removeIfExists(skillActivePath());
  fs.writeFileSync(waCountPath(), JSON.stringify({ waCount: 1, raCount: 0 }));

  const lwActive = isLightWorkflowActive();
  // isRegressingActive() with no file → false (verified in _test-regressing-loop-guard.js)
  assert.strictEqual(lwActive, false, `expected isLightWorkflowActive()=false with no state file, got ${lwActive}`);
  // Both workflow flags false → no block regardless of waCount

  removeIfExists(waCountPath());
});

// =============================================================================
// Reset tests (AC4)
// =============================================================================

console.log('\n=== Ticketing reset (AC4) ===\n');

// TC17: After ticketing reset → waCount=0, raCount=0
test('after ticketing reset → wa-count.json has waCount=0, raCount=0 (AC4)', () => {
  // Simulate pre-reset state: waCount=3, raCount=2
  fs.writeFileSync(waCountPath(), JSON.stringify({ waCount: 3, raCount: 2 }));

  // The reset function (to be exported from counter.js as resetWaCount or similar)
  // We verify the expected post-reset state by reading the file after reset.
  // Since WA1 hasn't implemented this yet, we test the contract:
  // After a ticketing skill invocation, wa-count.json must have waCount=0, raCount=0.
  //
  // If resetWaCount is exported, call it; otherwise mark this as a structural test.
  let resetWaCount;
  try {
    ({ resetWaCount } = require('./counter'));
  } catch (e) {
    // Not yet implemented — test will flag the missing export
  }

  assert.ok(typeof resetWaCount === 'function', 'resetWaCount must be exported from counter.js for ticketing reset (AC4)');

  resetWaCount();

  const raw = fs.readFileSync(waCountPath(), 'utf8');
  const state = JSON.parse(raw);
  assert.strictEqual(state.waCount, 0, `expected waCount=0 after reset, got ${state.waCount}`);
  assert.strictEqual(state.raCount, 0, `expected raCount=0 after reset, got ${state.raCount}`);

  removeIfExists(waCountPath());
});

// =============================================================================
// PARALLEL_REMINDER content test (AC10)
// =============================================================================

console.log('\n=== PARALLEL_REMINDER content (AC10) ===\n');

// TC18: PARALLEL_REMINDER contains "parallel and multiple"
test('PARALLEL_REMINDER contains "parallel and multiple" (AC10)', () => {
  assert.ok(typeof PARALLEL_REMINDER === 'string', 'PARALLEL_REMINDER must be a string exported from inject-rules.js');
  assert.ok(
    PARALLEL_REMINDER.includes('parallel and multiple'),
    `PARALLEL_REMINDER must contain "parallel and multiple". Actual content: "${PARALLEL_REMINDER.substring(0, 200)}"`
  );
});

// =============================================================================
// Cleanup and summary
// =============================================================================

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (e) {
  // Cleanup failure is non-fatal
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAIL: some tests failed');
  process.exit(1);
} else {
  console.log('PASS: all tests passed');
  process.exit(0);
}
