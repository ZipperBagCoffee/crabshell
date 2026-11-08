'use strict';
// D147_T002: the fixed rule block is added once per host turn (Claude prompt_id, Codex
// turn_id); a later prompt in the same turn gets only the changing notices (memory notices
// go on the turn's first prompt only, D149). The turn
// state also keeps the latest intent of text the user wrote (used by the Stop hooks).
// Payload shapes are real captures from Claude Code 2.1.319 (fixtures/hook-payloads).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const turnStart = require('./fixtures/hook-payloads/native/claude-UserPromptSubmit-turn-start.json');
const queued = require('./fixtures/hook-payloads/native/claude-UserPromptSubmit-queued.json');
// The fixed rule block is recognized by its heading, taken from the block itself so a
// reworded heading needs no test change.
const { FIRST_TURN_RULES } = require('./core/first-turn-context');
const CONTRACT = FIRST_TURN_RULES.split('\n').find(line => line.startsWith('## '));
assert.ok(CONTRACT, 'the fixed rule block has a "## " heading to recognize it by');
const claudeEntry = path.join(__dirname, 'inject-rules.js');
const codexEntry = path.join(__dirname, 'adapters', 'codex', 'user-prompt-submit.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); } catch (error) { failed++; console.log(`FAIL: ${name} -- ${error.message}`); }
}

const created = [];
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-turn-state-'));
  created.push(root);
  fs.mkdirSync(path.join(root, '.crabshell', 'memory'), { recursive: true });
  return root;
}

// The hook as the host runs it; the capture variable is removed so the run writes nothing extra.
function run(entry, root, payload) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
  delete env.CRABSHELL_HOOK_CAPTURE_DIR;
  const result = spawnSync(process.execPath, [entry], { cwd: root, env, input: JSON.stringify({ ...payload, cwd: root }), encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  const out = result.stdout.trim();
  return out ? JSON.parse(out).hookSpecificOutput.additionalContext : '';
}

test('the captured turn start and the message queued in the same turn share one prompt_id', () => {
  assert.strictEqual(turnStart.session_id, queued.session_id);
  assert.strictEqual(turnStart.prompt_id, queued.prompt_id);
});

test('a second prompt in the same Claude turn gets no fixed rule block', () => {
  const root = project();
  assert.ok(run(claudeEntry, root, turnStart).includes(CONTRACT), 'first prompt has the block');
  assert.ok(!run(claudeEntry, root, queued).includes(CONTRACT), 'queued prompt in the same turn has no block');
});

test('a new turn gets the block again', () => {
  const root = project();
  run(claudeEntry, root, turnStart);
  assert.ok(run(claudeEntry, root, { ...queued, prompt_id: 'next-turn' }).includes(CONTRACT));
});

test('without a turn number every prompt gets the block (unchanged behavior)', () => {
  const root = project();
  const { prompt_id: _a, ...first } = turnStart;
  const { prompt_id: _b, ...second } = queued;
  assert.ok(run(claudeEntry, root, first).includes(CONTRACT));
  assert.ok(run(claudeEntry, root, second).includes(CONTRACT));
});

test('without a session every prompt gets the block (unchanged behavior)', () => {
  const root = project();
  const { session_id: _a, ...first } = turnStart;
  const { session_id: _b, ...second } = queued;
  assert.ok(run(claudeEntry, root, first).includes(CONTRACT));
  assert.ok(run(claudeEntry, root, second).includes(CONTRACT));
});

test('Codex turn_id works the same way', () => {
  const root = project();
  const payload = { session_id: 'codex-session', turn_id: 'codex-turn', hook_event_name: 'UserPromptSubmit', prompt: 'What changed?' };
  assert.ok(run(codexEntry, root, payload).includes(CONTRACT));
  assert.ok(!run(codexEntry, root, { ...payload, prompt: 'And why?' }).includes(CONTRACT));
});

// D149 contract change: the pending-save notice is no longer repeated on a queued prompt of
// the same turn (it repeated on every prompt while the summarizers ran); a new turn gets it.
test('a pending memory save is noticed on the turn\'s first prompt only, and again on the next turn', () => {
  const root = project();
  const memory = path.join(root, '.crabshell', 'memory');
  fs.writeFileSync(path.join(memory, 'memory-index.json'), JSON.stringify({ deltaReady: true }));
  // A pending save needs the ready flag and enough input (core/memory-notice checkDeltaPending).
  fs.writeFileSync(path.join(memory, 'delta_temp.txt'), 'pending input line\n'.repeat(2000));
  assert.ok(run(claudeEntry, root, turnStart).includes('[CRABSHELL_DELTA]'));
  const second = run(claudeEntry, root, queued);
  assert.ok(!second.includes('[CRABSHELL_DELTA]'), 'notice not repeated in the same turn');
  assert.ok(!second.includes(CONTRACT), 'fixed block dropped');
  assert.ok(run(claudeEntry, root, { ...turnStart, prompt_id: 'turn-state-next-turn' }).includes('[CRABSHELL_DELTA]'), 'next turn noticed');
});

test('latest user intent follows text the user wrote, not another session\'s message, within one turn', () => {
  const root = project();
  const { notePrompt, latestUserIntent } = require('./core/turn-state');
  const payload = { session_id: 'intentA1-session', prompt_id: 'turn-a' };
  notePrompt(root, payload, { intent: 'execution', userAuthored: true, injecting: true });
  assert.strictEqual(latestUserIntent(root, payload), 'execution');
  notePrompt(root, payload, { intent: 'question', userAuthored: true, injecting: true });
  assert.strictEqual(latestUserIntent(root, payload), 'question');
  notePrompt(root, payload, { intent: 'default', userAuthored: false, injecting: true });
  assert.strictEqual(latestUserIntent(root, payload), 'question', 'a non-user message does not change it');
  assert.strictEqual(latestUserIntent(root, { ...payload, prompt_id: 'turn-b' }), null, 'another turn has no value');
});

test('a prompt skipped by the injection frequency does not count as the turn\'s block', () => {
  const root = project();
  const { notePrompt } = require('./core/turn-state');
  const payload = { session_id: 'intentB2-session', prompt_id: 'turn-c' };
  assert.strictEqual(notePrompt(root, payload, { intent: 'question', userAuthored: true, injecting: false }).sameTurn, false);
  assert.strictEqual(notePrompt(root, payload, { intent: 'question', userAuthored: true, injecting: true }).sameTurn, false);
  assert.strictEqual(notePrompt(root, payload, { intent: 'question', userAuthored: true, injecting: true }).sameTurn, true);
});

for (const root of created) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {} }
console.log(`\nturn-state: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
