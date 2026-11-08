'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { commandObservation, isTestExecution } = require('./core/command-observation');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-command-'));
// The fixture project is removed when the process exits, pass or fail.
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
const verification = path.join(root, '.crabshell', 'verification');
fs.mkdirSync(verification, { recursive: true });
const manifestPath = path.join(verification, 'manifest.json');
const manifest = { tools: { test: 'node .crabshell/verification/run-verify.js' }, entries: [
  { type: 'structural', command: { file: 'node', args: ['acceptance check.js'] }, contract: { exitCode: 0 } },
] };
fs.writeFileSync(manifestPath, JSON.stringify(manifest));
fs.writeFileSync(path.join(root, 'acceptance check.js'), "require('assert').strictEqual(6 * 7, 42); console.log('Arithmetic assertion passed');\n");
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS: ${name}`);
}
function observe(command, tool_response) {
  return commandObservation({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response }, root);
}
function sequence(command, response) {
  const memory = path.join(root, '.crabshell', 'memory');
  fs.mkdirSync(memory, { recursive: true });
  const stateFile = path.join(memory, 'verification-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ state: 'EDITED', editsSinceTest: ['app.js'] }));
  const result = spawnSync(process.execPath, [path.join(__dirname, 'verification-sequence.js'), 'record'], {
    input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_response: response }),
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', windowsHide: true,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  // D143_T013: the record keeps the declared check as it ran (no TESTED/EDITED state).
  const check = require('./core/check-history').currentCheck(JSON.parse(fs.readFileSync(stateFile, 'utf8')));
  return check && check.passed === true ? (check.required === false ? 'entry-pass' : 'required-pass') : 'no-pass';
}

test('official runner and arbitrary declared check are recognized without filename patterns', () => {
  assert.strictEqual(isTestExecution(manifest.tools.test, root), true);
  assert.strictEqual(isTestExecution('node "acceptance check.js"', root), true);
  assert.strictEqual(isTestExecution('node _test-undeclared.js', root), false);
});
// P179: a single manifest entry passing is evidence, but only the project's own check
// (manifest tools / package.json test) marks the tree verified (D143: commits are not blocked).
test('real assertion exit and output pass the entry, recorded as a single entry, not the required check', () => {
  const run = spawnSync(process.execPath, ['acceptance check.js'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.match(run.stdout, /Arithmetic assertion passed/);
  const response = { exitCode: run.status, stdout: run.stdout, stderr: run.stderr };
  assert.strictEqual(observe('node "acceptance check.js"', response).passed, true);
  assert.strictEqual(observe('node "acceptance check.js"', response).required, false);
  assert.strictEqual(sequence('node "acceptance check.js"', response), 'entry-pass');
});
test('official runner actually executes the declared check and supplies passing evidence', () => {
  copyRunner(path.join(__dirname, '..', 'skills', 'verifying', 'scripts', 'run-verify.js'), verification);
  manifest.entries[0].id = 'arithmetic';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  // This test can itself run inside the declared verification runner; the fixture's
  // own full run must not inherit that runner's nested-run guard.
  const fixtureEnv = { ...process.env };
  delete fixtureEnv.CRABSHELL_VERIFY_RUNNING;
  delete fixtureEnv.PROJECT_ROOT;
  const run = spawnSync(process.execPath, ['.crabshell/verification/run-verify.js'], { cwd: root, env: fixtureEnv, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /Verification Results: PASS: 1 \/ FAIL: 0/);
  const response = { exitCode: run.status, stdout: run.stdout };
  assert.strictEqual(observe(manifest.tools.test, response).passed, true);
  assert.strictEqual(sequence(manifest.tools.test, response), 'required-pass');
});
test('declared output assertions are required in addition to exit zero', () => {
  manifest.tools.direct = 'node "acceptance check.js"';
  manifest.entries[0].contract.assertions = [{ kind: 'stdoutJsonEquals', pointer: '/answer', equals: 42 }];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.strictEqual(observe('node "acceptance check.js"', { exitCode: 0, stdout: 'npm test' }).passed, false);
  assert.strictEqual(observe('node "acceptance check.js"', { exitCode: 0, stdout: '{"answer":41}' }).passed, false);
  assert.strictEqual(observe('node "acceptance check.js"', { exitCode: 0, stdout: '{"answer":42}' }).passed, true);
  delete manifest.entries[0].contract.assertions;
  delete manifest.tools.direct;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
});
// D143_T014: the manifest alone declares checks — no package.json script is followed and
// no package-manager spelling is known, whatever the project's language.
test('package.json scripts are not declared checks; the manifest declares them', () => {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: {
    test: 'npm run unusual-acceptance-name', 'unusual-acceptance-name': 'node package-acceptance.js',
  } }));
  assert.strictEqual(isTestExecution('npm test', root), false);
  assert.strictEqual(isTestExecution('npm run unusual-acceptance-name', root), false);
  assert.strictEqual(isTestExecution('node package-acceptance.js', root), false);
  manifest.tools.package = 'npm test';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.strictEqual(isTestExecution('npm test', root), true);
  delete manifest.tools.package;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.rmSync(path.join(root, 'package.json'));
});
test('executed test-name printer is not verification and records no pass', () => {
  const source = "console.log('npm test')";
  const run = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(run.status, 0);
  const command = `node -e "${source}"`;
  const response = { exitCode: run.status, stdout: run.stdout };
  assert.strictEqual(observe(command, response), null);
  assert.strictEqual(sequence(command, response), 'no-pass');
});
test('missing, running, interrupted, failed and string-only responses record no pass', () => {
  const responses = [undefined, 'passed',
    { exitCode: 0, interrupted: true }, { exitCode: 0, is_error: true },
    { exitCode: 0, result: { status: 'failed' } }, { exitCode: 0, status: 'running' },
    { exit_code: 0, session_id: 81 }, { exitCode: 1, stdout: 'passed' },
    { exitCode: 0, signal: 'SIGTERM' }];
  for (const response of responses) {
    assert.strictEqual(observe('node "acceptance check.js"', response).passed, false, JSON.stringify(response));
    assert.strictEqual(sequence('node "acceptance check.js"', response), 'no-pass');
  }
});
test('clean Claude PostToolUse objects use event success rather than requiring synthetic exit fields', () => {
  // These three old synthetic negative cases contradicted Claude's successful
  // event contract. Their stdout/status fields are not the source of success.
  // The command is also declared as a project tool, so it is a required check (P179).
  manifest.tools.direct = 'node "acceptance check.js"';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  for (const response of [{ stdout: 'passed' }, { success: true, status: 'completed' }, { stdout: 'Exit code: 0' }]) {
    assert.strictEqual(observe('node "acceptance check.js"', response).passed, true);
    assert.strictEqual(sequence('node "acceptance check.js"', response), 'required-pass');
    const withoutEvent = commandObservation({ tool_name: 'Bash', tool_input: { command: 'node "acceptance check.js"' }, tool_response: response }, root);
    assert.strictEqual(withoutEvent.conclusive, false);
  }
  delete manifest.tools.direct;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
});
test('changing manifest input changes recognized commands without reader or expectation changes', () => {
  function checkDeclaredInput(file) {
    manifest.entries[0].command.args[0] = file;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.strictEqual(isTestExecution(`node "${file}"`, root), true);
  }
  checkDeclaredInput('first arbitrary name.js');
  checkDeclaredInput('second unrelated name.js');
  assert.strictEqual(isTestExecution('node "first arbitrary name.js"', root), false);
});
test('compound commands cannot hide a failed check behind a successful last process', () => {
  assert.strictEqual(isTestExecution('node "second unrelated name.js"; echo PASS', root), false);
  assert.strictEqual(isTestExecution('echo "node .crabshell/verification/run-verify.js"', root), false);
});
console.log(`RESULT: ${passed} passed, 0 failed`);
