'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { commandObservation } = require('./core/command-observation');
const completion = require('./core/completion-control');

const fixtureDir = path.join(__dirname, 'fixtures', 'hook-payloads');
const fixtures = Object.fromEntries(['claude-posttooluse-bash-success.json', 'claude-posttoolusefailure-bash.json']
  .map(name => [name, fs.readFileSync(path.join(fixtureDir, name), 'utf8')]));
const success = JSON.parse(fixtures['claude-posttooluse-bash-success.json']);
const failure = JSON.parse(fixtures['claude-posttoolusefailure-bash.json']);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell hook payloads '));
const declaredCommand = 'node acceptance.js';
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${error.message}`); }
}

function setup(name) {
  const root = path.join(temp, name);
  for (const dir of ['memory', 'verification']) fs.mkdirSync(path.join(root, '.crabshell', dir), { recursive: true });
  fs.writeFileSync(path.join(root, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ tools: { test: declaredCommand } }));
  fs.writeFileSync(path.join(root, '.crabshell', 'memory', 'verification-state.json'), JSON.stringify({ state: 'EDITED', editsSinceTest: ['app.js'] }));
  fs.writeFileSync(path.join(root, '.crabshell', 'memory', 'regressing-state.json'), JSON.stringify({ active: true }));
  const authorization = { session_id: success.session_id, prompt: 'Implement and verify the active task.' };
  assert.strictEqual(completion.noteExecutionAuthorization(root, authorization).recorded, true);
  assert.strictEqual(completion.noteSubagentStop(root, { ...authorization, last_assistant_message: 'Ready for parent verification.' }).recorded, true);
  return root;
}

function payloadFor(root, fixture) {
  // The captured successful command searches documents rather than running a
  // check. Substitute only project context and the declared invocation; preserve
  // the captured tool_response exactly. Never rewrite a fixture on disk.
  return { ...fixture, cwd: root, tool_input: { ...fixture.tool_input, command: declaredCommand } };
}

function recordAndGate(root, payload) {
  function run(mode, input) {
    return spawnSync(process.execPath, [path.join(__dirname, 'verification-sequence.js'), mode], {
      cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify(input), encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
  }
  const record = run('record', payload);
  assert.strictEqual(record.status, 0, record.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(root, '.crabshell', 'memory', 'verification-state.json'), 'utf8'));
  const gate = run('gate', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "fixture only"' } });
  // The commit command is hook input only. No git commit is executed.
  return { state, gate, parent: completion.recordParentObservation(root, payload) };
}

test('captured Claude success clears EDITED and supplies passing parent evidence without an exit-code field', () => {
  const root = setup('success');
  const payload = payloadFor(root, success);
  assert.deepStrictEqual(payload.tool_response, success.tool_response);
  const observed = recordAndGate(root, payload);
  assert.strictEqual(observed.state.state, 'TESTED');
  assert.strictEqual(observed.gate.status, 0, observed.gate.stderr);
  assert.strictEqual(observed.parent.recorded, true);
  assert.strictEqual(observed.parent.observation.exitCode, 0);
  assert.strictEqual(observed.parent.observation.passed, true);
});

test('captured failure string cannot clear EDITED or supply passing parent evidence', () => {
  const root = setup('failure');
  const payload = payloadFor(root, failure);
  assert.strictEqual(payload.tool_response, failure.tool_response);
  const observed = recordAndGate(root, payload);
  assert.strictEqual(observed.state.state, 'EDITED');
  assert.strictEqual(observed.gate.status, 2);
  assert.strictEqual(observed.parent.observation.exitCode, 1);
  assert.ok(!observed.parent.observation?.passed);
  assert.ok(!completion.loadState(root).observation?.passed);
});

test('interrupted and running variants remain undetermined through both consumers', () => {
  for (const override of [{ interrupted: true }, { status: 'running' }]) {
    const root = setup(`incomplete-${Object.keys(override)[0]}`);
    const payload = payloadFor(root, success);
    payload.tool_response = { ...success.tool_response, ...override };
    const observation = commandObservation(payload, root);
    assert.strictEqual(observation.conclusive, false);
    const observed = recordAndGate(root, payload);
    assert.strictEqual(observed.state.state, 'EDITED');
    assert.strictEqual(observed.gate.status, 2);
    assert.strictEqual(observed.parent.recorded, false);
    assert.strictEqual(completion.loadState(root).observation, null);
  }
});

test('explicit exit fields and raw exit lines override the success-event inference', () => {
  const root = setup('explicit-results');
  const payload = payloadFor(root, success);
  for (const response of [
    { ...success.tool_response, exitCode: 7 },
    { ...success.tool_response, result: { exit_code: 7 } },
    'Exit code: 7\nfailed',
    failure.tool_response,
  ]) {
    const observation = commandObservation({ ...payload, tool_response: response }, root);
    assert.strictEqual(observation.passed, false);
    assert.notStrictEqual(observation.exitCode, 0);
  }
});

test('error indicators, missing responses and ordinary strings cannot inherit event success', () => {
  const root = setup('invalid-results');
  const payload = payloadFor(root, success);
  const overrides = [{ is_error: true }, { isError: true }, { success: false },
    { error: 'failed' }, { signal: 'SIGTERM' }, { status: 'failed' }];
  const responses = [undefined, null, 'passed', [], ...overrides.map(override => ({ ...success.tool_response, ...override }))];
  for (const response of responses) {
    const observation = commandObservation({ ...payload, tool_response: response }, root);
    assert.strictEqual(observation.passed, false);
    assert.strictEqual(observation.conclusive, false);
  }
});

test('manifest assertions still apply to success inferred from a Claude event', () => {
  const root = setup('asserted-results');
  fs.writeFileSync(path.join(root, '.crabshell', 'verification', 'manifest.json'), JSON.stringify({ entries: [
    { type: 'structural', command: { file: 'node', args: ['acceptance.js'] },
      contract: { exitCode: 0, assertions: [{ kind: 'stdoutJsonEquals', pointer: '/passed', equals: true }] } },
  ] }));
  const observation = commandObservation(payloadFor(root, success), root);
  assert.strictEqual(observation.exitCode, 0);
  assert.strictEqual(observation.passed, false, 'the captured search output does not satisfy the declared JSON assertion');
});

test('the Codex adapter cannot inherit Claude-only evidence from a deliberately wrong-host fixture', () => {
  const root = setup('wrong-host');
  // This is a negative host-boundary test, not a guessed Codex response fixture.
  const payload = payloadFor(root, success);
  const handled = require('./completion-controller').handlePayload(payload, { host: 'codex', projectDir: root });
  assert.strictEqual(handled.result.recorded, false);
  assert.strictEqual(handled.result.reason, 'ambiguous-command-result');
  assert.strictEqual(completion.loadState(root).observation, null);
});

test('the original search command is not a check and captured fixture files remain byte-identical', () => {
  assert.strictEqual(commandObservation(success, path.resolve(__dirname, '..')), null);
  for (const [name, text] of Object.entries(fixtures)) assert.strictEqual(fs.readFileSync(path.join(fixtureDir, name), 'utf8'), text);
});

console.log(`RESULT: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
