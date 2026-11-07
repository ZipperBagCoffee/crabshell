'use strict';
// D143_T021: in a git work tree the project walk skips the folders git ignores (a
// dependency folder of thousands of files cost every hook call a second). The list is kept
// beside the records and git is asked again only when a rule file changes or the walk meets
// a folder it has not seen. The verification folder is walked even when git ignores it; a
// folder without git is walked whole; an ignored file a check reads is still its input.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');
const { projectState } = require('../skills/verifying/scripts/runner/project-state');

const RUNNER = path.join(__dirname, '..', 'skills', 'verifying', 'scripts', 'run-verify.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-ignored-folders-'));
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}
const write = (root, rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8', windowsHide: true });
const many = (root, folder, count) => { for (let i = 0; i < count; i++) write(root, `${folder}/f${i}.js`, `module.exports = ${i};\n`); };

// A project: a check that reads src/a.js, a manifest, the runner, optional .gitignore.
function project(root, { gitignore = null, init = true } = {}) {
  write(root, 'src/a.js', 'module.exports = 1;\n');
  write(root, 'checks/a.js', "require('assert').ok(require('../src/a.js'));\n");
  write(root, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2,
    entries: [{ id: 'A', type: 'structural', command: { file: 'node', args: ['checks/a.js'] }, contract: { exitCode: 0 } }] }));
  copyRunner(RUNNER, path.join(root, '.crabshell', 'verification'));
  if (gitignore !== null) write(root, '.gitignore', gitignore);
  if (init) { git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'base'); }
  return root;
}
const files = root => projectState(root, path.join(root, '.crabshell', 'verification')).snapshot().list();
const has = (list, prefix) => list.some(file => file.startsWith(prefix));
// Run with no git on PATH: proves the walk used the kept list.
function withoutGit(fn) {
  const saved = process.env.PATH;
  process.env.PATH = path.dirname(process.execPath);
  try { return fn(); } finally { process.env.PATH = saved; }
}

const main = project(path.join(base, 'main'), { gitignore: 'deps/\nbuild/\n.crabshell/\n' });
many(main, 'deps/pkg', 300);

test('git-ignored folders are not walked; the verification folder is, even when git ignores .crabshell/', () => {
  const list = files(main);
  assert.ok(!has(list, 'deps/'), 'deps/ files in the snapshot');
  assert.ok(list.includes('.crabshell/verification/manifest.json') && list.includes('.crabshell/verification/run-verify.js'), 'verification files missing');
  assert.ok(list.includes('src/a.js'));
});

test('the next walk needs no git: the kept list is reused', () => {
  const list = withoutGit(() => files(main));
  assert.ok(!has(list, 'deps/'), 'deps/ walked without git');
});

test('a new ignored folder is left out at once, and later walks need no git', () => {
  many(main, 'build/out', 200);
  assert.ok(!has(files(main), 'build/'), 'build/ walked');
  assert.ok(!has(withoutGit(() => files(main)), 'build/'), 'build/ walked without git');
});

test('a changed .gitignore is noticed: an unignored folder is walked again', () => {
  write(main, '.gitignore', 'build/\n.crabshell/\n');
  assert.ok(has(files(main), 'deps/'), 'deps/ still skipped after it was unignored');
  write(main, '.gitignore', 'deps/\nbuild/\n.crabshell/\n');
  assert.ok(!has(files(main), 'deps/'), 'deps/ walked after it was ignored again');
});

test('a broken kept list counts as none: the walk still skips ignored folders', () => {
  fs.writeFileSync(path.join(main, '.crabshell', 'verification', 'ignored-folders.json'), '{ broken');
  assert.ok(!has(files(main), 'deps/'), 'deps/ walked after a broken list');
});

test('the kept list is not part of the project', () => {
  assert.ok(!files(main).includes('.crabshell/verification/ignored-folders.json'));
});

test('a folder without git is walked whole', () => {
  const plain = project(path.join(base, 'plain'), { gitignore: 'deps/\n', init: false });
  many(plain, 'deps/pkg', 50);
  assert.ok(has(files(plain), 'deps/'), 'deps/ skipped without git');
});

test('a folder that becomes a repository later is noticed: its ignored folders are skipped from then on', () => {
  const later = project(path.join(base, 'later'), { gitignore: 'deps/\n', init: false });
  many(later, 'deps/pkg', 50);
  assert.ok(has(files(later), 'deps/'), 'deps/ skipped before git');
  git(later, 'init', '-q');
  assert.ok(!has(files(later), 'deps/'), 'deps/ walked after git init');
});

test('a project in a subfolder of a repository uses the repository\'s rules', () => {
  const repo = path.join(base, 'repo');
  write(repo, '.gitignore', 'deps/\n');
  git(repo, 'init', '-q');
  const sub = project(path.join(repo, 'sub'), { init: false });
  many(sub, 'deps/pkg', 50);
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  assert.ok(!has(files(sub), 'deps/'), 'deps/ walked in a subfolder project');
});

test('a worktree: its exclude file is found where git keeps it, and a change to it is noticed', () => {
  const wt = path.join(base, 'worktree');
  assert.strictEqual(git(main, 'worktree', 'add', '-q', wt).status, 0);
  many(wt, 'other/pkg', 30);
  assert.ok(has(files(wt), 'other/'), 'other/ skipped before it was excluded');
  const exclude = path.resolve(wt, git(wt, 'rev-parse', '--git-path', 'info/exclude').stdout.trim());
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  fs.appendFileSync(exclude, '\nother/\n');
  assert.ok(!has(files(wt), 'other/'), 'other/ walked after the exclude file changed');
});

test('an ignored file a check reads stays its input: changing it reruns the check', () => {
  const root = project(path.join(base, 'reads-ignored'), { gitignore: 'deps/\n' });
  write(root, 'deps/lib/x.js', 'module.exports = 1;\n');
  write(root, 'checks/a.js', "require('assert').ok(require('../deps/lib/x.js'));\n");
  const env = { ...process.env, CRABSHELL_VERIFY_JSON: '' };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  const run = args => spawnSync(process.execPath, [path.join(root, '.crabshell', 'verification', 'run-verify.js'), ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.strictEqual(run([]).status, 0);
  assert.deepStrictEqual(JSON.parse(run(['--changed', '--dry-run']).stdout).selected, [], 'reran with nothing changed');
  write(root, 'deps/lib/x.js', 'module.exports = 2;\n');
  assert.deepStrictEqual(JSON.parse(run(['--changed', '--dry-run']).stdout).selected, ['A'], 'the ignored input did not rerun its reader');
});

try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
