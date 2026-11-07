'use strict';
// D143_T014: a declared check is known from the manifest alone — environment assignments
// (POSIX and PowerShell) and declared `wrappers` before it are taken off, a program's
// extension counts only through PATHEXT, discovered entries count — with no Node
// ecosystem table (rtk, npm/pnpm/yarn/bun, package.json "test", echo/printf). A manifest
// entry that the runner already passed with the same inputs is not run again: PreToolUse
// answers from the runner's record, before any start is recorded.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const scripts = __dirname;
const RUNNER = path.join(scripts, '..', 'skills', 'verifying', 'scripts', 'run-verify.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-declared-'));
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const observation = () => require('./core/command-observation');

function project(name, manifest, files = {}) {
  const root = path.join(base, name);
  write(root, '.crabshell/verification/manifest.json', JSON.stringify(manifest, null, 2));
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  return root;
}
const MANIFEST = {
  schemaVersion: 2,
  tools: { test: 'node check.js' },
  wrappers: ['rtk'],
  entries: [
    { id: 'E1', type: 'structural', command: { file: 'node', args: ['check-one.js'] }, contract: { exitCode: 0 } },
    { id: 'D', type: 'behavioral', discover: { pattern: 'tests/_t-*.js' }, contract: { exitCode: 0 } },
  ],
};
const FILES = { 'check.js': '', 'check-one.js': '', 'tests/_t-a.js': '' };

// --- Recognition ---

test('environment assignments before a declared check are taken off (POSIX and PowerShell)', () => {
  const root = project('env', MANIFEST, FILES);
  const { findDeclaration } = observation();
  assert.ok(findDeclaration('FOO=1 BAR="two words" node check.js', root), 'POSIX assignments');
  assert.ok(findDeclaration("$env:FOO='1'; $env:BAR = \"x\"; node check.js", root), 'PowerShell assignments');
  const forced = findDeclaration('CRABSHELL_RERUN=1 node check-one.js', root);
  assert.ok(forced && forced.entryId === 'E1', JSON.stringify(forced));
});

test('a declared wrapper is taken off; an undeclared one is not, and the hint names wrappers', () => {
  const root = project('wrappers', MANIFEST, FILES);
  const { findDeclaration, checkInvocation } = observation();
  assert.ok(findDeclaration('rtk node check.js', root), 'declared wrapper');
  const bare = project('no-wrappers', { ...MANIFEST, wrappers: undefined }, FILES);
  assert.strictEqual(findDeclaration('rtk node check.js', bare), null, 'an undeclared wrapper counted');
  const unwrapped = observation().unwrappedDeclaration('rtk node check.js', bare);
  assert.ok(unwrapped && unwrapped.prefix.join(' ') === 'rtk', JSON.stringify(unwrapped));
  assert.deepStrictEqual(checkInvocation('rtk node check.js', bare, bare).tokens, ['rtk', 'node', 'check.js'], 'an undeclared wrapper was taken off');
});

test('a program extension counts only through PATHEXT', () => {
  const root = project('pathext', MANIFEST, FILES);
  const saved = process.env.PATHEXT;
  try {
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    assert.ok(observation().findDeclaration('node.exe check.js', root), 'node.exe with PATHEXT');
    process.env.PATHEXT = '.RUNME';
    assert.ok(observation().findDeclaration('node.runme check.js', root), 'an extension the code never names');
    assert.strictEqual(observation().findDeclaration('node.exe check.js', root), null, '.exe without PATHEXT listing it');
    delete process.env.PATHEXT;
    assert.strictEqual(observation().findDeclaration('node.exe check.js', root), null, 'no PATHEXT, no stripping');
  } finally {
    if (saved === undefined) delete process.env.PATHEXT; else process.env.PATHEXT = saved;
  }
});

test('a discovered entry is a declared check with its entry id', () => {
  const root = project('discover', MANIFEST, FILES);
  const declaration = observation().findDeclaration('node tests/_t-a.js', root);
  assert.ok(declaration && declaration.entryId === 'D:tests/_t-a.js', JSON.stringify(declaration));
});

test('no Node ecosystem table: package.json test, pnpm/yarn/bun and echo are not declared checks', () => {
  const root = project('no-table', { schemaVersion: 2, entries: [] }, { 'package.json': JSON.stringify({ scripts: { test: 'node check.js' } }), 'check.js': '' });
  const { findDeclaration } = observation();
  for (const command of ['npm test', 'npm run test', 'pnpm test', 'yarn test', 'bun run test', 'echo node check.js']) {
    assert.strictEqual(findDeclaration(command, root), null, command);
  }
  for (const name of ['isTrivialTest', 'hasCheckConfiguration']) assert.ok(!(name in observation()), `${name} still exported`);
});

// --- Same-state rerun: answered from the runner's record ---

function runnerProject(name, extraEntries = []) {
  const root = project(name, {
    schemaVersion: 2,
    tools: { test: 'node .crabshell/verification/run-verify.js', changed: 'node .crabshell/verification/run-verify.js --changed' },
    entries: [
      { id: 'E1', type: 'structural', command: { file: 'node', args: ['check-one.js'] }, contract: { exitCode: 0 } },
      { id: 'FAILS', type: 'structural', command: { file: 'node', args: ['fails.js'] }, contract: { exitCode: 0 } },
      { id: 'ALWAYS', type: 'structural', reuse: false, command: { file: 'node', args: ['always.js'] }, contract: { exitCode: 0 } },
      ...extraEntries,
    ],
  }, {
    'src/a.txt': 'a\n',
    'check-one.js': "require('fs').readFileSync(require('path').join(__dirname, 'src', 'a.txt'), 'utf8');\n",
    'fails.js': 'process.exit(1);\n',
    'always.js': '',
  });
  copyRunner(RUNNER, path.join(root, '.crabshell', 'verification'));
  const env = { ...process.env, CRABSHELL_VERIFY_JSON: '' };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  spawnSync(process.execPath, [path.join(root, '.crabshell', 'verification', 'run-verify.js')], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  return root;
}
function pre(root, command, host = 'claude', extra = {}) {
  const script = host === 'claude' ? ['adapters', 'claude', 'pre-tool-use.js'] : ['adapters', 'codex', 'pre-tool-use.js'];
  const payload = { hook_event_name: 'PreToolUse', session_id: 'dc', turn_id: 't1', cwd: root, tool_use_id: `u${Math.random()}`, tool_name: host === 'claude' ? 'Bash' : 'Bash', tool_input: { command }, ...extra };
  const result = spawnSync(process.execPath, [path.join(scripts, ...script)], {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, CRABSHELL_BACKGROUND: '' }, input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  let output = null;
  try { output = JSON.parse(result.stdout.trim().split('\n').pop()); } catch (_) {}
  const specific = output && output.hookSpecificOutput;
  return { denied: Boolean(specific && specific.permissionDecision === 'deny'), reason: (specific && specific.permissionDecisionReason) || '', context: (specific && specific.additionalContext) || '' };
}
const memoryFile = (root, name) => path.join(root, '.crabshell', 'memory', name);
const readMaybe = file => { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; } };

test('a manifest entry passed with the same inputs is answered from the record, before any start is recorded', () => {
  const root = runnerProject('rerun');
  const before = [readMaybe(memoryFile(root, 'verification-state.json')), readMaybe(memoryFile(root, 'completion-control.json'))];
  const result = pre(root, 'node check-one.js');
  assert.ok(result.denied, `not denied: ${JSON.stringify(result)}`);
  assert.ok(/CRABSHELL_RERUN=1/.test(result.reason) && /passed at/.test(result.reason) && /test-map\.json/.test(result.reason), result.reason);
  assert.deepStrictEqual([readMaybe(memoryFile(root, 'verification-state.json')), readMaybe(memoryFile(root, 'completion-control.json'))], before, 'a start was recorded for a blocked run');
});

test('changed inputs, CRABSHELL_RERUN=1, a failed last run, reuse:false and the runner itself are not blocked', () => {
  const root = runnerProject('not-blocked');
  assert.strictEqual(pre(root, 'CRABSHELL_RERUN=1 node check-one.js').denied, false, 'CRABSHELL_RERUN=1');
  assert.strictEqual(pre(root, 'node fails.js').denied, false, 'failed last time');
  assert.strictEqual(pre(root, 'node always.js').denied, false, 'reuse:false');
  assert.strictEqual(pre(root, 'node .crabshell/verification/run-verify.js --changed').denied, false, 'the runner');
  write(root, 'src/a.txt', 'a changed\n');
  assert.strictEqual(pre(root, 'node check-one.js').denied, false, 'inputs changed');
});

test('no record of this schema means no block', () => {
  const root = runnerProject('old-map');
  fs.writeFileSync(path.join(root, '.crabshell', 'verification', 'test-map.json'), JSON.stringify({ version: 1, entries: {} }));
  assert.strictEqual(pre(root, 'node check-one.js').denied, false);
});

test('Codex answers from the record the same way', () => {
  const root = runnerProject('codex');
  const result = pre(root, 'node check-one.js', 'codex');
  assert.ok(result.denied && /CRABSHELL_RERUN=1/.test(result.reason), JSON.stringify(result));
});

test('a blocked rerun hands the recorded pass to the waiting parent evidence', () => {
  const completion = require('./core/completion-control');
  const root = runnerProject('evidence');
  write(root, '.crabshell/memory/regressing-state.json', JSON.stringify({ active: true }));
  const auth = { session_id: 'dc', prompt: 'Implement and verify the active task.' };
  assert.strictEqual(completion.noteExecutionAuthorization(root, auth).recorded, true);
  assert.strictEqual(completion.noteSubagentStop(root, { ...auth, last_assistant_message: 'Ready.' }).recorded, true);
  assert.ok(pre(root, 'node check-one.js').denied, 'not denied');
  const state = completion.loadState(root, auth);
  assert.ok(state.observation && state.observation.passed === true && state.observation.evidenceSource === 'runner-record', JSON.stringify(state.observation));
  const stop = completion.decideStop(root, { ...auth, hook_event_name: 'Stop' });
  assert.ok(!(stop.action === 'block' && /child report is not completion evidence/.test(stop.reason || '')), stop.reason);
});

test('an undeclared wrapper before a declared check gets a one-line hint and is not blocked', () => {
  const root = project('hint', { ...MANIFEST, wrappers: undefined }, FILES);
  const result = pre(root, 'rtk node check.js');
  assert.ok(!result.denied && /wrappers/.test(result.context), JSON.stringify(result));
});

try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
