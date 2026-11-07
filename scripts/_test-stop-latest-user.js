'use strict';
// D147_T003: after an execution request, a later question or reprimand from the user in
// the same turn ends the Stop hook's "continue" demand; another session's message does
// not. The authorization itself stays. Hooks run as real processes, as the host runs them.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const queued = require('./fixtures/hook-payloads/native/claude-UserPromptSubmit-queued.json');
const promptHook = path.join(__dirname, 'inject-rules.js');
const stopHook = path.join(__dirname, 'completion-controller.js');
const { loadState } = require('./core/completion-control');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); } catch (error) { failed++; console.log(`FAIL: ${name} -- ${error.message}`); }
}

const created = [];
// An active workflow, as in _test-cross-runtime-parent-completion.js.
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-stop-latest-'));
  created.push(root);
  const storage = path.join(root, '.crabshell');
  for (const dir of ['discussion', 'ticket', 'memory']) fs.mkdirSync(path.join(storage, dir), { recursive: true });
  fs.writeFileSync(path.join(storage, 'discussion', 'D777-fixture.md'), '---\nid: D777\nstatus: open\n---\n# D777\n');
  fs.writeFileSync(path.join(storage, 'memory', 'regressing-state.json'), JSON.stringify({
    active: true, phase: 'execution', discussion: 'D777', ticketIds: [], lastUpdatedAt: new Date().toISOString(),
  }));
  return root;
}

function run(script, root, payload) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
  delete env.CRABSHELL_HOOK_CAPTURE_DIR;
  const result = spawnSync(process.execPath, [script], { cwd: root, env, input: JSON.stringify({ cwd: root, transcript_path: null, ...payload }), encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

let n = 0;
// One turn: the prompts in order, then the Stop. `turn` false = a host without turn numbers.
function turn(root, prompts, { turnNumber = true } = {}) {
  n += 1;
  const ids = { session_id: `stopusr${n}-session`, ...(turnNumber ? { prompt_id: `turn-${n}` } : {}) };
  for (const prompt of prompts) {
    const result = run(promptHook, root, { ...ids, hook_event_name: 'UserPromptSubmit', prompt });
    assert.strictEqual(result.status, 0, result.stderr);
  }
  const stop = run(stopHook, root, { ...ids, hook_event_name: 'Stop', stop_hook_active: false, last_user_message: prompts[prompts.length - 1] });
  return { ids, stop, blocked: /"decision":"block"/.test(stop.stdout) };
}

test('an execution request alone keeps the continue demand (unchanged)', () => {
  assert.strictEqual(turn(project(), ['고쳐']).blocked, true);
});

test('a question after the execution request ends the continue demand', () => {
  assert.strictEqual(turn(project(), ['고쳐', '왜 이렇게 했어?']).blocked, false);
});

test('a reprimand after the execution request ends the continue demand', () => {
  assert.strictEqual(turn(project(), ['고쳐', '이런 임기응변 하지 말라고']).blocked, false);
});

test('another session\'s message after the execution request does not change it', () => {
  assert.strictEqual(turn(project(), ['고쳐', queued.prompt]).blocked, true);
});

test('without turn numbers the old behavior stays', () => {
  const root = project();
  const result = turn(root, ['고쳐'], { turnNumber: false });
  assert.strictEqual(result.blocked, true);
});

test('the authorization itself is kept after a question', () => {
  const root = project();
  const { ids } = turn(root, ['고쳐', '왜 이렇게 했어?']);
  const state = loadState(root, ids);
  assert.strictEqual(state.authorizedSessionId, ids.session_id);
  assert.ok(state.authorizedPromptHash, 'authorization kept');
});

test('the Stop hook exits normally (0, or 2 when it blocks on Claude)', () => {
  const root = project();
  const { stop } = turn(root, ['고쳐', '왜?']);
  assert.ok(stop.status === 0 || stop.status === 2, `Stop exit ${stop.status}`);
});

for (const root of created) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {} }
console.log(`\nstop-latest-user: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
