'use strict';
// Tests for the parallel work reminder (DELEGATION_REMINDER) in scripts/inject-rules.js
// Run: node tests/_test-parallel-reminder.js

const assert = require('assert');
const path = require('path');

// Set required env vars before requiring the module
process.env.CLAUDE_PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const { shouldInjectDelegationReminder, DELEGATION_REMINDER } = require(
  path.join(__dirname, '../scripts/inject-rules.js')
);

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

console.log('\n=== delegation-reminder tests ===\n');

// 1. Korean parallel keyword → true
test('shouldInjectDelegationReminder("병렬 처리", false) → true', () => {
  const result = shouldInjectDelegationReminder('병렬 처리를 어떻게 하나요?', false);
  assert.strictEqual(result, true, 'Korean 병렬 keyword should trigger injection');
});

// 2. General question without keywords → false
test('shouldInjectDelegationReminder("일반 질문", false) → false', () => {
  const result = shouldInjectDelegationReminder('일반 질문입니다.', false);
  assert.strictEqual(result, false, 'General question without keywords should not trigger');
});

// 3. Regressing active → always true
test('shouldInjectDelegationReminder("anything", true) → true (regressing active)', () => {
  const result = shouldInjectDelegationReminder('anything', true);
  assert.strictEqual(result, true, 'isRegressingActive=true should always trigger injection');
});

// 4. null prompt, not regressing → false
test('shouldInjectDelegationReminder(null, false) → false', () => {
  const result = shouldInjectDelegationReminder(null, false);
  assert.strictEqual(result, false, 'null prompt should return false');
});

// 5. English "parallel" keyword → true
test('shouldInjectDelegationReminder("parallel processing", false) → true', () => {
  const result = shouldInjectDelegationReminder('How do I do parallel processing?', false);
  assert.strictEqual(result, true, 'English parallel keyword should trigger injection');
});

// 6. English "agent" keyword → true
test('shouldInjectDelegationReminder("use an agent", false) → true', () => {
  const result = shouldInjectDelegationReminder('How should I use an agent for this task?', false);
  assert.strictEqual(result, true, 'English agent keyword should trigger injection');
});

// 7. "sequential" keyword → true
test('shouldInjectDelegationReminder("sequential steps", false) → true', () => {
  const result = shouldInjectDelegationReminder('These are sequential steps to follow.', false);
  assert.strictEqual(result, true, 'sequential keyword should trigger injection');
});

// 8. Korean 에이전트 → true
test('shouldInjectDelegationReminder("에이전트 사용", false) → true', () => {
  const result = shouldInjectDelegationReminder('에이전트를 어떻게 사용하나요?', false);
  assert.strictEqual(result, true, 'Korean 에이전트 keyword should trigger injection');
});

// 9. Regressing active + empty prompt still returns true
test('shouldInjectDelegationReminder("", true) → true (regressing overrides empty prompt)', () => {
  const result = shouldInjectDelegationReminder('', true);
  assert.strictEqual(result, true, 'regressing active should override empty prompt');
});

// 10. The prompt hook adds the reminder when shouldInjectDelegationReminder says so, and only then.
// The expected text is the exported constant, so a reworded reminder still passes.
test('the prompt hook injects the reminder on a parallel-work prompt and not on a plain one', () => {
  const fs = require('fs');
  const os = require('os');
  const { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-reminder-hook-'));
  try {
    fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
    const contextFor = (prompt, turn) => {
      const r = spawnSync(process.execPath, [path.join(__dirname, 'inject-rules.js')], { cwd: dir, encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CRABSHELL_BACKGROUND: '', HOOK_DATA: '' },
        input: JSON.stringify({ cwd: dir, session_id: 'parallel-reminder-test', prompt_id: `turn-${turn}`, hook_event_name: 'UserPromptSubmit', prompt }) });
      assert.strictEqual(r.status, 0, String(r.error || r.stderr));
      return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    };
    const parallelPrompt = 'Fix these two files in parallel.';
    const plainPrompt = 'What does this function return?';
    assert.ok(shouldInjectDelegationReminder(parallelPrompt, false) && !shouldInjectDelegationReminder(plainPrompt, false), 'fixture prompts no longer split the trigger');
    const reminder = DELEGATION_REMINDER.trim();
    const heading = reminder.split('\n').find(line => line.startsWith('## '));
    assert.ok(heading, 'the reminder has a heading');
    assert.ok(contextFor(parallelPrompt, 0).includes(reminder), 'the reminder is missing on a parallel-work prompt');
    assert.ok(!contextFor(plainPrompt, 1).includes(heading), 'the reminder appeared on a plain prompt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 11. D110: no fixed worker counts or pairings in the reminder
test('DELEGATION_REMINDER carries no count-driven default', () => {
  assert.ok(!/multiple WAs|1:1|single-file|reviewer count/i.test(DELEGATION_REMINDER), 'must not contain fixed-count delegation policy');
});

// --- Summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
