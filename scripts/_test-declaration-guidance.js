'use strict';
// D143_T015: the project keeps its check list right by itself. After a declared entry run
// by hand, a one-line hint says what to declare — `inputs` (its inputs are unknown),
// `slow` (it took longer than slowAfterSeconds), `outputs` (it wrote files) — once each.
// An undeclared command that took longer than suggestAfterSeconds and ran twice on the
// same files gets one hint to declare it. `run-verify.js --explain` shows, for each check
// it would run, its first reason, without running anything.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const scripts = __dirname;
const RUNNER = path.join(scripts, '..', 'skills', 'verifying', 'scripts', 'run-verify.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-guidance-'));
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
let serial = 0;

// git is a non-Node program every Crabshell project has, so its check's inputs are unknown.
const ENTRIES = [
  { id: 'GIT', type: 'structural', command: { file: 'git', args: ['--version'] }, contract: { exitCode: 0 } },
  { id: 'GIT_DECLARED', type: 'structural', inputs: ['src/a.txt'], command: { file: 'git', args: ['--help'] }, contract: { exitCode: 0 } },
  { id: 'NODE', type: 'structural', command: { file: 'node', args: ['check-node.js'] }, contract: { exitCode: 0 } },
  { id: 'NODE2', type: 'structural', command: { file: 'node', args: ['check-node2.js'] }, contract: { exitCode: 0 } },
  { id: 'WRITER', type: 'structural', command: { file: 'node', args: ['writer.js'] }, contract: { exitCode: 0 } },
];
function project(name, extra = {}) {
  const root = path.join(base, name);
  write(root, 'src/a.txt', 'a\n');
  for (const file of ['check-node.js', 'check-node2.js', 'writer.js']) write(root, file, '');
  write(root, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries: ENTRIES, ...extra }, null, 2));
  return root;
}
function hook(file, root, payload) {
  const result = spawnSync(process.execPath, [path.join(scripts, 'adapters', 'claude', file)], {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root, CRABSHELL_BACKGROUND: '' }, input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  let output = null;
  try { output = JSON.parse(result.stdout.trim().split('\n').pop()); } catch (_) {}
  const specific = output && output.hookSpecificOutput;
  return { context: (specific && specific.additionalContext) || '', denied: Boolean(specific && specific.permissionDecision === 'deny') };
}
function run(root, command, { duration = 500, during = null } = {}) {
  const id = `u${++serial}`;
  const common = { session_id: 'g', cwd: root, tool_use_id: id, tool_name: 'Bash', tool_input: { command } };
  const before = hook('pre-tool-use.js', root, { ...common, hook_event_name: 'PreToolUse' });
  if (during) during();
  const after = hook('post-tool-use.js', root, { ...common, hook_event_name: 'PostToolUse', duration_ms: duration,
    tool_response: { stdout: 'ok', stderr: '', interrupted: false, isImage: false, noOutputExpected: false } });
  return { before, after, id };
}
const memory = (root, name) => path.join(root, '.crabshell', 'memory', name);

test('a non-Node entry run by hand gets the inputs hint once', () => {
  const root = project('inputs');
  const first = run(root, 'git --version');
  assert.ok(/inputs/.test(first.after.context) && /GIT/.test(first.after.context), first.after.context);
  const second = run(root, 'git --version');
  assert.ok(!/inputs/.test(second.after.context), `hinted twice: ${second.after.context}`);
});

test('a run longer than slowAfterSeconds gets the slow hint; slowAfterSeconds is the manifest\'s', () => {
  const root = project('slow');
  assert.ok(/slow/.test(run(root, 'node check-node.js', { duration: 301000 }).after.context), 'no slow hint over the default 300 s');
  const tuned = project('slow-tuned', { slowAfterSeconds: 1 });
  assert.ok(/slow/.test(run(tuned, 'node check-node2.js', { duration: 2000 }).after.context), 'slowAfterSeconds 1 not honored');
  assert.ok(!/slow/.test(run(project('fast'), 'node check-node.js', { duration: 2000 }).after.context), 'a 2 s run got the slow hint');
});

test('a file the entry wrote in two runs in a row gets the outputs hint; a file another process changed in one run does not', () => {
  const root = project('outputs');
  // First run: the entry writes build/out.txt while another process changes src/a.txt.
  const first = run(root, 'node writer.js', { during: () => { write(root, 'build/out.txt', 'made 1\n'); write(root, 'src/a.txt', 'edited elsewhere\n'); } });
  assert.ok(!/outputs/.test(first.after.context), `hinted after one run: ${first.after.context}`);
  // Second run: only the entry's own product changes again.
  const second = run(root, 'node writer.js', { during: () => write(root, 'build/out.txt', 'made 2\n') });
  assert.ok(/outputs/.test(second.after.context) && /build\/out\.txt/.test(second.after.context) && !/src\/a\.txt/.test(second.after.context), second.after.context);
  assert.deepStrictEqual(fs.existsSync(path.join(root, '.crabshell', 'memory', 'run-snapshots')) ? fs.readdirSync(path.join(root, '.crabshell', 'memory', 'run-snapshots')) : [], [], 'the before-run record was not removed');
});

test('an entry whose outputs are declared gets no outputs hint', () => {
  const declaredEntries = ENTRIES.map(entry => (entry.id === 'WRITER' ? { ...entry, outputs: ['build/'] } : entry));
  const root = project('declared-outputs');
  write(root, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries: declaredEntries }, null, 2));
  run(root, 'node writer.js', { during: () => write(root, 'build/out.txt', 'made 1\n') });
  const second = run(root, 'node writer.js', { during: () => write(root, 'build/out.txt', 'made 2\n') });
  assert.ok(!/outputs/.test(second.after.context), second.after.context);
});

test('the output record drops entries the manifest no longer has', () => {
  const root = project('pruned');
  write(root, '.crabshell/memory/output-candidates.json', JSON.stringify({ REMOVED: ['build/old.txt'], WRITER: [] }));
  run(root, 'node writer.js', { during: () => write(root, 'build/out.txt', 'made 1\n') });
  const stored = JSON.parse(fs.readFileSync(memory(root, 'output-candidates.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(stored), ['WRITER'], JSON.stringify(stored));
});

// D151_T002 contract change: a declared entry run by hand now gets one hint to run it
// through the runner (its pass is not recorded otherwise); nothing else for a fast,
// non-writing entry, and nothing on the next run.
test('a declared, fast, non-writing entry gets only the run-it-through-the-runner hint, once', () => {
  const root = project('quiet');
  const first = run(root, 'node check-node.js').after.context;
  assert.ok(first.includes('run-verify.js') && first.includes('NODE') && first.split('\n').length === 1, first);
  assert.strictEqual(run(root, 'node check-node.js').after.context, '');
});

test('a commit after files changed since the checks passed gets one reminder; right after a check run, none; a change no check reads, none', () => {
  const nodeOnly = [ENTRIES.find(entry => entry.id === 'NODE')];
  const root = project('commit');
  write(root, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries: nodeOnly }, null, 2));
  write(root, 'check-node.js', "require('fs').readFileSync(require('path').join(__dirname, 'src', 'a.txt'));\n");
  copyRunner(RUNNER, path.join(root, '.crabshell', 'verification'));
  // The runner of this temporary project, not of whatever runner started this test.
  const env = { ...process.env };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  const runner = spawnSync(process.execPath, [path.join(root, '.crabshell', 'verification', 'run-verify.js')], { cwd: root, encoding: 'utf8', windowsHide: true, env });
  assert.strictEqual(runner.status, 0, runner.stdout + runner.stderr);
  assert.strictEqual(run(root, 'git commit -m "after the run"').before.context, '', 'reminded right after a passing run');
  write(root, 'README.md', 'notes no check reads\n');
  assert.strictEqual(run(root, 'git commit -m "notes only"').before.context, '', 'reminded for a file no check reads');
  write(root, 'src/a.txt', 'a changed\n');
  const reminded = run(root, 'git commit -m "after a change"').before.context;
  assert.ok(reminded.includes('NODE') && reminded.includes('--changed'), reminded);
  assert.strictEqual(run(root, 'git commit -m "again"').before.context, '', 'reminded twice for the same files');
});

test('an undeclared long command run twice on the same files gets one hint; a file change or a short run gets none', () => {
  const root = project('repeat');
  assert.ok(!/declare/i.test(run(root, 'python long.py', { duration: 20000 }).after.context), 'hinted on the first run');
  assert.ok(/manifest/.test(run(root, 'python long.py', { duration: 20000 }).after.context), 'no hint on the same-state repeat');
  assert.ok(!/manifest/.test(run(root, 'python long.py', { duration: 20000 }).after.context), 'hinted twice');
  run(root, 'python other.py', { duration: 20000 });
  write(root, 'src/a.txt', 'a changed\n');
  assert.ok(!/manifest/.test(run(root, 'python other.py', { duration: 20000 }).after.context), 'hinted after the files changed');
  run(root, 'python quick.py', { duration: 5000 });
  const repeats = JSON.parse(fs.readFileSync(memory(root, 'command-repeats.json'), 'utf8'));
  assert.ok(!JSON.stringify(repeats).includes('quick.py'), 'a short command was recorded');
});

test('a project without a manifest: the repeat hint names the verifying skill', () => {
  const root = path.join(base, 'no-manifest');
  write(root, 'src/a.txt', 'a\n');
  write(root, '.crabshell/memory/.keep', '');
  run(root, 'npm test', { duration: 20000 });
  const second = run(root, 'npm test', { duration: 20000 }).after.context;
  assert.ok(/\/verifying/.test(second), second);
  assert.ok(!fs.existsSync(path.join(root, '.crabshell', 'verification', 'manifest.json')), 'a manifest was written');
});

test('Codex: the completion controller returns the same hint', () => {
  const root = project('codex');
  const handled = require('./completion-controller').handlePayload({ hook_event_name: 'PostToolUse', session_id: 'g', turn_id: 't', cwd: root,
    tool_use_id: 'c1', tool_name: 'Bash', tool_input: { command: 'git --version' }, tool_response: 'git version 2' }, { host: 'codex', projectDir: root });
  assert.ok(handled && /inputs/.test(handled.context || ''), JSON.stringify(handled));
});

// --- Runner --explain ---
function runnerProject(name, extra = {}) {
  const root = path.join(base, name);
  write(root, 'src/a.txt', 'a\n');
  write(root, 'check-one.js', "require('fs').readFileSync(require('path').join(__dirname, 'src', 'a.txt'), 'utf8');\n");
  write(root, 'check-two.js', '');
  write(root, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries: [
    { id: 'ONE', type: 'structural', command: { file: 'node', args: ['check-one.js'] }, contract: { exitCode: 0 } },
    { id: 'TWO', type: 'structural', command: { file: 'node', args: ['check-two.js'] }, contract: { exitCode: 0 } },
  ], ...extra }, null, 2));
  copyRunner(RUNNER, path.join(root, '.crabshell', 'verification'));
  return root;
}
function runner(root, args) {
  const env = { ...process.env, CRABSHELL_VERIFY_JSON: '' };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  return spawnSync(process.execPath, [path.join(root, '.crabshell', 'verification', 'run-verify.js'), ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
}

test('--explain names each check it would rerun with its first reason, and runs nothing', () => {
  const root = runnerProject('explain');
  assert.strictEqual(runner(root, []).status, 0);
  const nothing = runner(root, ['--explain']);
  assert.strictEqual(nothing.status, 0, nothing.stderr);
  assert.ok(/no check/i.test(nothing.stdout), nothing.stdout);
  write(root, 'src/a.txt', 'a changed\n');
  const mapFile = path.join(root, '.crabshell', 'verification', 'test-map.json');
  const before = fs.readFileSync(mapFile, 'utf8');
  const explained = runner(root, ['--explain']);
  assert.strictEqual(explained.status, 0, explained.stderr);
  assert.ok(/ONE/.test(explained.stdout) && /src\/a\.txt/.test(explained.stdout) && !/TWO/.test(explained.stdout), explained.stdout);
  assert.strictEqual(fs.readFileSync(mapFile, 'utf8'), before, '--explain changed the records');
});

test('suggestAfterSeconds must be a positive number', () => {
  const root = runnerProject('bad-suggest', { suggestAfterSeconds: 0 });
  const result = runner(root, ['--changed', '--dry-run']);
  assert.ok(/suggestAfterSeconds/.test(result.stdout + result.stderr), result.stdout.slice(-300));
});

test('a rerun blocked by its record leaves no before-run record', () => {
  const root = runnerProject('blocked');
  runner(root, []);
  const result = run(root, 'node check-one.js');
  assert.ok(result.before.denied, 'the up-to-date rerun was not blocked');
  const folder = path.join(root, '.crabshell', 'memory', 'run-snapshots');
  assert.deepStrictEqual(fs.existsSync(folder) ? fs.readdirSync(folder) : [], [], 'a before-run record was written for a blocked run');
});

// Codex: the real PreToolUse process, then the after-run handler.
function codexPre(root, payload) {
  const result = spawnSync(process.execPath, [path.join(scripts, 'adapters', 'codex', 'pre-tool-use.js')], {
    cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: '', CRABSHELL_BACKGROUND: '' }, input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return result.stdout;
}
function codexRun(root, command, during = null) {
  const common = { session_id: 'g', turn_id: 't', cwd: root, tool_use_id: `c${++serial}`, tool_name: 'Bash', tool_input: { command } };
  const before = codexPre(root, { ...common, hook_event_name: 'PreToolUse' });
  if (during) during();
  const after = require('./completion-controller').handlePayload({ ...common, hook_event_name: 'PostToolUse', tool_response: 'done' }, { host: 'codex', projectDir: root });
  return { before, context: (after && after.context) || '' };
}

test('Codex: a blocked rerun leaves no before-run record; a file the entry wrote in two runs gets the outputs hint', () => {
  const blocked = runnerProject('codex-blocked');
  runner(blocked, []);
  const denied = codexPre(blocked, { hook_event_name: 'PreToolUse', session_id: 'g', turn_id: 't', cwd: blocked, tool_use_id: 'c-blocked', tool_name: 'Bash', tool_input: { command: 'node check-one.js' } });
  assert.ok(/"permissionDecision":"deny"/.test(denied), denied);
  const folder = path.join(blocked, '.crabshell', 'memory', 'run-snapshots');
  assert.deepStrictEqual(fs.existsSync(folder) ? fs.readdirSync(folder) : [], [], 'a before-run record was written for a blocked run');
  const root = project('codex-outputs');
  codexRun(root, 'node writer.js', () => write(root, 'build/out.txt', 'made 1\n'));
  const second = codexRun(root, 'node writer.js', () => write(root, 'build/out.txt', 'made 2\n'));
  assert.ok(/outputs/.test(second.context) && /build\/out\.txt/.test(second.context), second.context);
});

try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
