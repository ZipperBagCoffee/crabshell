'use strict';
// D119 P179_T001: the verification runner discovers test files by convention and,
// with --changed, runs only the checks that touch the changed files — and falls
// back to everything whenever it cannot know (no or stale load map, a file outside
// the map, a file every check depends on).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');

const REPO = path.join(__dirname, '..');
const RUNNER = path.join(REPO, 'skills', 'verifying', 'scripts', 'run-verify.js');
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
  fs.copyFileSync(RUNNER, path.join(dir, CRAB, 'verification', 'run-verify.js'));
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

function runner(dir, args) {
  const env = { ...process.env, PROJECT_ROOT: dir };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CRABSHELL_VERIFY_RUNNING; // this test may itself run inside a declared check
  return spawnSync(process.execPath, [path.join(dir, CRAB, 'verification', 'run-verify.js'), ...args], { cwd: dir, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
}
function dryRun(dir, files) {
  const result = runner(dir, ['--changed', ...(files ? ['--files', files.join(',')] : []), '--dry-run']);
  try { return JSON.parse(result.stdout); } catch { return { parseError: true, stdout: result.stdout.slice(0, 200), stderr: result.stderr.slice(0, 200), status: result.status }; }
}
const selectsTest = (plan, file) => Array.isArray(plan.selected) && plan.selected.some(id => id.endsWith(file));
const show = plan => JSON.stringify(plan).slice(0, 220);

const dir = fixture('main');
const mapPath = path.join(dir, CRAB, 'verification', 'test-map.json');

{
  const plan = dryRun(dir, ['scripts/lib-a.js']);
  report.check('R1 without a load map, --changed runs everything and says why', plan.full === true && /map/i.test(String(plan.reason)), show(plan));
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
for (const file of ['scripts/constants.js', 'scripts/utils.js', 'hooks/hooks.json', 'package.json', '.claude-plugin/plugin.json']) {
  const plan = dryRun(dir, [file]);
  report.check(`R7 control: a change to ${file} runs everything`, plan.full === true, show(plan));
}
{
  write(dir, 'scripts/new-lib.js', 'module.exports = 3;\n');
  const plan = dryRun(dir, ['scripts/new-lib.js']);
  report.check('R8 control: a source file outside the load map runs everything', plan.full === true, show(plan));
  fs.rmSync(path.join(dir, 'scripts', 'new-lib.js'));
}
{
  fs.writeFileSync(path.join(dir, 'scripts', 'lib-b.js'), 'module.exports = 2; // edited\n');
  const plan = dryRun(dir, null);
  report.check('R9 without --files, the working-tree change (lib-b.js) is found through git and selects its test',
    plan.full === false && selectsTest(plan, '_test-b.js') && !selectsTest(plan, '_test-a.js'), show(plan));
  git(dir, 'checkout', '--', 'scripts/lib-b.js');
}
{
  const future = new Date(Date.now() + 60 * 60 * 1000);
  fs.utimesSync(path.join(dir, 'scripts', '_test-a.js'), future, future);
  const plan = dryRun(dir, ['scripts/lib-b.js']);
  report.check('R10 control: a load map older than a test file runs everything', plan.full === true && /stale|older/i.test(String(plan.reason)), show(plan));
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
  report.check('R19 a staged rename lists the old path, so the test that read it is selected', Array.isArray(plan.changed) && plan.changed.includes('docs/guide.md') && selectsTest(plan, '_test-doc.js'), show(plan));
  git(rev, 'mv', 'docs/manual.md', 'docs/guide.md');
  plan = dryRun(rev, null);
  report.check('R20 control: no changed files at all runs everything', plan.full === true && /no changed files/i.test(String(plan.reason)), show(plan));
  const later = new Date(Date.now() + 60 * 60 * 1000);
  fs.writeFileSync(path.join(rev, 'scripts', 'lib-a.js'), "require('./constants'); require('./lib-b');\nmodule.exports = 1;\n");
  fs.utimesSync(path.join(rev, 'scripts', 'lib-a.js'), later, later);
  git(rev, 'commit', '-q', '-am', 'lib-a now uses lib-b');
  plan = dryRun(rev, ['scripts/lib-b.js']);
  report.check('R21 control: a recorded source file changed after the map (new dependency) runs everything', plan.full === true && /older than scripts\/lib-a\.js/.test(String(plan.reason)), show(plan));
  const mapBefore = fs.readFileSync(path.join(rev, CRAB, 'verification', 'test-map.json'), 'utf8');
  write(rev, 'scripts/_test-zfail.js', 'process.exit(1);\n');
  const failing = runner(rev, []);
  report.check('R22 a full run with a failing check leaves the previous map in place', failing.status !== 0 && fs.readFileSync(path.join(rev, CRAB, 'verification', 'test-map.json'), 'utf8') === mapBefore, `exit=${failing.status}`);
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

// R14: this repository — a counter.js change selects fewer than all checks but
// every test that names counter.js (a static lower bound of "loads counter.js").
{
  const realMap = path.join(REPO, CRAB, 'verification', 'test-map.json');
  if (!fs.existsSync(realMap)) {
    console.log('NOTE: R14 not evaluated — this repository has no load map yet (a full declared run creates it).');
  } else {
    const env = { ...process.env, PROJECT_ROOT: REPO };
    delete env.CRABSHELL_VERIFY_RUNNING;
    const result = spawnSync(process.execPath, [path.join(REPO, CRAB, 'verification', 'run-verify.js'), '--changed', '--files', 'scripts/counter.js', '--dry-run'], { cwd: REPO, env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
    let plan = {};
    try { plan = JSON.parse(result.stdout); } catch {}
    const tests = fs.readdirSync(path.join(REPO, 'scripts')).filter(f => /^_test-.*\.js$/.test(f));
    // Names counter.js as a module or a path (not the English word in a title).
    const loadsCounter = /require\(\s*['"][^'"]*\bcounter(?:\.js)?['"]\s*\)|['"`](?:[^'"`\s]*\/)?counter\.js['"`]/;
    const naming = tests.filter(f => loadsCounter.test(fs.readFileSync(path.join(REPO, 'scripts', f), 'utf8')));
    // Explicit entries have plain ids, so match on the test file each selected entry runs.
    const selectedFiles = new Set(Object.values(plan.tests || {}).map(file => path.basename(file)));
    const missing = naming.filter(f => !selectedFiles.has(f));
    if (plan.full === true && /map/i.test(String(plan.reason))) {
      // The map predates the current tests, manifest or runner (it is rebuilt at the
      // end of this full run); the selection is correctly "everything" for now.
      console.log(`NOTE: R14 not evaluated — ${plan.reason}.`);
    } else {
      report.check('R14 counter.js change: fewer than all checks, and every test naming counter.js included',
        plan.full === false && Array.isArray(plan.selected) && plan.selected.length < (plan.total || Infinity) && missing.length === 0,
        `selected=${plan.selected && plan.selected.length} total=${plan.total} missing=${missing.join(',')}`);
    }
  }
}

report.finish();
