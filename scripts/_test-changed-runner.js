'use strict';
// D119 P179_T001: the verification runner discovers test files by convention and,
// with --changed, runs only the checks that touch the changed files — and falls
// back to everything whenever it cannot know (no or stale load map, a file outside
// the map, a file every check depends on).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const REPO = path.join(__dirname, '..');
const RUNNER = process.env.CRABSHELL_TEST_RUNNER || path.join(REPO, 'skills', 'verifying', 'scripts', 'run-verify.js');
const root = h.makeWorkRoot('changed-runner');
const report = h.createReporter('changed-runner');
const CRAB = '.crab' + 'shell';

function write(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function git(dir, ...args) {
  return spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
}

// A small repository: two libraries, a child script started by a path string in a
// fresh environment (so load tracing cannot see it), a test that reads a document,
// and the files every check depends on.
function fixture(name, manifestEntries) {
  const dir = path.join(root, name);
  write(dir, 'package.json', JSON.stringify({ name: 'fixture', private: true }));
  write(dir, 'hooks/hooks.json', '{"hooks":{}}\n');
  write(dir, '.claude-plugin/plugin.json', JSON.stringify({ version: '1.0.0' }));
  write(dir, 'scripts/constants.js', 'module.exports = { LIMIT: 1 };\n');
  write(dir, 'scripts/utils.js', 'module.exports = { id: x => x };\n');
  write(dir, 'scripts/lib-a.js', "require('./constants');\nmodule.exports = 1;\n");
  write(dir, 'scripts/lib-b.js', 'module.exports = 2;\n');
  write(dir, 'scripts/child.js', 'process.exit(0);\n');
  write(dir, 'docs/guide.md', '# Guide\n');
  write(dir, 'scripts/_test-a.js', "if (require('./lib-a') !== 1) process.exit(1);\n");
  write(dir, 'scripts/_test-b.js', "if (require('./lib-b') !== 2) process.exit(1);\n");
  write(dir, 'scripts/_test-spawn.js', [
    "const path = require('path');",
    "const { spawnSync } = require('child_process');",
    "// Fresh environment: no NODE_OPTIONS reaches the child.",
    "const r = spawnSync(process.execPath, [path.join(__dirname, 'child.js')], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });",
    'process.exit(r.status);',
  ].join('\n') + '\n');
  write(dir, 'scripts/_test-doc.js', "const fs = require('fs'); const path = require('path');\nif (!fs.readFileSync(path.join(__dirname, '..', 'docs', 'guide.md'), 'utf8').includes('Guide')) process.exit(1);\n");
  fs.mkdirSync(path.join(dir, CRAB, 'verification'), { recursive: true });
  copyRunner(RUNNER, path.join(dir, CRAB, 'verification'));
  const entries = manifestEntries || [
    { id: 'V001', ia: 'light non-test check', type: 'structural', command: { file: 'node', args: ['-e', 'process.exit(0)'] }, contract: { exitCode: 0 } },
    { id: 'V002', ia: 'every test file', type: 'behavioral', discover: { pattern: 'scripts/_test-*.js', exclude: [] }, contract: { exitCode: 0, assertions: [], forbiddenChanges: ['docs/guide.md'] }, timeout: 30000 },
  ];
  // The project, not the runner, names the files every check depends on.
  const changed = { global: ['hooks/*.json', 'scripts/constants.js', 'scripts/utils.js', '.claude-plugin/plugin.json'] };
  write(dir, `${CRAB}/verification/manifest.json`, JSON.stringify({ schemaVersion: 2, tools: { test: 'node .crabshell/verification/run-verify.js', changed: 'node .crabshell/verification/run-verify.js --changed' }, changed, entries }, null, 2));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'fixture@example.com');
  git(dir, 'config', 'user.name', 'fixture');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture');
  return dir;
}

function runner(dir, args, extraEnv = {}) {
  const env = { ...process.env, PROJECT_ROOT: dir, CRABSHELL_VERIFY_JSON: '1', ...extraEnv };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CRABSHELL_VERIFY_RUNNING; // this test may itself run inside a declared check
  const result = spawnSync(process.execPath, [path.join(dir, CRAB, 'verification', 'run-verify.js'), ...args], { cwd: dir, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (result.error) throw result.error;
  return result;
}
// D143_T009: checks are chosen by the content of their inputs, so a change is a real
// edit. Each listed file gets one more line for the dry run; afterwards its bytes and
// modification time are put back so the next case starts from the same tree (a check
// with unknown inputs counts a moved time as a change).
function dryRun(dir, files) {
  const saved = [];
  for (const rel of files || []) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) continue;
    const stat = fs.statSync(file);
    saved.push([file, fs.readFileSync(file), stat.atime, stat.mtime]);
    fs.appendFileSync(file, '\n');
  }
  try {
    const result = runner(dir, ['--changed', '--dry-run']);
    try { return JSON.parse(result.stdout); } catch { return { parseError: true, stdout: result.stdout.slice(0, 200), stderr: result.stderr.slice(0, 200), status: result.status }; }
  } finally {
    for (const [file, bytes, atime, mtime] of saved) { fs.writeFileSync(file, bytes); fs.utimesSync(file, atime, mtime); }
  }
}
const reasonOf = (plan, file) => String((plan.reasons || {})[(plan.selected || []).find(id => id.endsWith(file))] || '');
const selectsTest = (plan, file) => Array.isArray(plan.selected) && plan.selected.some(id => id.endsWith(file));
const show = plan => JSON.stringify(plan).slice(0, 220);
// Failure may refresh execution metadata, but never dependency records/hashes.
function dependencyMap(file) {
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  map.entries = Object.fromEntries(Object.entries(map.entries).filter(([, record]) => Array.isArray(record.files))
    .map(([id, { passKey, lastDurationMs, passedAt, ...record }]) => [id, record]));
  return JSON.stringify(map);
}

const dir = fixture('main');
const mapPath = path.join(dir, CRAB, 'verification', 'test-map.json');

{
  const plan = dryRun(dir, ['scripts/lib-a.js']);
  report.check('R1 without a load map, --changed runs everything and says why (every check is new)', plan.full === true && /\b5 new\b/.test(String(plan.reason)), show(plan));
}
{
  const full = runner(dir, []);
  const discovered = (full.stdout.match(/"id": "V002:scripts\/_test-[^"]+"/g) || []).length;
  report.check('R2 a full run discovers every scripts/_test-*.js file (4 here) and passes', full.status === 0 && discovered === 4, `exit=${full.status} discovered=${discovered} ${full.stdout.slice(-120)}`);
  report.check('R2 ...and writes the load map', fs.existsSync(mapPath));
}
{
  const plan = dryRun(dir, ['scripts/lib-a.js']);
  report.check('R3 a changed library selects only the tests that load it',
    plan.full === false && selectsTest(plan, '_test-a.js') && !selectsTest(plan, '_test-b.js') && !selectsTest(plan, '_test-doc.js') && !selectsTest(plan, '_test-spawn.js'), show(plan));
  report.check('R3 ...and always keeps the light non-test checks', Array.isArray(plan.selected) && plan.selected.includes('V001'), show(plan));
}
{
  const plan = dryRun(dir, ['scripts/child.js']);
  report.check('R4 a script started by a path string (invisible to tracing) selects the test that starts it',
    plan.full === false && selectsTest(plan, '_test-spawn.js') && !selectsTest(plan, '_test-a.js'), show(plan));
}
{
  const plan = dryRun(dir, ['docs/guide.md']);
  report.check('R5 a changed document selects only the tests that read it', plan.full === false && selectsTest(plan, '_test-doc.js') && !selectsTest(plan, '_test-a.js'), show(plan));
}
{
  const plan = dryRun(dir, ['scripts/_test-b.js']);
  report.check('R6 a changed test file selects that test', plan.full === false && selectsTest(plan, '_test-b.js') && !selectsTest(plan, '_test-a.js'), show(plan));
}
// The project's changed.global files (an older manifest field) are inputs of every check.
for (const file of ['scripts/constants.js', 'scripts/utils.js', 'hooks/hooks.json', '.claude-plugin/plugin.json']) {
  const plan = dryRun(dir, [file]);
  report.check(`R7 control: a change to ${file} (changed.global) runs everything`, plan.full === true, show(plan));
}
{
  // D143_T009: no file name is special any more; package.json is read by no check here,
  // so only the check with unknown inputs (V001 reads no file) runs.
  const plan = dryRun(dir, ['package.json']);
  report.check('R7 package.json is not special: only the check with unknown inputs runs', plan.full === false && (plan.selected || []).join(',') === 'V001', show(plan));
}
{
  write(dir, 'scripts/new-lib.js', 'module.exports = 3;\n');
  const plan = dryRun(dir, ['scripts/new-lib.js']);
  // V001 reads no file, so the whole project is its input and any touch reruns it (the
  // dry runs above touched files); no test reads the new file.
  report.check('R8 a new file no check reads selects no test, only the check with unknown inputs',
    plan.full === false && (plan.selected || []).join(',') === 'V001' && /unknown inputs/.test(reasonOf(plan, 'V001')), show(plan));
  fs.rmSync(path.join(dir, 'scripts', 'new-lib.js'));
}
{
  const libB = fs.readFileSync(path.join(dir, 'scripts', 'lib-b.js'));
  fs.writeFileSync(path.join(dir, 'scripts', 'lib-b.js'), 'module.exports = 2; // edited\n');
  const plan = dryRun(dir, null);
  report.check('R9 an edit in the working tree (lib-b.js) selects its test',
    plan.full === false && selectsTest(plan, '_test-b.js') && !selectsTest(plan, '_test-a.js'), show(plan));
  // Put the bytes back (a git checkout may rewrite line endings, which is a real change).
  fs.writeFileSync(path.join(dir, 'scripts', 'lib-b.js'), libB);
}
{
  // An edited test file (new content after the map); a moved time alone is not an
  // edit since the map records content hashes (R29–R31).
  const future = new Date(Date.now() + 60 * 60 * 1000);
  const testA = path.join(dir, 'scripts', '_test-a.js');
  const original = fs.readFileSync(testA);
  fs.appendFileSync(testA, '// edited after the map\n');
  fs.utimesSync(testA, future, future);
  const plan = dryRun(dir, null);
  report.check('R10 an edited test file (whatever its time) selects that test, not everything',
    plan.full === false && selectsTest(plan, '_test-a.js') && !selectsTest(plan, '_test-b.js') && /_test-a\.js changed/.test(reasonOf(plan, '_test-a.js')), show(plan));
  fs.writeFileSync(testA, original);
}

// Discovery rules.
{
  const noReason = fixture('exclude-no-reason', [
    { id: 'V002', ia: 'tests', type: 'behavioral', discover: { pattern: 'scripts/_test-*.js', exclude: [{ file: 'scripts/_test-b.js' }] }, contract: { exitCode: 0, assertions: [], forbiddenChanges: ['docs/guide.md'] } },
  ]);
  const result = runner(noReason, []);
  report.check('R11 an exclusion without a reason is a runner error', result.status !== 0 && /reason/i.test(result.stdout + result.stderr), `exit=${result.status} ${result.stdout.slice(0, 160)}`);
}
{
  const empty = fixture('empty-pattern', [
    { id: 'V002', ia: 'tests', type: 'behavioral', discover: { pattern: 'scripts/_nothing-*.js', exclude: [] }, contract: { exitCode: 0, assertions: [], forbiddenChanges: ['docs/guide.md'] } },
  ]);
  const result = runner(empty, []);
  report.check('R12 a discovery rule that finds nothing fails loudly (says it matched no files)', result.status !== 0 && /matched no files/i.test(result.stdout), `exit=${result.status} ${result.stdout.slice(0, 160)}`);
}
{
  const explicit = fixture('explicit-and-discovered', [
    { id: 'V001', ia: 'test a with an argument', type: 'structural', command: { file: 'node', args: ['scripts/_test-a.js', '--flag'] }, contract: { exitCode: 0 } },
    { id: 'V002', ia: 'tests', type: 'behavioral', discover: { pattern: 'scripts/_test-*.js', exclude: [] }, contract: { exitCode: 0, assertions: [], forbiddenChanges: ['docs/guide.md'] } },
  ]);
  const result = runner(explicit, []);
  const runsOfA = (result.stdout.match(/_test-a\.js/g) || []).length;
  report.check('R13 a test file that has its own explicit entry is not discovered a second time', result.status === 0 && !/"id": "V002:scripts\/_test-a\.js"/.test(result.stdout), `exit=${result.status} mentions=${runsOfA}`);
}

// R15–R22: the independent review's false negatives (P179_T004). Each case is a way a
// failing check could be skipped; each must now be selected or fall back to all.
{
  const rev = fixture('review');
  write(rev, 'scripts/preload.js', '// a test\'s own preload\n');
  write(rev, 'scripts/kid.js', "require('./lib-b');\n");
  write(rev, 'scripts/_test-ownopts.js', [
    "const path = require('path'); const cp = require('child_process');",
    "const pre = path.join(__dirname, 'preload.js').replace(/\\\\/g, '/');",
    "// The child's script name is built at run time, and NODE_OPTIONS is replaced.",
    "const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'k' + 'id.js')], { env: { ...process.env, NODE_OPTIONS: '--require \"' + pre + '\"' } });",
    'process.exit(r.status);',
  ].join('\n') + '\n');
  write(rev, 'skills/demo/SKILL.md', '# demo\n');
  write(rev, 'scripts/_test-copy.js', "const fs = require('fs'); const os = require('os'); const path = require('path');\nconst t = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-'));\nfs.cpSync(path.join(__dirname, '..', 'skills'), path.join(t, 'skills'), { recursive: true });\nfs.rmSync(t, { recursive: true, force: true });\n");
  write(rev, 'notes/a.md', 'a\n');
  write(rev, 'scripts/_test-list.js', "const fs = require('fs'); const path = require('path');\nfor (const f of fs.readdirSync(path.join(__dirname, '..', 'notes'))) fs.readFileSync(path.join(__dirname, '..', 'notes', f));\n");
  write(rev, 'docs/api.md', 'API\n');
  const manifestFile = path.join(rev, CRAB, 'verification', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.entries.push({ id: 'V003', ia: 'api doc names the API', type: 'structural', command: { file: 'node', args: ['scripts/lib-b.js'] }, contract: { exitCode: 0, assertions: [{ kind: 'fileContains', path: 'docs/api.md', value: 'API' }] } });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  git(rev, 'add', '-A'); git(rev, 'commit', '-q', '-m', 'review cases');
  const built = runner(rev, []);
  report.check('R15 setup: a full run with the review cases passes and writes the map', built.status === 0 && fs.existsSync(path.join(rev, CRAB, 'verification', 'test-map.json')), built.stdout.slice(-160));
  let plan = dryRun(rev, ['scripts/lib-b.js']);
  report.check('R15 a child whose NODE_OPTIONS the test replaced (and whose name is built at run time) is still traced', plan.full === false && selectsTest(plan, '_test-ownopts.js'), show(plan));
  plan = dryRun(rev, ['skills/demo/SKILL.md']);
  report.check('R16 a file inside a folder the test copies selects that test', plan.full === false && selectsTest(plan, '_test-copy.js'), show(plan));
  write(rev, 'notes/new.md', 'new\n');
  plan = dryRun(rev, ['notes/new.md']);
  report.check('R17 a new document in a folder the test lists selects that test', plan.full === false && selectsTest(plan, '_test-list.js'), show(plan));
  fs.rmSync(path.join(rev, 'notes', 'new.md'));
  plan = dryRun(rev, ['docs/api.md']);
  report.check('R18 a file read only by a manifest assertion selects that entry', plan.full === false && Array.isArray(plan.selected) && plan.selected.includes('V003'), show(plan));
  git(rev, 'mv', 'docs/guide.md', 'docs/manual.md');
  plan = dryRun(rev, null);
  report.check('R19 a renamed file is gone from its old path, so the test that read it is selected', selectsTest(plan, '_test-doc.js') && /docs\/guide\.md/.test(reasonOf(plan, '_test-doc.js')), show(plan));
  git(rev, 'mv', 'docs/manual.md', 'docs/guide.md');
  plan = dryRun(rev, null);
  report.check('R20 with the content back as it was, no test is selected (only the check with unknown inputs may run after the touches)',
    plan.full === false && Array.isArray(plan.selected) && !plan.selected.some(id => id.startsWith('V002:')) && !plan.selected.includes('V003'), show(plan));
  const later = new Date(Date.now() + 60 * 60 * 1000);
  fs.writeFileSync(path.join(rev, 'scripts', 'lib-a.js'), "require('./constants'); require('./lib-b');\nmodule.exports = 1;\n");
  fs.utimesSync(path.join(rev, 'scripts', 'lib-a.js'), later, later);
  git(rev, 'commit', '-q', '-am', 'lib-a now uses lib-b');
  plan = dryRun(rev, null);
  report.check('R21 a recorded source edited to use a new dependency selects the tests that read it, not everything',
    plan.full === false && selectsTest(plan, '_test-a.js') && !selectsTest(plan, '_test-b.js') && /scripts\/lib-a\.js changed/.test(reasonOf(plan, '_test-a.js')), show(plan));
  write(rev, 'scripts/_test-zfail.js', 'process.exit(1);\n');
  const failing = runner(rev, []);
  // D138: a failing run still refreshes the checks that passed (_test-a now records the
  // lib-b dependency added above) and marks the failed one so --changed runs it again.
  const afterFail = JSON.parse(fs.readFileSync(path.join(rev, CRAB, 'verification', 'test-map.json'), 'utf8')).entries;
  const failedIds = Object.entries(afterFail).filter(([, record]) => record.lastFailedAt).map(([id]) => id);
  const aRecord = Object.entries(afterFail).find(([id]) => id.endsWith('_test-a.js'));
  report.check('R22 a full run with a failing check refreshes the passing records and marks only the failed check',
    failing.status !== 0 && failedIds.length === 1 && failedIds[0].endsWith('_test-zfail.js') && !afterFail[failedIds[0]].passHistory
      && Boolean(aRecord) && aRecord[1].files.includes('scripts/lib-b.js'),
    `exit=${failing.status} failed=${failedIds.join(',')} a=${aRecord && aRecord[1].files.join(',')}`);
}

// R23: a file a check writes and reads back during the full run (evidence, the map
// itself) is not a later change, so it must not make every following run full.
{
  const wr = fixture('writer');
  write(wr, 'scripts/_test-writer.js', "const fs = require('fs'); const path = require('path');\nconst out = path.join(__dirname, '..', 'evidence', 'last.txt');\nfs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, String(Date.now()));\nfs.readFileSync(out);\nfs.readFileSync(path.join(__dirname, '..', '.crab' + 'shell', 'verification', 'manifest.json'));\n");
  git(wr, 'add', '-A'); git(wr, 'commit', '-q', '-m', 'writer');
  const built = runner(wr, []);
  const plan = dryRun(wr, ['scripts/lib-b.js']);
  report.check('R23 files written during the full run do not make the next --changed run full', built.status === 0 && plan.full === false, `exit=${built.status} ${show(plan)}`);
}

// R24–R27: a file git ignores (runtime state a session keeps writing) can never be
// in the change list, so its later change must not make --changed run everything.
function ignoredFixture(name) {
  const dir = fixture(name);
  write(dir, '.gitignore', 'state/\n');
  write(dir, 'state/runtime.txt', 'boot\n');
  write(dir, 'scripts/_test-state.js', "const fs = require('fs'); const path = require('path');\nfs.readFileSync(path.join(__dirname, '..', 'state', 'runtime.txt'), 'utf8');\n");
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'state');
  return dir;
}
function touchLater(dir, rel) {
  const later = new Date(Date.now() + 60 * 60 * 1000);
  fs.writeFileSync(path.join(dir, rel), `written by a session at ${Date.now()}\n`);
  fs.utimesSync(path.join(dir, rel), later, later);
}
{
  const ig = ignoredFixture('ignored');
  const built = runner(ig, []);
  let plan = dryRun(ig, ['scripts/lib-a.js']);
  report.check('R25 control: before the ignored file changes, selection is by what each test loads',
    built.status === 0 && plan.full === false && selectsTest(plan, '_test-a.js') && !selectsTest(plan, '_test-state.js'), `exit=${built.status} ${show(plan)}`);
  // D143_T009 (approved contract change): a file git ignores is an input like any other
  // (a check reading a local .env must run again when it changes), and it never makes
  // every check run.
  touchLater(ig, 'state/runtime.txt');
  plan = dryRun(ig, ['scripts/lib-b.js']);
  report.check('R24 a later change to a file git ignores selects the test that reads it, not everything',
    plan.full === false && selectsTest(plan, '_test-b.js') && selectsTest(plan, '_test-state.js') && !selectsTest(plan, '_test-a.js'), show(plan));
  fs.rmSync(path.join(ig, '.git'), { recursive: true, force: true });
  touchLater(ig, 'state/runtime.txt');
  plan = dryRun(ig, ['scripts/lib-b.js']);
  report.check('R26 without git the same change selects the same tests',
    plan.full === false && selectsTest(plan, '_test-state.js') && selectsTest(plan, '_test-b.js') && !selectsTest(plan, '_test-a.js'), show(plan));
}
{
  const fresh = ignoredFixture('uncommitted');
  fs.rmSync(path.join(fresh, '.git'), { recursive: true, force: true });
  git(fresh, 'init', '-q');
  const built = runner(fresh, []);
  touchLater(fresh, 'state/runtime.txt');
  const plan = dryRun(fresh, ['scripts/lib-b.js']);
  report.check('R27 a repository with no commits chooses by content too',
    built.status === 0 && plan.full === false && selectsTest(plan, '_test-b.js') && selectsTest(plan, '_test-state.js') && !selectsTest(plan, '_test-a.js'), `exit=${built.status} ${show(plan)}`);
}

{
  // Most projects ignore the whole .crabshell folder: its manifest is an ignored
  // file, yet a manifest edit must still run everything.
  const whole = fixture('ignores-crabshell');
  write(whole, '.gitignore', `${CRAB}/\n`);
  git(whole, 'rm', '-r', '-q', '--cached', CRAB); git(whole, 'add', '-A'); git(whole, 'commit', '-q', '-m', 'ignore crabshell');
  const built = runner(whole, []);
  const manifest = path.join(whole, CRAB, 'verification', 'manifest.json');
  const later = new Date(Date.now() + 60 * 60 * 1000);
  fs.writeFileSync(manifest, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifest, 'utf8')), note: 'edited after the map' }, null, 2));
  fs.utimesSync(manifest, later, later);
  // D143_T009: a manifest edit reruns the checks whose own fields changed (and checks
  // that read the manifest), whether git ignores the folder or not.
  const plan = dryRun(whole, null);
  report.check('R28 a manifest edit that changes no check\'s fields reruns no test (only the check with unknown inputs)',
    built.status === 0 && plan.full === false && !(plan.selected || []).some(id => id.startsWith('V002:')), `exit=${built.status} ${show(plan)}`);
  const edited = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  edited.entries.find(entry => entry.id === 'V002').timeout = 31000;
  fs.writeFileSync(manifest, JSON.stringify(edited, null, 2));
  const clean = dryRun(whole, null);
  report.check('R32 a changed entry field (the discover rule\'s timeout) reruns every check that entry makes',
    clean.full === true && (clean.selected || []).filter(id => id.startsWith('V002:')).length === 4, show(clean));
}

// R29–R31: a file whose time moved but whose content did not (a revert, a checkout,
// a branch switch) is not a change, so it must not make --changed run everything.
function rewriteSameLater(dir, rel) {
  const file = path.join(dir, rel);
  const later = new Date(Date.now() + 2 * 60 * 60 * 1000);
  fs.writeFileSync(file, fs.readFileSync(file));
  fs.utimesSync(file, later, later);
}
{
  const same = fixture('same-content');
  const built = runner(same, []);
  rewriteSameLater(same, 'scripts/lib-b.js');
  let plan = dryRun(same, ['scripts/lib-a.js']);
  report.check('R29 a recorded file rewritten with the same content does not make --changed run everything',
    built.status === 0 && plan.full === false && selectsTest(plan, '_test-a.js'), `exit=${built.status} ${show(plan)}`);
  rewriteSameLater(same, 'scripts/_test-b.js');
  rewriteSameLater(same, `${CRAB}/verification/manifest.json`);
  plan = dryRun(same, ['scripts/lib-a.js']);
  report.check('R30 a test file and the manifest rewritten with the same content do not either',
    plan.full === false && selectsTest(plan, '_test-a.js'), show(plan));
  // D143_T009: with no stored hash for a file whose time moved, its content is read
  // again; the same content is no change.
  const mapFile = path.join(same, CRAB, 'verification', 'test-map.json');
  const oldMap = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  for (const rel of Object.keys(oldMap.snapshot.files)) oldMap.snapshot.files[rel][4] = null;
  fs.writeFileSync(mapFile, JSON.stringify(oldMap) + '\n');
  rewriteSameLater(same, 'scripts/lib-b.js');
  plan = dryRun(same, ['scripts/lib-a.js']);
  report.check('R31 a moved time with no stored hash is read again, and the same content changes nothing',
    plan.full === false && selectsTest(plan, '_test-a.js') && !selectsTest(plan, '_test-b.js'), show(plan));
}

// R33–R34: a passing --changed run updates the load map for the checks it ran, so
// the commit that follows does not make the next --changed run everything (D131).
{
  const re = fixture('refresh');
  write(re, 'notes/a.md', 'a\n');
  write(re, 'scripts/_test-list.js', "const fs = require('fs'); const path = require('path');\nfor (const f of fs.readdirSync(path.join(__dirname, '..', 'notes'))) fs.readFileSync(path.join(__dirname, '..', 'notes', f));\n");
  git(re, 'add', '-A'); git(re, 'commit', '-q', '-m', 'notes');
  const built = runner(re, []);
  const mapFile = path.join(re, CRAB, 'verification', 'test-map.json');
  const later = new Date(Date.now() + 60 * 60 * 1000);
  fs.writeFileSync(path.join(re, 'scripts', 'lib-a.js'), "require('./constants'); require('./lib-b');\nmodule.exports = 1;\n");
  fs.utimesSync(path.join(re, 'scripts', 'lib-a.js'), later, later);
  const partial = runner(re, ['--changed']);
  git(re, 'commit', '-q', '-am', 'lib-a now uses lib-b');
  const plan = dryRun(re, ['scripts/lib-b.js']);
  report.check('R33 after a passing --changed run and its commit, the next --changed run is not full and keeps the new dependency',
    built.status === 0 && partial.status === 0 && /Changed-files run: \d+ of \d+ checks \((?!all)/.test(partial.stdout)
      && plan.full === false && selectsTest(plan, '_test-a.js') && selectsTest(plan, '_test-b.js'),
    `built=${built.status} partial=${partial.status} ${partial.stdout.slice(-120)} ${show(plan)}`);
  const recordsBefore = JSON.parse(fs.readFileSync(mapFile, 'utf8')).entries;
  fs.writeFileSync(path.join(re, 'scripts', 'lib-b.js'), 'module.exports = 3;\n');
  const failing = runner(re, ['--changed']);
  // D138: the failed check keeps its last good dependency record, loses its pass key and
  // is marked so the next --changed runs it again.
  const recordsAfter = JSON.parse(fs.readFileSync(mapFile, 'utf8')).entries;
  const failedIds = Object.entries(recordsAfter).filter(([, record]) => record.lastFailedAt).map(([id]) => id);
  const failedId = failedIds[0];
  report.check('R34 a failing --changed run keeps the failed check\'s dependency record and marks it to run again',
    failing.status === 1 && failedIds.length === 1 && failedId.endsWith('_test-b.js') && !recordsAfter[failedId].passKey
      && JSON.stringify(recordsAfter[failedId].files) === JSON.stringify((recordsBefore[failedId] || {}).files),
    `exit=${failing.status} failed=${failedIds.join(',')}`);
  // Restore the committed bytes (a git checkout may rewrite line endings), then let
  // --changed run the failed check again so the map matches the tree before R45.
  fs.writeFileSync(path.join(re, 'scripts', 'lib-b.js'), 'module.exports = 2;\n');
  const resync = runner(re, ['--changed']);
  // R45 (D143_T009): a --changed run that adds a dependency (lib-a now reads a new note
  // in a folder _test-list lists) records it, so the next run chooses by the new inputs.
  fs.writeFileSync(path.join(re, 'scripts', 'lib-a.js'), "require('./constants'); require('./lib-b');\nrequire('fs').readFileSync(require('path').join(__dirname, '..', 'notes', 'new.md'));\nmodule.exports = 1;\n");
  write(re, 'notes/new.md', 'new\n');
  const listed = runner(re, ['--changed']);
  git(re, 'add', '-A'); git(re, 'commit', '-q', '-m', 'lib-a reads a new note');
  const quiet = dryRun(re, null);
  const next = dryRun(re, ['notes/new.md']);
  report.check('R45 after a --changed run records a new dependency, the next run chooses by the new inputs',
    resync.status === 0 && listed.status === 0 && /Changed-files run: \d+ of \d+ checks \((?!all)/.test(listed.stdout)
      && (quiet.selected || []).length === 0 && next.full === false && selectsTest(next, '_test-a.js') && selectsTest(next, '_test-list.js') && !selectsTest(next, '_test-b.js'),
    `resync=${resync.status} exit=${listed.status} ${listed.stdout.slice(-100)} quiet=${show(quiet)} next=${show(next)}`);
}

// R46 (D138): a new check that fails on a --changed run and is committed while still
// failing is run again by the next --changed ("failed in the last run"); its test file,
// never noted as passed, must not make the whole map stale.
{
  const nf = fixture('failnew');
  const built = runner(nf, []);
  write(nf, 'scripts/_test-c.js', 'process.exit(1);\n');
  git(nf, 'add', '-A'); git(nf, 'commit', '-q', '-m', 'a new check that fails');
  const failing = runner(nf, ['--changed']);
  const plan = dryRun(nf, null);
  report.check('R46 a new check committed while failing is selected again without a full run',
    built.status === 0 && failing.status === 1 && plan.full === false && selectsTest(plan, '_test-c.js')
      && /failed in the last run/.test(String((plan.reasons || {})[plan.selected.find(id => id.endsWith('_test-c.js'))])),
    `built=${built.status} failing=${failing.status} ${show(plan)}`);
}

// R35–R44: fail-before (D131). When a --changed run changes a test together with the
// source it reads, that test also runs on HEAD and must fail there: a test that
// passes on the old source too does not check the change.
{
  // The runner's HEAD copies go to a temp folder of their own: other checks running side by
  // side make and remove the same kind of folder in the machine's temp folder.
  const tmp = path.join(root, 'fail-before-tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const tmpEnv = { TMP: tmp, TEMP: tmp, TMPDIR: tmp };
  const fb = fixture('fail-before');
  const original = {
    'scripts/lib-a.js': "require('./constants');\nmodule.exports = 1;\n",
    'scripts/_test-a.js': "if (require('./lib-a') !== 1) process.exit(1);\n",
    'scripts/_test-b.js': "if (require('./lib-b') !== 2) process.exit(1);\n",
    'scripts/lib-b.js': 'module.exports = 2;\n',
    'scripts/lib-c.js': 'module.exports = 3;\n',
    'scripts/_test-state.js': "const fs = require('fs'); const path = require('path');\nfs.readFileSync(path.join(__dirname, '..', 'state', 'runtime.txt'), 'utf8');\nif (require('./lib-c') !== 3) process.exit(1);\n",
    'scripts/lib-d.js': 'module.exports = 4;\n',
    'scripts/_test-gitdir.js': "const fs = require('fs'); const path = require('path');\nif (!fs.existsSync(path.join(__dirname, '..', '.git'))) process.exit(1);\nif (require('./lib-d') !== 4) process.exit(1);\n",
  };
  write(fb, '.gitignore', 'state/\n');
  write(fb, 'state/runtime.txt', 'boot\n');
  for (const [rel, content] of Object.entries(original)) write(fb, rel, content);
  git(fb, 'add', '-A'); git(fb, 'commit', '-q', '-m', 'fail-before cases');
  const built = runner(fb, []);
  // Restore the committed bytes (a git checkout may rewrite line endings).
  const restore = () => { for (const [rel, content] of Object.entries(original)) write(fb, rel, content); };
  // D143: the HEAD comparison is opt-in, so these cases ask for it with --fail-before.
  const run = (args, { optIn = true } = {}) => {
    const result = runner(fb, ['--changed', ...(optIn ? ['--fail-before'] : []), ...(args || [])], tmpEnv);
    let results = [];
    try { results = JSON.parse(result.stdout.match(/^\[\]$|^\[\r?\n[\s\S]*?\r?\n\]$/m)[0]); } catch {}
    const before = results.filter(item => String(item.id).startsWith('FAIL_BEFORE:'));
    return { status: result.status, stdout: result.stdout, results, before, of: file => before.find(item => item.id.endsWith(file)) };
  };
  const brief = r => `exit=${r.status} ${JSON.stringify(r.before.map(item => ({ id: item.id, status: item.status, why: String(item.message || item.error || '').slice(0, 90) })))}`;
  const exemptFile = path.join(fb, CRAB, 'verification', 'fail-before-exempt.json');
  const sha = rel => require('crypto').createHash('sha256').update(fs.readFileSync(path.join(fb, rel))).digest('hex');

  write(fb, 'scripts/lib-a.js', "require('./constants');\nmodule.exports = 5;\n");
  write(fb, 'scripts/_test-a.js', "if (require('./lib-a') !== 5) process.exit(1);\n");
  let r = run();
  report.check('R35 a changed test that fails on HEAD and passes now is a PASS (it catches the change)',
    built.status === 0 && r.status === 0 && r.of('_test-a.js') && r.of('_test-a.js').status === 'PASS', `built=${built.status} ${brief(r)}`);
  const repeated = run();
  report.check('R52 repeated fail-before comparison executes the changed test despite its cached pass',
    repeated.status === 0 && repeated.of('_test-a.js') && repeated.of('_test-a.js').status === 'PASS'
      && repeated.results.some(item => item.id === 'V002:scripts/_test-a.js' && item.reused !== true && item.durationMs > 0)
      && repeated.of('_test-a.js').durationMs > 0, brief(repeated));
  restore();

  write(fb, 'scripts/lib-a.js', "require('./constants');\nmodule.exports = 1; // reworded\n");
  write(fb, 'scripts/_test-a.js', original['scripts/_test-a.js'] + '// reworded\n');
  r = run();
  report.check('R36 a changed test that passes on HEAD too fails the run (it does not catch the change)',
    r.status === 1 && r.of('_test-a.js') && r.of('_test-a.js').status === 'FAIL' && /passes on HEAD/.test(r.of('_test-a.js').error), brief(r));
  r = run(['--no-fail-before']);
  report.check('R40 --no-fail-before skips the HEAD comparison', r.status === 0 && r.before.length === 0, brief(r));
  r = run([], { optIn: false });
  report.check('R40b without --fail-before a plain --changed run makes no HEAD comparison (D143 default)', r.status === 0 && r.before.length === 0, brief(r));
  fs.writeFileSync(exemptFile, JSON.stringify({ 'scripts/_test-a.js': { sha256: sha('scripts/_test-a.js'), reason: 'refactor keeps behavior' } }, null, 2));
  r = run();
  report.check('R38 an exemption that hashes the current test passes with its reason, and the exemption file selects nothing',
    r.status === 0 && r.of('_test-a.js') && r.of('_test-a.js').status === 'PASS' && /exempt: refactor keeps behavior/.test(r.of('_test-a.js').message)
      && /Changed-files run: \d+ of \d+ checks \((?!all)/.test(r.stdout), `${brief(r)} ${r.stdout.slice(-140)}`);
  write(fb, 'scripts/_test-a.js', original['scripts/_test-a.js'] + '// reworded again\n');
  r = run();
  report.check('R39 an exemption for other content of the test no longer applies', r.status === 1 && r.of('_test-a.js') && r.of('_test-a.js').status === 'FAIL', brief(r));
  fs.rmSync(exemptFile);
  restore();

  write(fb, 'scripts/_test-b.js', original['scripts/_test-b.js'] + '// a note\n');
  r = run();
  report.check('R37 a changed test with no changed source it reads is not compared with HEAD', r.status === 0 && r.before.length === 0, brief(r));
  restore();

  write(fb, 'scripts/lib-c.js', 'module.exports = 6;\n');
  write(fb, 'scripts/_test-state.js', original['scripts/_test-state.js'].replace('!== 3', '!== 6'));
  r = run();
  report.check('R41 a test that reads a file git ignores gets that file on HEAD, so its baseline passes',
    r.status === 0 && r.of('_test-state.js') && r.of('_test-state.js').status === 'PASS', brief(r));
  restore();

  write(fb, 'scripts/lib-d.js', 'module.exports = 7;\n');
  write(fb, 'scripts/_test-gitdir.js', original['scripts/_test-gitdir.js'].replace('!== 4', '!== 7'));
  r = run();
  report.check('R42 when the old test fails on HEAD (baseline), the result is manual, not a pass',
    r.status === 0 && r.of('_test-gitdir.js') && r.of('_test-gitdir.js').status === 'manual', brief(r));
  restore();

  write(fb, 'scripts/lib-b.js', 'module.exports = 9;\n');
  write(fb, 'scripts/_test-b.js', original['scripts/_test-b.js'].replace('!== 2', '!== 9'));
  write(fb, 'scripts/_test-new.js', "if (require('./lib-b') !== 9) process.exit(1);\n");
  r = run();
  report.check('R43 a new test file runs only on HEAD (no baseline) and passes when it fails there',
    r.status === 0 && r.of('_test-new.js') && r.of('_test-new.js').status === 'PASS' && r.of('_test-b.js') && r.of('_test-b.js').status === 'PASS', brief(r));
  fs.rmSync(path.join(fb, 'scripts', '_test-new.js'));
  restore();

  const left = fs.readdirSync(tmp).filter(name => name.startsWith('crabshell-fail-before-'));
  report.check('R44 no HEAD copy is left in the temp folder', left.length === 0, left.join(','));
}

// R46–R51: a check with no record yet (a new, renamed or pulled test file) runs by
// itself instead of making --changed run everything, and a deleted test selects
// nothing (D132). Nothing else can depend on a test that did not exist before.
{
  const nt = fixture('new-tests');
  const built = runner(nt, []);
  const testA = "if (require('./lib-a') !== 1) process.exit(1);\n";
  write(nt, 'scripts/_test-c.js', "if (require('./lib-a') !== 1) process.exit(1);\n");
  write(nt, 'scripts/lib-b.js', 'module.exports = 2; // edited\n');
  let plan = dryRun(nt, null);
  report.check('R46 a new test file runs by itself with the checks the other changed files touch, not everything',
    built.status === 0 && plan.full === false && selectsTest(plan, '_test-c.js') && selectsTest(plan, '_test-b.js')
      && !selectsTest(plan, '_test-a.js') && !selectsTest(plan, '_test-doc.js') && /\b1 new\b/.test(String(plan.reason)) && reasonOf(plan, '_test-c.js') === 'new check', `built=${built.status} ${show(plan)}`);
  const ran = runner(nt, ['--changed']);
  git(nt, 'add', '-A'); git(nt, 'commit', '-q', '-m', 'test-c');
  plan = dryRun(nt, ['scripts/lib-a.js']);
  report.check('R47 after a passing run the new test has a record, so a change to what it reads selects it',
    ran.status === 0 && plan.full === false && selectsTest(plan, '_test-a.js') && selectsTest(plan, '_test-c.js'), `ran=${ran.status} ${show(plan)}`);
  write(nt, 'scripts/_test-d.js', "if (require('./lib-b') !== 2) process.exit(1);\n");
  git(nt, 'add', '-A'); git(nt, 'commit', '-q', '-m', 'test-d arrives without a run');
  plan = dryRun(nt, null);
  report.check('R48 a committed test with no record (a pulled commit) runs by itself, not everything',
    plan.full === false && selectsTest(plan, '_test-d.js') && !selectsTest(plan, '_test-a.js') && reasonOf(plan, '_test-d.js') === 'new check', show(plan));
  git(nt, 'mv', 'scripts/_test-b.js', 'scripts/_test-b2.js');
  plan = dryRun(nt, null);
  report.check('R49 a renamed test runs under its new name and its old name selects nothing',
    plan.full === false && selectsTest(plan, '_test-b2.js') && !selectsTest(plan, '_test-a.js'), show(plan));
  git(nt, 'mv', 'scripts/_test-b2.js', 'scripts/_test-b.js');
  fs.rmSync(path.join(nt, 'scripts', '_test-a.js'));
  plan = dryRun(nt, null);
  report.check('R50 a deleted test selects nothing and does not run everything',
    plan.full === false && !selectsTest(plan, '_test-a.js') && !selectsTest(plan, '_test-c.js'), show(plan));
  write(nt, 'scripts/_test-a.js', testA);
  const recorded = runner(nt, ['--changed']); // records _test-d, so R51 stands on its own
  fs.rmSync(path.join(nt, 'scripts', 'child.js'));
  plan = dryRun(nt, null);
  const readSource = plan.full === false && selectsTest(plan, '_test-spawn.js');
  write(nt, 'scripts/child.js', 'process.exit(0);\n');
  write(nt, 'scripts/unused.js', 'module.exports = 0;\n');
  git(nt, 'add', '-A'); git(nt, 'commit', '-q', '-m', 'unused');
  fs.rmSync(path.join(nt, 'scripts', 'unused.js'));
  const unread = dryRun(nt, null);
  // D143_T009: unused.js appeared and went again between two runs, so no test sees a
  // change. (child.js was deleted and written again with the same bytes: only the check
  // with unknown inputs, which counts a moved time, may run.)
  report.check('R51 a deleted source a test read selects that test; a file added and deleted again between runs selects no test',
    recorded.status === 0 && readSource && unread.full === false && Array.isArray(unread.selected) && !unread.selected.some(id => id.startsWith('V002:')),
    `recorded=${recorded.status} readSource=${readSource} unread=${JSON.stringify(unread.reasons)}`);
}

// R14 (this repository's real records) lives in _test-real-repo-selection.js, a slow
// manifest entry: it reads the whole working tree (D143_T017).

report.finish();
