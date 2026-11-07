'use strict';
// D143_T013: one record store and one definition of "the project changed". Edits no
// longer write a TESTED/EDITED state (nothing reads it since the commit gate went,
// /status computes from the runner); declared checks stay in checkHistory; completion
// evidence and doc-watchdog use the runner's snapshot and exclusion rule, which leaves
// out Crabshell's own storage (documents, knowledge, memory) except the runner folder.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const scripts = __dirname;
const RUNNER = path.join(scripts, '..', 'skills', 'verifying', 'scripts', 'run-verify.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-record-store-'));
const counters = path.join(base, 'counters');
fs.mkdirSync(counters);
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${error.message.split('\n')[0]}`); }
}
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

function hookProject(name, manifest = { tools: { unit: 'node check.js' }, entries: [] }) {
  const root = path.join(base, name);
  write(root, 'src/app.js', 'module.exports = 1;\n');
  write(root, 'README.md', '# readme\n');
  write(root, '.crabshell/verification/manifest.json', JSON.stringify(manifest));
  write(root, '.crabshell/memory/regressing-state.json', JSON.stringify({ active: true }));
  return root;
}
function runHook([file, ...args], root, payload) {
  const result = spawnSync(process.execPath, [path.join(scripts, file), ...args], {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, CRABSHELL_BACKGROUND: '' },
    input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return result;
}
const statePath = root => path.join(root, '.crabshell', 'memory', 'verification-state.json');
const edit = (root, file, id) => ({ hook_event_name: 'PostToolUse', session_id: 'rs', cwd: root, tool_use_id: id, tool_name: 'Edit',
  tool_input: { file_path: path.join(root, file), old_string: 'a', new_string: 'b' }, tool_response: {} });
const check = (root, id, response, eventName = 'PostToolUse') => ({ hook_event_name: eventName, session_id: 'rs', cwd: root, tool_use_id: id,
  tool_name: 'Bash', tool_input: { command: 'node check.js' }, ...(eventName === 'PostToolUseFailure' ? { error: response } : { tool_response: response }) });
const SUCCESS = { stdout: 'ok', stderr: '', interrupted: false, isImage: false, noOutputExpected: false };

test('an edit writes no verification state', () => {
  const root = hookProject('edit-no-state');
  runHook(['verification-sequence.js', 'record'], root, edit(root, 'src/app.js', 'e1'));
  assert.ok(!fs.existsSync(statePath(root)), `verification-state.json was written: ${fs.existsSync(statePath(root)) && fs.readFileSync(statePath(root), 'utf8')}`);
});

test('a declared check is kept in checkHistory with no TESTED/EDITED fields (currentCheck is what recovery shows)', () => {
  const root = hookProject('check-history');
  runHook(['verification-sequence.js', 'gate'], root, { ...check(root, 'c1'), hook_event_name: 'PreToolUse' });
  runHook(['verification-sequence.js', 'record'], root, check(root, 'c1', SUCCESS));
  const state = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
  for (const field of ['state', 'editsSinceTest', 'lastTestFingerprint', 'lastTestTs']) assert.ok(!(field in state), `${field} still recorded`);
  const { currentCheck } = require('./core/check-history');
  const current = currentCheck(state);
  assert.ok(current && current.passed === true && current.command === 'node check.js', JSON.stringify(current));
  // A result counts only after its start was seen (check-history's tracked starts).
  runHook(['verification-sequence.js', 'gate'], root, { ...check(root, 'c2'), hook_event_name: 'PreToolUse' });
  runHook(['verification-sequence.js', 'record'], root, check(root, 'c2', 'Exit code 1\nfailed', 'PostToolUseFailure'));
  const after = currentCheck(JSON.parse(fs.readFileSync(statePath(root), 'utf8')));
  assert.ok(after && after.passed === false, JSON.stringify(after));
});

test('the shared project state gives the runner snapshot identity and its exclusion rule', () => {
  const projectState = require('../skills/verifying/scripts/runner/project-state');
  const root = hookProject('identity');
  const launcherDir = path.join(root, '.crabshell', 'verification');
  const before = projectState.projectIdentity(root, launcherDir);
  write(root, '.crabshell/ticket/D001_T001-x.md', 'log line\n');
  write(root, '.crabshell/knowledge/K001-x.md', 'note\n');
  assert.strictEqual(projectState.projectIdentity(root, launcherDir), before, 'a Crabshell document changed the project identity');
  write(root, 'src/app.js', 'module.exports = 2;\n');
  assert.notStrictEqual(projectState.projectIdentity(root, launcherDir), before, 'a source change did not change the project identity');
  assert.strictEqual(projectState.isProjectInput(root, launcherDir, path.join(root, 'README.md')), true);
  assert.strictEqual(projectState.isProjectInput(root, launcherDir, path.join(root, '.crabshell', 'ticket', 'D001_T001-x.md')), false);
  assert.strictEqual(projectState.isProjectInput(root, launcherDir, path.join(root, '.crabshell', 'verification', 'manifest.json')), true);
  assert.strictEqual(projectState.isProjectInput(root, launcherDir, path.join(os.tmpdir(), 'elsewhere.js')), false);
});

test('parent evidence survives a ticket write and is dropped by a source write', () => {
  const completion = require('./core/completion-control');
  const root = hookProject('evidence');
  const auth = { session_id: 'rs', prompt: 'Implement and verify the active task.' };
  assert.strictEqual(completion.noteExecutionAuthorization(root, auth).recorded, true);
  assert.strictEqual(completion.noteSubagentStop(root, { ...auth, last_assistant_message: 'Ready for parent verification.' }).recorded, true);
  const observed = completion.recordParentObservation(root, { ...check(root, 'p1', SUCCESS), ...auth });
  assert.strictEqual(observed.recorded, true, JSON.stringify(observed));
  write(root, '.crabshell/ticket/D001_T001-x.md', '## Final Verification\nwritten after the check\n');
  const afterDoc = completion.decideStop(root, { ...auth, hook_event_name: 'Stop' });
  assert.ok(!(afterDoc.action === 'block' && /child report is not completion evidence/.test(afterDoc.reason || '')), `a ticket write dropped the evidence: ${afterDoc.reason}`);
  write(root, 'src/app.js', 'module.exports = 3;\n');
  const afterSource = completion.decideStop(root, { ...auth, hook_event_name: 'Stop' });
  assert.ok(afterSource.action === 'block' && /child report is not completion evidence/.test(afterSource.reason || ''), `a source write kept the evidence: ${JSON.stringify(afterSource)}`);
});

test('content identity: a same-bytes rewrite keeps it, a changed byte does not, and unchanged files are not read again', () => {
  const projectState = require('../skills/verifying/scripts/runner/project-state');
  const root = hookProject('content-identity');
  const launcherDir = path.join(root, '.crabshell', 'verification');
  const cache = path.join(root, '.crabshell', 'memory', 'project-index.json');
  const first = projectState.contentIdentity(root, launcherDir, cache);
  assert.ok(fs.existsSync(cache), 'the hash cache was not written');
  write(root, 'src/app.js', 'module.exports = 1;\n'); // same bytes, new modification time
  assert.strictEqual(projectState.contentIdentity(root, launcherDir, cache), first, 'a same-bytes rewrite changed the identity');
  const originalRead = fs.readFileSync;
  let readmeReads = 0;
  fs.readFileSync = function (target, ...args) { if (String(target).endsWith('README.md')) readmeReads++; return originalRead.call(this, target, ...args); };
  try { projectState.contentIdentity(root, launcherDir, cache); } finally { fs.readFileSync = originalRead; }
  assert.strictEqual(readmeReads, 0, 'an unchanged file was read again');
  write(root, 'src/app.js', 'module.exports = 2;\n');
  assert.notStrictEqual(projectState.contentIdentity(root, launcherDir, cache), first, 'a content change kept the identity');
});

test('doc-watchdog: README is a code edit, a ticket is a document update, an excluded path counts as nothing', () => {
  const watchdog = require('./doc-watchdog');
  const root = hookProject('watchdog', { exclude: ['generated/'], entries: [] });
  // D147_T004: the edit record is per session; session state needs an id of 8+ characters.
  const session = 'recstore-session';
  const sessionEdit = (file, id) => ({ ...edit(root, file, id), session_id: session });
  const count = () => ((require('./core/session-state').readSessionState(root, session, watchdog.STATE_NAME, {}) || {}).editsSinceDocUpdate || 0);
  watchdog.recordEdit(sessionEdit('README.md', 'w1'), root);
  assert.strictEqual(count(), 1, 'README edit was not counted as a code edit');
  watchdog.recordEdit(sessionEdit('generated/out.js', 'w2'), root);
  assert.strictEqual(count(), 1, 'an excluded path was counted');
  write(root, '.crabshell/ticket/D001_T001-x.md', 'x\n');
  watchdog.recordEdit(sessionEdit('.crabshell/ticket/D001_T001-x.md', 'w3'), root);
  assert.strictEqual(count(), 0, 'a ticket edit did not reset the count');
});

// --- Runner: Crabshell's own storage is not an input of a check with unknown inputs ---
const note = id => `require('fs').appendFileSync(require('path').join(process.env.RS_COUNTERS, process.env.RS_NAME + '.txt'), '${id}\\n');`;
function runnerProject(name, storage = '.crabshell') {
  const dir = path.join(base, name);
  write(dir, 'src/a.txt', 'a\n');
  write(dir, `${storage}/discussion/D001-x.md`, 'discussion\n');
  write(dir, 'scripts/_test-doc.js', `${note('DOC')}\nrequire('fs').readFileSync(require('path').join(process.env.PROJECT_ROOT, '${storage}/discussion/D001-x.md'), 'utf8');\n`);
  // git: a non-Node program, so this check's inputs are unknown (the whole project).
  const entries = [{ id: 'G', type: 'structural', command: { file: 'git', args: ['--version'] }, contract: { exitCode: 0 } },
    { id: 'DOC', type: 'structural', command: { file: 'node', args: ['scripts/_test-doc.js'] }, contract: { exitCode: 0 } }];
  write(dir, `${storage}/verification/manifest.json`, JSON.stringify({ schemaVersion: 2, entries }, null, 2));
  copyRunner(RUNNER, path.join(dir, storage, 'verification'));
  return dir;
}
function run(dir, name, storage, args) {
  fs.rmSync(path.join(counters, `${name}.txt`), { force: true });
  const env = { ...process.env, RS_COUNTERS: counters, RS_NAME: name, CRABSHELL_VERIFY_JSON: '' };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  return spawnSync(process.execPath, [path.join(dir, storage, 'verification', 'run-verify.js'), ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, env, timeout: 120000 });
}
const selected = (dir, name, storage) => JSON.parse(run(dir, name, storage, ['--changed', '--dry-run']).stdout).selected.slice().sort();

test('a document edit reruns only the traced check that read it, not the check with unknown inputs', () => {
  const dir = runnerProject('runner-storage');
  const first = run(dir, 'rs1', '.crabshell', []);
  assert.strictEqual(first.status, 0, first.stdout.slice(-400));
  assert.deepStrictEqual(selected(dir, 'rs2', '.crabshell'), [], 'checks selected right after a passing run');
  write(dir, '.crabshell/discussion/D001-x.md', 'discussion edited\n');
  assert.deepStrictEqual(selected(dir, 'rs3', '.crabshell'), ['DOC']);
});

test('a runner outside a .crabshell folder keeps the old rule: only its sibling memory folder is left out', () => {
  const dir = runnerProject('runner-other-storage', 'tools');
  const first = run(dir, 'ro1', 'tools', []);
  assert.strictEqual(first.status, 0, first.stdout.slice(-400));
  write(dir, 'tools/discussion/D001-x.md', 'discussion edited\n');
  assert.deepStrictEqual(selected(dir, 'ro2', 'tools'), ['DOC', 'G'], 'a non-Crabshell folder was treated as Crabshell storage');
});

test('the hook source lists and the content fingerprint are gone', () => {
  const observation = require('./core/command-observation');
  const constants = require('./constants');
  for (const name of ['isSourceFile', 'projectFingerprint']) assert.ok(!(name in observation), `${name} still exported`);
  for (const name of ['NON_SOURCE_EXTENSIONS', 'NON_SOURCE_BASENAMES', 'SOURCE_EXCLUDED_DIRS']) assert.ok(!(name in constants), `${name} still exported`);
});

try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
