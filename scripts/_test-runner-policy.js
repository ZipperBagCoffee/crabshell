'use strict';
// D143_T011: the run policy — a failure on inputs a check passed with is retried
// (`retries`), heavy checks are told apart by their median pass time
// (`slowAfterSeconds`), --changed runs the likeliest failures and the quickest checks
// first, and `jobs` runs checks side by side within the CPUs and `memoryShare`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const REPO = path.resolve(__dirname, '..');
const RUNNER = process.env.CRABSHELL_TEST_RUNNER || path.join(REPO, 'skills', 'verifying', 'scripts', 'run-verify.js');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const hasPython = spawnSync(PYTHON, ['--version'], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true }).status === 0;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-policy-'));
const outside = path.join(base, 'outside');
fs.mkdirSync(outside);
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`); }
};
const attempt = (name, fn) => { try { fn(); } catch (error) { check(name, false, error.stack.split('\n').slice(0, 2).join(' ')); } };
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

// A Node check: notes "<id> <start> <end>" outside the project, reads its input, waits
// `ms`, and fails while a flag file named after it exists outside the project
// (`once` removes the flag on the first failure).
const nodeCheck = (id, input, { ms = 0, once = false } = {}) => [
  "const fs = require('fs'); const path = require('path');",
  'const start = Date.now();',
  `fs.readFileSync(path.join(process.env.PROJECT_ROOT, '${input}'));`,
  `const until = Date.now() + ${ms}; while (Date.now() < until) {}`,
  `const flag = path.join(process.env.POLICY_OUTSIDE, '${id}.fail');`,
  `fs.appendFileSync(path.join(process.env.POLICY_OUTSIDE, process.env.POLICY_NAME + '.log'), '${id} ' + start + ' ' + Date.now() + '\\n');`,
  `if (fs.existsSync(flag)) { ${once ? 'fs.unlinkSync(flag); ' : ''}process.exit(1); }`,
].join('\n') + '\n';
const entry = (id, extra = {}) => ({ id, type: 'structural', command: { file: 'node', args: [`scripts/_test-${id}.js`] }, contract: { exitCode: 0 }, ...extra });

function project(name, entries, scripts, manifestFields = {}) {
  const dir = path.join(base, name);
  write(dir, 'src/a.txt', 'a\n');
  write(dir, 'src/b.txt', 'b\n');
  for (const [id, source] of Object.entries(scripts)) write(dir, id.includes('/') ? id : `scripts/_test-${id}.js`, source);
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
function run(dir, name, args = []) {
  fs.rmSync(path.join(outside, `${name}.log`), { force: true });
  const env = { ...process.env, POLICY_OUTSIDE: outside, POLICY_NAME: name, CRABSHELL_VERIFY_JSON: '' };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  const result = spawnSync(process.execPath, [path.join(dir, '.crabshell', 'verification', 'run-verify.js'), ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, env, timeout: 120000 });
  let log = [];
  try { log = fs.readFileSync(path.join(outside, `${name}.log`), 'utf8').split(/\r?\n/).filter(Boolean).map(line => { const [id, start, end] = line.split(' '); return { id, start: Number(start), end: Number(end) }; }); } catch (_) {}
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', log, ran: log.map(item => item.id) };
}
const flag = (id, on) => { const file = path.join(outside, `${id}.fail`); if (on) fs.writeFileSync(file, '1'); else fs.rmSync(file, { force: true }); };
const overlap = (log, a, b) => {
  const x = log.find(item => item.id === a); const y = log.find(item => item.id === b);
  return Boolean(x && y) && x.start < y.end && y.start < x.end;
};
const record = (dir, id) => JSON.parse(fs.readFileSync(path.join(dir, '.crabshell', 'verification', 'test-map.json'), 'utf8')).entries[id];
const show = r => `status=${r.status} ran=[${r.ran}] ${r.stdout.slice(-300).replace(/\s+/g, ' ')}`;

try {
  attempt('P1 a failure on inputs the check passed with is retried; a pass on retry is PASS and named flaky', () => {
    const dir = project('p1', [entry('R')], { R: nodeCheck('R', 'src/a.txt', { once: true }) });
    run(dir, 'p1');
    flag('R', true);
    const retried = run(dir, 'p1', ['--no-reuse']);
    flag('R', false);
    check('P1 a failure on inputs the check passed with is retried; a pass on retry is PASS and named flaky',
      retried.status === 0 && retried.ran.join(',') === 'R,R' && /Flaky: R failed and then passed on the same inputs\./.test(retried.stdout), show(retried));
  });

  if (hasPython) attempt('P2 a declared check failing on inputs it passed with uses the whole project until its inputs change', () => {
    const script = 'import os, sys\nsys.exit(1 if os.path.exists(os.path.join(os.environ["POLICY_OUTSIDE"], "D.fail")) else 0)\n';
    const dir = project('p2', [{ id: 'D', type: 'structural', command: { file: PYTHON, args: ['-B', 'tools/d.py'] }, contract: { exitCode: 0 }, inputs: ['tools/d.py'] }], { 'tools/d.py': script });
    run(dir, 'p2');
    flag('D', true);
    const failing = run(dir, 'p2', ['--no-reuse']);
    flag('D', false);
    const distrusted = JSON.parse(run(dir, 'p2', ['--changed', '--dry-run']).stdout);
    setManifest(dir, m => { m.entries[0].inputs = ['tools/']; });
    const redeclared = JSON.parse(run(dir, 'p2', ['--changed', '--dry-run']).stdout);
    check('P2 a declared check failing on inputs it passed with uses the whole project until its inputs change',
      failing.status !== 0 && /D failed on inputs it passed with: its "inputs" miss something, so it uses the whole project until they change\./.test(failing.stdout)
      && distrusted.unknownInputs.includes('D') && !redeclared.unknownInputs.includes('D'),
      `${show(failing)} distrusted=${distrusted.unknownInputs} redeclared=${redeclared.unknownInputs}`);
  });

  attempt('P3 a check whose median pass time is over slowAfterSeconds is heavy without being declared; slow:false keeps it light', () => {
    // The threshold sits well above a plain check's run time (a loaded machine stretched an
    // unslept check past 0.2 s and made it heavy) and well below the slept ones.
    const dir = project('p3', [entry('H'), entry('K', { slow: false }), entry('L')], {
      H: nodeCheck('H', 'src/a.txt', { ms: 1500 }), K: nodeCheck('K', 'src/a.txt', { ms: 1500 }), L: nodeCheck('L', 'src/b.txt'),
    }, { slowAfterSeconds: 1 });
    run(dir, 'p3');
    write(dir, 'src/a.txt', 'a changed\n');
    const changed = run(dir, 'p3', ['--changed']);
    check('P3 a check whose median pass time is over slowAfterSeconds is heavy without being declared; slow:false keeps it light',
      changed.ran.join(',') === 'K' && /Slow checks not run: H \(inputs changed\)/.test(changed.stdout)
      && /Slow check history: H ran 1 time, last failed never\./.test(changed.stdout), show(changed));
  });

  attempt('P4 --changed runs the check that failed last time first, then new checks, then the quickest', () => {
    // Q and S are ranked by one measured pass each, so S's extra time must exceed how much a
    // process start varies on a busy machine (150 ms flipped the order under load).
    const dir = project('p4', [entry('Q'), entry('S'), entry('F')], {
      Q: nodeCheck('Q', 'src/a.txt'), S: nodeCheck('S', 'src/a.txt', { ms: 1000 }), F: nodeCheck('F', 'src/a.txt', { ms: 300 }),
    });
    run(dir, 'p4');
    flag('F', true); run(dir, 'p4', ['F']); flag('F', false);
    setManifest(dir, m => { m.entries.push(entry('N')); });
    write(dir, 'scripts/_test-N.js', nodeCheck('N', 'src/b.txt', { ms: 50 }));
    write(dir, 'src/a.txt', 'a changed\n');
    const ordered = run(dir, 'p4', ['--changed']);
    check('P4 --changed runs the check that failed last time first, then new checks, then the quickest', ordered.ran.join(',') === 'F,N,Q,S', show(ordered));
  });

  attempt('P5 jobs runs checks side by side; exclusive and group keep them apart; a low memoryShare starts one at a time', () => {
    const scripts = { A: nodeCheck('A', 'src/a.txt', { ms: 600 }), B: nodeCheck('B', 'src/b.txt', { ms: 600 }) };
    const dir = project('p5', [entry('A'), entry('B')], scripts, { jobs: 2, memoryShare: 1 });
    const together = run(dir, 'p5', ['--no-reuse']);
    setManifest(dir, m => { m.entries[1].exclusive = true; });
    const exclusive = run(dir, 'p5', ['--no-reuse']);
    setManifest(dir, m => { delete m.entries[1].exclusive; m.entries[0].group = 'g'; m.entries[1].group = 'g'; });
    const grouped = run(dir, 'p5', ['--no-reuse']);
    setManifest(dir, m => { delete m.entries[0].group; delete m.entries[1].group; m.memoryShare = 0.0001; });
    const tight = run(dir, 'p5', ['--no-reuse']);
    const serial = project('p5-serial', [entry('A'), entry('B')], scripts);
    const oneByOne = run(serial, 'p5', ['--no-reuse']);
    check('P5 jobs runs checks side by side; exclusive and group keep them apart; a low memoryShare starts one at a time',
      together.status === 0 && overlap(together.log, 'A', 'B') && !overlap(exclusive.log, 'A', 'B') && !overlap(grouped.log, 'A', 'B')
      && !overlap(tight.log, 'A', 'B') && !overlap(oneByOne.log, 'A', 'B') && oneByOne.ran.length === 2,
      `together=${overlap(together.log, 'A', 'B')}/${together.status} exclusive=${overlap(exclusive.log, 'A', 'B')} grouped=${overlap(grouped.log, 'A', 'B')} tight=${overlap(tight.log, 'A', 'B')} serial=${overlap(oneByOne.log, 'A', 'B')} ${together.stdout.slice(-200)}`);
  });

  attempt('P6 after a new failure no new check starts; the running one finishes and is recorded', () => {
    const dir = project('p6', [entry('X'), entry('Y'), entry('Z')], {
      X: nodeCheck('X', 'src/a.txt', { ms: 50 }), Y: nodeCheck('Y', 'src/a.txt', { ms: 700 }), Z: nodeCheck('Z', 'src/a.txt', { ms: 900 }),
    }, { jobs: 2, memoryShare: 1 });
    run(dir, 'p6');
    flag('X', true);
    write(dir, 'src/a.txt', 'a changed\n');
    const stopped = run(dir, 'p6', ['--changed']);
    flag('X', false);
    check('P6 after a new failure no new check starts; the running one finishes and is recorded',
      stopped.ran.sort().join(',') === 'X,Y' && /Stopped after a new failure \(X\); 1 check not run/.test(stopped.stdout) && Boolean(record(dir, 'Y').passHistory)
      && record(dir, 'Y').passHistory.length === 2, show(stopped));
  });
  attempt('P7 jobs above what this machine can run in parallel is capped there', () => {
    const { concurrencyLimit } = require(path.join(path.dirname(RUNNER), 'runner', 'schedule.js'));
    const machine = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
    check('P7 jobs above what this machine can run in parallel is capped there',
      concurrencyLimit(machine + 100) === machine && concurrencyLimit(1) === 1, `limit=${concurrencyLimit(machine + 100)} machine=${machine}`);
  });
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

if (!hasPython) console.log(`NOTE: ${PYTHON} is not available; P2 (a declared non-Node check) did not run`);
console.log(`runner-policy: ${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed ? 1 : 0);
