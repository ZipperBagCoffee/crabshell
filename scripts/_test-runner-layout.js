'use strict';
// D143_T007: the verification runner is a launcher (run-verify.js) with its modules in
// a runner/ folder beside it. Every location the runner derives (project root,
// manifest, last-run.json, its own files) comes from where the launcher sits, a change
// to any runner file counts like a change to the launcher, and the launcher keeps the
// same exported names.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const RUNNER = process.env.CRABSHELL_TEST_RUNNER || path.join(REPO, 'skills', 'verifying', 'scripts', 'run-verify.js');
const INSTALL = path.join(path.dirname(RUNNER), 'runner', 'install.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-runner-layout-'));
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`); }
};
const attempt = (name, fn) => {
  try { fn(); } catch (error) { check(name, false, error.message.split('\n')[0]); }
};

const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const git = (dir, ...args) => spawnSync('git', ['-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', ...args], { cwd: dir, encoding: 'utf8', windowsHide: true });
const same = (a, b) => path.resolve(fs.realpathSync(a)).toLowerCase() === path.resolve(fs.realpathSync(b)).toLowerCase();
// The runner finds its project from its own location when nothing names one.
const cleanEnv = () => {
  const env = { ...process.env, CRABSHELL_VERIFY_JSON: '' };
  for (const name of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[name];
  return env;
};
const launch = (dir, args, cwd = os.tmpdir()) => spawnSync(process.execPath, [path.join(dir, '.crabshell', 'verification', 'run-verify.js'), ...args],
  { cwd, encoding: 'utf8', windowsHide: true, env: cleanEnv(), timeout: 120000 });

function project(name, { withGit = false } = {}) {
  const dir = path.join(base, name);
  write(dir, 'src/a.txt', 'a\n');
  write(dir, 'src/b.txt', 'b\n');
  write(dir, 'scripts/_test-a.js', "require('fs').readFileSync(require('path').join(process.env.PROJECT_ROOT, 'src/a.txt'));\nconsole.log(process.env.PROJECT_ROOT);\n");
  write(dir, 'scripts/_test-b.js', "require('fs').readFileSync(require('path').join(process.env.PROJECT_ROOT, 'src/b.txt'));\n");
  write(dir, '.crabshell/verification/manifest.json', JSON.stringify({
    schemaVersion: 2,
    entries: [
      { id: 'A', type: 'structural', command: { file: 'node', args: ['scripts/_test-a.js'] }, contract: { exitCode: 0 } },
      { id: 'B', type: 'structural', command: { file: 'node', args: ['scripts/_test-b.js'] }, contract: { exitCode: 0 } },
    ],
  }, null, 2));
  const { copyRunner } = require(INSTALL);
  copyRunner(RUNNER, path.join(dir, '.crabshell', 'verification'));
  if (withGit) {
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'add', '-f', '.crabshell/verification');
    git(dir, 'commit', '-q', '-m', 'fixture');
  }
  return dir;
}

try {
  attempt('L1 copyRunner puts the launcher and its runner/ folder into a project', () => {
    const dir = project('install');
    const target = path.join(dir, '.crabshell', 'verification');
    const modules = fs.readdirSync(path.join(target, 'runner')).filter(file => file.endsWith('.js'));
    check('L1 copyRunner puts the launcher and its runner/ folder into a project',
      fs.existsSync(path.join(target, 'run-verify.js')) && modules.includes('index.js') && modules.length > 1, `modules=${modules}`);
  });

  attempt('L2 project root, manifest and last-run.json come from the launcher location', () => {
    const dir = project('location');
    const result = launch(dir, []);
    const lastRun = path.join(dir, '.crabshell', 'verification', 'last-run.json');
    const saved = fs.existsSync(lastRun) ? JSON.parse(fs.readFileSync(lastRun, 'utf8')) : [];
    const a = saved.find(item => item.id === 'A') || {};
    check('L2 project root, manifest and last-run.json come from the launcher location',
      result.status === 0 && fs.existsSync(lastRun) && typeof a.output === 'string' && same(a.output.trim(), dir),
      `status=${result.status} output=${a.output} ${result.stdout.slice(-200)}${result.stderr.slice(-200)}`);
  });

  // D143_T009 (approved contract change): only the modules that decide results count
  // as a runner change; the launcher and the output module rerun nothing.
  attempt('L3 a change to a module that decides results selects every check; a launcher change selects none', () => {
    const dir = project('module-change', { withGit: true });
    const full = launch(dir, [], dir);
    const runnerDir = path.join(dir, '.crabshell', 'verification', 'runner');
    const plan = () => { const result = launch(dir, ['--changed', '--dry-run'], dir); try { return JSON.parse(result.stdout); } catch (_) { return { error: result.stdout + result.stderr }; } };
    const quiet = plan();
    const deciding = path.join(runnerDir, 'execute.js');
    const original = fs.readFileSync(deciding);
    fs.appendFileSync(deciding, '\nmodule.exports.releaseMarker = 1;\n'); // D143_T020: a code line — comment and blank lines do not count
    const afterModule = plan();
    fs.writeFileSync(deciding, original);
    fs.appendFileSync(path.join(dir, '.crabshell', 'verification', 'run-verify.js'), '\n');
    const afterLauncher = plan();
    check('L3 a change to a module that decides results selects every check; a launcher change selects none',
      full.status === 0 && quiet.selected && quiet.selected.length === 0
      && afterModule.full === true && (afterModule.selected || []).length === 2
      && Array.isArray(afterLauncher.selected) && afterLauncher.selected.length === 0,
      `full=${full.status} quiet=${JSON.stringify(quiet.selected)} module=${JSON.stringify(afterModule.selected)} ${afterModule.reason || afterModule.error} launcher=${JSON.stringify(afterLauncher.selected)}`);
  });

  attempt('L4 the launcher exports its thirteen public names', () => {
    const expected = ['evaluateAssertion', 'expandEntries', 'globRegex', 'looksMachineAbsolute', 'main', 'parseArgs', 'planRun',
      'readJsonPointer', 'resolveInside', 'runEntry', 'selectEntries', 'snapshotPaths', 'validateEntry'];
    const names = Object.keys(require(RUNNER)).sort();
    check('L4 the launcher exports its thirteen public names', names.join(',') === expected.join(','), names.join(','));
  });

  attempt('L5 a launcher without its runner/ folder stops with one line and exit 1', () => {
    const dir = path.join(base, 'missing');
    write(dir, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries: [] }));
    fs.copyFileSync(RUNNER, path.join(dir, '.crabshell', 'verification', 'run-verify.js'));
    const result = launch(dir, []);
    const lines = `${result.stdout}${result.stderr}`.split(/\r?\n/).filter(line => line.trim());
    check('L5 a launcher without its runner/ folder stops with one line and exit 1',
      result.status === 1 && lines.length === 1 && /runner\/ folder is missing/.test(lines[0]) && !lines.some(line => /^\s+at /.test(line)),
      `status=${result.status} ${lines.slice(0, 3).join(' | ')}`);
  });

  attempt("L6 this repository's own runner copy plans a --changed run", () => {
    const result = spawnSync(process.execPath, [path.join(REPO, '.crabshell', 'verification', 'run-verify.js'), '--changed', '--dry-run'],
      { cwd: REPO, encoding: 'utf8', windowsHide: true, env: { ...cleanEnv(), PROJECT_ROOT: REPO }, timeout: 120000 });
    let plan = null;
    try { plan = JSON.parse(result.stdout); } catch (_) {}
    check("L6 this repository's own runner copy plans a --changed run", result.status === 0 && plan && Array.isArray(plan.selected), `${result.status} ${result.stderr.slice(-200)}`);
  });
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

console.log(`runner-layout: ${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed ? 1 : 0);
