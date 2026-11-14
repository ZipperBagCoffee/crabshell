'use strict';
// D171: the wide-selection notice. When what changed or failed last time pulls in more than a
// share of all checks (`wideSelectionShare`, at least `wideSelectionMinChecks` of them), the
// run, --explain and --dry-run name what pulled the most: a changed input, the checks that use
// the whole project, or a failure in the last run. Checks chosen whatever the change (new
// checks) do not count, and the notice changes nothing about what runs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const REPO = path.resolve(__dirname, '..');
const RUNNER = process.env.CRABSHELL_TEST_RUNNER || path.join(REPO, 'skills', 'verifying', 'scripts', 'run-verify.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-wide-'));
const outside = path.join(base, 'outside');
fs.mkdirSync(outside);
process.on('exit', () => { try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {} });
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`); }
};
const attempt = (name, fn) => { try { fn(); } catch (error) { check(name, false, error.stack.split('\n').slice(0, 2).join(' ')); } };
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

// A Node check that reads its input and fails while a flag file named after it exists outside
// the project. With no input it reads no project file, so its inputs are unknown.
const nodeCheck = (id, input) => [
  "const fs = require('fs'); const path = require('path');",
  input ? `fs.readFileSync(path.join(process.env.PROJECT_ROOT, '${input}'));` : '',
  `if (fs.existsSync(path.join(process.env.WIDE_OUTSIDE, '${id}.fail'))) process.exit(1);`,
].join('\n') + '\n';

function project(name, checks, manifestFields = {}) {
  const dir = path.join(base, name);
  for (const input of new Set(Object.values(checks).filter(Boolean))) write(dir, input, `${input}\n`);
  const entries = [];
  for (const [id, input] of Object.entries(checks)) {
    if (input) {
      write(dir, `scripts/_test-${id}.js`, nodeCheck(id, input));
      entries.push({ id, type: 'structural', command: { file: 'node', args: [`scripts/_test-${id}.js`] }, contract: { exitCode: 0 } });
    } else {
      // Outside the project, so the trace sees no project file: inputs unknown.
      write(outside, `${name}-${id}.js`, nodeCheck(id, null));
      entries.push({ id, type: 'structural', command: { file: 'node', args: ['-e', `require(require('path').join(process.env.WIDE_OUTSIDE, '${name}-${id}.js'))`] }, contract: { exitCode: 0 } });
    }
  }
  write(dir, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, ...manifestFields, entries }, null, 2));
  copyRunner(RUNNER, path.join(dir, '.crabshell', 'verification'));
  return dir;
}
const setManifest = (dir, update) => {
  const file = path.join(dir, '.crabshell', 'verification', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  update(manifest);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
};
function run(dir, args = []) {
  const env = { ...process.env, WIDE_OUTSIDE: outside, CRABSHELL_VERIFY_JSON: '' };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  const result = spawnSync(process.execPath, [path.join(dir, '.crabshell', 'verification', 'run-verify.js'), ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, env, timeout: 120000 });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
const plan = dir => JSON.parse(run(dir, ['--changed', '--dry-run']).stdout);
const flag = (id, on) => { const file = path.join(outside, `${id}.fail`); if (on) fs.writeFileSync(file, '1'); else fs.rmSync(file, { force: true }); };
const show = r => `status=${r.status} ${(r.stdout + r.stderr).slice(-400).replace(/\s+/g, ' ')}`;
const causes = wide => (wide ? wide.causes.map(item => `${item.cause}=${item.checks}`).join('; ') : 'none');

attempt('one shared input', () => {
  const checks = {};
  for (let i = 1; i <= 12; i++) checks[`S${String(i).padStart(2, '0')}`] = 'src/shared.txt';
  checks.A = 'src/a.txt';
  checks.B = 'src/b.txt';
  const dir = project('wide', checks);
  const first = plan(dir);
  check('a first run (every check new) has no notice', first.selected.length === 14 && first.wideSelection === undefined, JSON.stringify(first.wideSelection));
  const firstRun = run(dir, ['--changed']);
  check('first run passes', firstRun.status === 0, show(firstRun));

  write(dir, 'src/shared.txt', 'shared changed\n');
  const wide = plan(dir);
  check('the dry run names the share and the input that pulled the checks in',
    Boolean(wide.wideSelection) && wide.wideSelection.selected === 12 && wide.wideSelection.total === 14 && wide.wideSelection.percent === 86
      && causes(wide.wideSelection) === 'src/shared.txt changed=12', JSON.stringify(wide.wideSelection));
  const explain = run(dir, ['--explain']);
  check('--explain prints the notice', explain.stdout.includes('Wide selection: 12 of 14 checks (86%) chosen by what changed or failed last time. Most checks pulled by: src/shared.txt changed (12)'), show(explain));

  setManifest(dir, manifest => { manifest.wideSelectionMinChecks = 13; });
  check('fewer pulled checks than wideSelectionMinChecks: no notice', plan(dir).wideSelection === undefined);
  setManifest(dir, manifest => { delete manifest.wideSelectionMinChecks; manifest.wideSelectionShare = 0.9; });
  check('a share at or below wideSelectionShare: no notice', plan(dir).wideSelection === undefined);
  setManifest(dir, manifest => { delete manifest.wideSelectionShare; });

  flag('S01', true);
  const changed = run(dir, ['--changed']);
  flag('S01', false);
  check('the run prints the notice under its summary line and still runs every chosen check',
    changed.status === 1 && /Changed-files run: 12 of 14 checks[^\n]*\nWide selection: 12 of 14 checks \(86%\)/.test(changed.stdout)
      && /PASS: 11 \/ FAIL: 1/.test(changed.stdout), show(changed));
  write(dir, 'src/a.txt', 'a changed\n');
  const afterFailure = plan(dir);
  check('a failure in the last run is named as its own cause, beside a changed input',
    afterFailure.wideSelection === undefined && afterFailure.selected.join() === 'S01,A', `${afterFailure.selected} ${causes(afterFailure.wideSelection)}`);
  setManifest(dir, manifest => { manifest.wideSelectionMinChecks = 2; manifest.wideSelectionShare = 0.1; });
  check('with lower limits the two causes are counted apart', causes(plan(dir).wideSelection) === 'failed last time=1; src/a.txt changed=1', causes(plan(dir).wideSelection));

  setManifest(dir, manifest => { manifest.wideSelectionShare = 2; });
  const invalid = run(dir, ['--changed', '--dry-run']);
  check('an invalid setting is refused by the manifest check', invalid.status === 1 && /wideSelectionShare must be a number above 0 and at most 1/.test(invalid.stdout), show(invalid));
});

attempt('checks that use the whole project', () => {
  const dir = project('unknown', { U1: null, U2: null, U3: null, K: 'src/k.txt' }, { wideSelectionMinChecks: 2 });
  const firstRun = run(dir, ['--changed']);
  check('first run passes', firstRun.status === 0, show(firstRun));
  write(dir, 'src/other.txt', 'a new project file\n');
  const wide = plan(dir);
  check('checks with unknown inputs count as one cause, not as the first file that changed',
    causes(wide.wideSelection) === 'unknown inputs (any project file)=3', `${causes(wide.wideSelection)} ${JSON.stringify(wide.reasons)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
