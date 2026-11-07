'use strict';
// D143_T010: a Node check is "traced" only when the runner saw everything it ran — Node
// children carry the tracer, programs that touch nothing in the project are ignored,
// and any other child makes the check's inputs unknown (the whole project). A changed
// file that no check reads or declares runs the checks without a complete trace once.
// Files a check declares as `outputs` are products, not inputs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const REPO = path.resolve(__dirname, '..');
const RUNNER = process.env.CRABSHELL_TEST_RUNNER || path.join(REPO, 'skills', 'verifying', 'scripts', 'run-verify.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-trace-'));
const counters = path.join(base, 'counters');
fs.mkdirSync(counters);
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`); }
};
const attempt = (name, fn) => { try { fn(); } catch (error) { check(name, false, error.stack.split('\n').slice(0, 2).join(' ')); } };
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

// Each Node check notes its id in a counter file outside the project.
const note = id => `require('fs').appendFileSync(require('path').join(process.env.TR_COUNTERS, process.env.TR_NAME + '.txt'), '${id}\\n');`;
const read = rel => `require('fs').readFileSync(require('path').join(process.env.PROJECT_ROOT, '${rel}'), 'utf8');`;
const node = (id, file) => ({ id, type: 'structural', command: { file: 'node', args: [file] }, contract: { exitCode: 0 } });
// A non-Node check: git is the one program every Crabshell project already has.
const gitCheck = (id, extra = {}) => ({ id, type: 'structural', command: { file: 'git', args: ['--version'] }, contract: { exitCode: 0 }, ...extra });

function project(name, entries, files) {
  const dir = path.join(base, name);
  write(dir, 'src/a.txt', 'a\n');
  write(dir, 'src/b.txt', 'b\n');
  write(dir, 'docs/notes.md', 'notes\n');
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  write(dir, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries }, null, 2));
  copyRunner(RUNNER, path.join(dir, '.crabshell', 'verification'));
  return dir;
}
function run(dir, name, args = []) {
  fs.rmSync(path.join(counters, `${name}.txt`), { force: true });
  const env = { ...process.env, TR_COUNTERS: counters, TR_NAME: name, CRABSHELL_VERIFY_JSON: '' };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  const result = spawnSync(process.execPath, [path.join(dir, '.crabshell', 'verification', 'run-verify.js'), ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, env, timeout: 120000 });
  let ran = [];
  try { ran = fs.readFileSync(path.join(counters, `${name}.txt`), 'utf8').split(/\r?\n/).filter(Boolean).sort(); } catch (_) {}
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', ran };
}
const dry = (dir, name) => JSON.parse(run(dir, name, ['--changed', '--dry-run']).stdout);
const record = (dir, id) => JSON.parse(fs.readFileSync(path.join(dir, '.crabshell', 'verification', 'test-map.json'), 'utf8')).entries[id];
const show = r => `status=${r.status} ran=[${r.ran}] ${r.stdout.slice(-260).replace(/\s+/g, ' ')}`;

try {
  attempt('C1 a Node check that runs another program inside the project has unknown inputs, and the notice says why', () => {
    const dir = project('c1', [node('G', 'scripts/_test-git.js')], {
      'scripts/_test-git.js': `${note('G')}\n${read('src/a.txt')}\nrequire('child_process').spawnSync('git', ['status'], { cwd: process.env.PROJECT_ROOT });\n`,
    });
    const first = run(dir, 'c1');
    write(dir, 'docs/notes.md', 'notes changed\n');
    const unrelated = run(dir, 'c1', ['--changed']);
    check('C1 a Node check that runs another program inside the project has unknown inputs, and the notice says why',
      first.status === 0 && record(dir, 'G').kind === 'project' && /Unknown inputs \(whole project used\): G \(runs git/.test(first.stdout)
      && unrelated.ran.join(',') === 'G', `kind=${record(dir, 'G').kind} first=${show(first)} unrelated=${unrelated.ran}`);
  });

  attempt('C2 a Node child started with a fresh environment is traced too: only its input reruns the check', () => {
    const dir = project('c2', [node('N', 'scripts/_test-child.js'), node('A', 'scripts/_test-a.js')], {
      'scripts/_test-child.js': `${note('N')}\nconst r = require('child_process').spawnSync(process.execPath, [require('path').join(__dirname, 'kid.js')], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PROJECT_ROOT: process.env.PROJECT_ROOT } });\nprocess.exit(r.status);\n`,
      'scripts/kid.js': `${read('src/b.txt')}\n`,
      'scripts/_test-a.js': `${note('A')}\n${read('src/a.txt')}\n`,
    });
    run(dir, 'c2');
    write(dir, 'docs/notes.md', 'notes changed\n');
    const unrelated = run(dir, 'c2', ['--changed']);
    write(dir, 'src/b.txt', 'b changed\n');
    const kidInput = run(dir, 'c2', ['--changed']);
    check('C2 a Node child started with a fresh environment is traced too: only its input reruns the check',
      record(dir, 'N').kind === 'traced' && record(dir, 'N').files.includes('src/b.txt') && unrelated.ran.length === 0 && kidInput.ran.join(',') === 'N',
      `kind=${record(dir, 'N').kind} files=${record(dir, 'N').files} unrelated=${unrelated.ran} kid=${kidInput.ran}`);
  });

  attempt('C3 a program run outside the project with no project path keeps the trace complete', () => {
    const dir = project('c3', [node('O', 'scripts/_test-outside.js')], {
      'scripts/_test-outside.js': `${note('O')}\n${read('src/a.txt')}\nrequire('child_process').spawnSync('git', ['--version'], { cwd: require('os').tmpdir() });\n`,
    });
    run(dir, 'c3');
    write(dir, 'docs/notes.md', 'notes changed\n');
    const unrelated = run(dir, 'c3', ['--changed']);
    check('C3 a program run outside the project with no project path keeps the trace complete',
      record(dir, 'O').kind === 'traced' && unrelated.ran.length === 0, `kind=${record(dir, 'O').kind} unrelated=${unrelated.ran}`);
  });

  attempt('C4 a changed file no check reads or declares runs the checks without a complete trace once', () => {
    const dir = project('c4', [gitCheck('D', { inputs: ['src/b.txt'] }), node('T', 'scripts/_test-t.js')], {
      'scripts/_test-t.js': `${note('T')}\n${read('src/a.txt')}\n`,
    });
    run(dir, 'c4');
    write(dir, 'notes/free.md', 'read by nobody\n');
    const plan = dry(dir, 'c4');
    const once = run(dir, 'c4', ['--changed']);
    const then = dry(dir, 'c4');
    check('C4 a changed file no check reads or declares runs the checks without a complete trace once',
      plan.selected.join(',') === 'D' && /notes\/free\.md changed and no check reads or declares it/.test(plan.reasons.D || '')
      && !once.ran.includes('T') && then.selected.length === 0, `plan=${JSON.stringify(plan.reasons)} once=${once.ran} then=${then.selected}`);
  });

  attempt('C5 declared outputs are products: their writer passes and they rerun no check with unknown inputs', () => {
    // W runs every time (reuse:false), so without `outputs` its write would keep the
    // unknown-input check U from ever recording a pass.
    const dir = project('c5', [{ ...node('W', 'scripts/_test-writer.js'), outputs: ['out/'], reuse: false }, gitCheck('U')], {
      'scripts/_test-writer.js': `${note('W')}\n${read('src/a.txt')}\nconst out = require('path').join(process.env.PROJECT_ROOT, 'out', 'report.txt'); require('fs').mkdirSync(require('path').dirname(out), { recursive: true }); require('fs').writeFileSync(out, String(Date.now()));\n`,
    });
    run(dir, 'c5');
    run(dir, 'c5');
    const third = dry(dir, 'c5');
    check('C5 declared outputs are products: their writer passes and they rerun no check with unknown inputs',
      Boolean(record(dir, 'W').passHistory) && Boolean(record(dir, 'U').passHistory) && third.selected.join(',') === 'W', `W=${JSON.stringify(record(dir, 'W').passHistory)} U=${JSON.stringify(record(dir, 'U').passHistory)} third=${JSON.stringify(third.reasons)}`);
  });

  attempt('C6 a check that writes an input it reads is named, with the fix', () => {
    const dir = project('c6', [node('X', 'scripts/_test-x.js')], {
      'scripts/_test-x.js': `${note('X')}\n${read('src/a.txt')}\nrequire('fs').appendFileSync(require('path').join(process.env.PROJECT_ROOT, 'src/a.txt'), 'more\\n');\n`,
    });
    run(dir, 'c6');
    const second = run(dir, 'c6');
    check('C6 a check that writes an input it reads is named, with the fix',
      /Inputs written while checks ran \(their passes were not recorded\): src\/a\.txt — if a check writes them, declare them in its "outputs"\./.test(second.stdout), show(second));
  });

  attempt('C7 any command\'s file argument is its test file, so an explicit entry is not discovered again', () => {
    const dir = project('c7', [
      { id: 'X', type: 'structural', command: { file: 'git', args: ['hash-object', 'tools/one.txt'] }, contract: { exitCode: 0 } },
      { id: 'D', type: 'structural', discover: { pattern: 'tools/*.txt', command: { file: 'git', args: ['hash-object', '{file}'] } }, contract: { exitCode: 0 } },
    ], { 'tools/one.txt': 'one\n', 'tools/two.txt': 'two\n' });
    const plan = dry(dir, 'c7');
    check('C7 any command\'s file argument is its test file, so an explicit entry is not discovered again',
      plan.selected.join(',') === 'X,D:tools/two.txt', plan.selected.join(','));
  });

  attempt('C8 a machine path is any absolute path that names this machine, not a list of folder names', () => {
    const { looksMachineAbsolute } = require(path.join(path.dirname(RUNNER), 'runner', 'manifest.js'));
    // A real top-level folder of this machine that the runner's code never names (the old
    // rule knew only Users, home, tmp, var, opt, mnt, private and Program Files).
    const named = ['users', 'home', 'tmp', 'var', 'opt', 'mnt', 'private', 'program files'];
    const top = fs.readdirSync(path.parse(process.cwd()).root, { withFileTypes: true })
      .find(item => item.isDirectory() && !named.includes(item.name.toLowerCase()) && !/[\s$]/.test(item.name));
    const machinePath = `/${top.name}/something`;
    check('C8 a machine path is any absolute path that names this machine, not a list of folder names',
      looksMachineAbsolute(machinePath) && looksMachineAbsolute('C:\\work') && looksMachineAbsolute('~/work')
      && !looksMachineAbsolute('/api/v1/items') && !looksMachineAbsolute('relative/path'),
      `${machinePath}=${looksMachineAbsolute(machinePath)} /api=${looksMachineAbsolute('/api/v1/items')}`);
  });
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

console.log(`runner-trace: ${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed ? 1 : 0);
