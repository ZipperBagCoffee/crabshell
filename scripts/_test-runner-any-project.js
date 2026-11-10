'use strict';
// D143: the verification runner in a project whose checks are not Node (Python here)
// and in a folder with no git. Checks declare `inputs`; heavy ones are `slow`.
// A one-line change prints how many checks ran and how long it took. The comparison with
// the runner before D143 was a one-time measurement (recorded in D143_T006 and T019): a
// baseline taken from git history stops meaning "before" once the change is committed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const REPO = path.resolve(__dirname, '..');
const RUNNER = path.join(REPO, 'skills', 'verifying', 'scripts', 'run-verify.js');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-any-project-'));
const counters = path.join(base, 'counters');
fs.mkdirSync(counters);
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`); }
};

const python = spawnSync(PYTHON, ['--version'], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true });
if (python.status !== 0) {
  console.log(`SKIP: ${PYTHON} is not available; this test needs Python for its non-Node checks`);
  fs.rmSync(base, { recursive: true, force: true });
  process.exit(0);
}

const git = (dir, ...args) => spawnSync('git', ['-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', ...args], { cwd: dir, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

// Each check appends its id to a counter file outside the project, then reads its input.
const checkScript = (id, input, sleepSeconds = 0) => [
  'import os, sys, time',
  `open(os.path.join(os.environ["ANY_PROJECT_COUNTERS"], os.environ["ANY_PROJECT_NAME"] + ".txt"), "a").write("${id}\\n")`,
  sleepSeconds ? `time.sleep(${sleepSeconds})` : '',
  `sys.exit(0 if "ok" in open("${input}").read() else 1)`,
].filter(Boolean).join('\n') + '\n';

function project(name, { withGit, runnerSource }) {
  const dir = path.join(base, name);
  write(dir, 'game/a.py', 'A = "ok"\n');
  write(dir, 'game/b.py', 'B = "ok"\n');
  write(dir, 'tools/check_a.py', checkScript('A', 'game/a.py'));
  write(dir, 'tools/check_b.py', checkScript('B', 'game/b.py'));
  write(dir, 'tools/check_slow.py', checkScript('S', 'game/a.py', 1));
  const entry = (id, script, inputs, extra = {}) => ({ id, type: 'structural', command: { file: PYTHON, args: ['-B', script] }, contract: { exitCode: 0 }, inputs, ...extra });
  write(dir, '.crabshell/verification/manifest.json', JSON.stringify({
    schemaVersion: 2,
    tools: { test: 'node .crabshell/verification/run-verify.js', changed: 'node .crabshell/verification/run-verify.js --changed' },
    entries: [
      entry('A', 'tools/check_a.py', ['game/a.py', 'tools/check_a.py']),
      entry('B', 'tools/check_b.py', ['game/b.py', 'tools/check_b.py']),
      entry('S', 'tools/check_slow.py', ['game/', 'tools/check_slow.py'], { slow: true }),
    ],
  }, null, 2));
  copyRunner(runnerSource.from, path.join(dir, '.crabshell', 'verification'));
  if (withGit) {
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'add', '-f', '.crabshell/verification');
    git(dir, 'commit', '-q', '-m', 'fixture');
  }
  return dir;
}

function run(dir, name, args) {
  fs.rmSync(path.join(counters, `${name}.txt`), { force: true });
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(dir, '.crabshell', 'verification', 'run-verify.js'), ...args], {
    cwd: dir, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PROJECT_ROOT: dir, ANY_PROJECT_COUNTERS: counters, ANY_PROJECT_NAME: name, CRABSHELL_VERIFY_JSON: '' },
  });
  const ms = Date.now() - started;
  let ran = [];
  // Python writes "\r\n" for "\n" in text mode on Windows.
  try { ran = fs.readFileSync(path.join(counters, `${name}.txt`), 'utf8').split(/\r?\n/).filter(Boolean); } catch (_) {}
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', ran, ms };
}

const current = { from: RUNNER };
const measure = (label, r) => console.log(`MEASURE (${label}): a one-line change ran ${r.ran.length} check(s) [${r.ran.join(',')}] in ${r.ms} ms`);

try {
  // --- behavior of the working-tree runner ---
  {
    const dir = project('git-new', { withGit: true, runnerSource: current });
    const first = run(dir, 'git-new', []);
    check('X1 a full run executes every check, slow included', first.status === 0 && first.ran.sort().join(',') === 'A,B,S', `${first.status} ran=${first.ran} ${first.stdout.slice(-200)}`);
    write(dir, 'game/a.py', 'A = "ok"  # one line changed\n');
    const changed = run(dir, 'git-new', ['--changed']);
    measure('git', changed);
    check('X2 one changed input runs only the check that declares it; the slow check that also declares it is skipped and named',
      changed.status === 0 && changed.ran.join(',') === 'A' && /Slow checks not run: S \(inputs changed\) — run them with: node \.crabshell\/verification\/run-verify\.js --slow/.test(changed.stdout),
      `ran=${changed.ran} ${changed.stdout.slice(-300)}`);
    const withSlow = run(dir, 'git-new', ['--changed', '--slow']);
    check('X3 --slow includes the slow check', withSlow.ran.includes('S'), `ran=${withSlow.ran}`);
    write(dir, 'notes.cfg', 'not read by any check\n');
    const unknown = run(dir, 'git-new', ['--changed']);
    // D143_T010 (approved contract change): a changed file no check reads or declares runs
    // the checks without a complete trace (here the declared light ones) once, naming it.
    check('X4 a file no check declares runs the declared light checks once and names it',
      unknown.status === 0 && unknown.ran.sort().join(',') === 'A,B' && /notes\.cfg/.test(unknown.stdout),
      `ran=${unknown.ran} ${unknown.stdout.slice(-300)}`);
    write(dir, 'package.json', '{"name":"fixture"}\n');
    const global = run(dir, 'git-new', ['--changed']);
    // D143_T009/T010: no file name is special (package.json was); it is just another file
    // no check reads, so the declared light checks run once.
    check('X5 a package.json no check reads is not special: the declared light checks run once',
      global.status === 0 && global.ran.sort().join(',') === 'A,B' && /package\.json/.test(global.stdout), `ran=${global.ran} ${global.stdout.slice(-300)}`);
  }
  {
    const dir = project('nogit-new', { withGit: false, runnerSource: current });
    const fresh = run(dir, 'nogit-new', ['--changed']);
    check('X6 no git and no earlier record: the light checks run, the slow one is skipped, no error',
      fresh.status === 0 && fresh.ran.sort().join(',') === 'A,B' && /checks \(2 new\)/.test(fresh.stdout), `${fresh.status} ran=${fresh.ran} ${fresh.stdout.slice(-300)}`);
    run(dir, 'nogit-new', []);
    write(dir, 'game/b.py', 'B = "ok"  # one line changed\n');
    const changed = run(dir, 'nogit-new', ['--changed']);
    measure('no git', changed);
    check('X7 no git: a changed input runs only its check',
      changed.status === 0 && changed.ran.join(',') === 'B' && /1 with changed inputs/.test(changed.stdout), `ran=${changed.ran} ${changed.stdout.slice(-300)}`);
  }

  // --- order, every check after a failure and --failed (D170), notices (D143_T004) ---
  {
    const dir = project('order', { withGit: true, runnerSource: current });
    write(dir, 'tools/check_b.py', checkScript('B', 'game/b.py', 0.4));
    const flag = path.join(counters, 'flaky-flag.txt');
    write(dir, 'tools/check_f.py', [
      'import os, sys',
      `open(os.path.join(os.environ["ANY_PROJECT_COUNTERS"], os.environ["ANY_PROJECT_NAME"] + ".txt"), "a").write("F\\n")`,
      `sys.exit(1 if os.path.exists(${JSON.stringify(flag)}) else 0)`,
    ].join('\n') + '\n');
    write(dir, 'tools/check_q.py', checkScript('Q', 'game/a.py'));
    const manifestFile = path.join(dir, '.crabshell', 'verification', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifest.entries.push({ id: 'F', type: 'structural', command: { file: PYTHON, args: ['-B', 'tools/check_f.py'] }, contract: { exitCode: 0 }, inputs: ['tools/check_f.py'] });
    manifest.entries.push({ id: 'Q', type: 'structural', command: { file: PYTHON, args: ['-B', 'tools/check_q.py'] }, contract: { exitCode: 0 }, inputs: ['tools/check_q.py'], slow: true });
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    git(dir, 'add', '-A'); git(dir, 'add', '-f', '.crabshell/verification/manifest.json'); git(dir, 'commit', '-q', '-m', 'order fixture');
    run(dir, 'order', []);
    // B is listed first in no particular order but takes longer; A must run first.
    write(dir, 'game/b.py', 'B = "ok"  # changed\n');
    write(dir, 'game/a.py', 'A = "ok"  # changed\n');
    const ordered = run(dir, 'order', ['--changed']);
    check('Y1 --changed runs the check with the shorter recorded time first', ordered.status === 0 && ordered.ran.join(',') === 'A,B', `ran=${ordered.ran}`);
    write(dir, 'game/a.py', 'A = "bad"\n');
    write(dir, 'game/b.py', 'B = "ok"  # changed again\n');
    // D170 (approved contract change): a new failure no longer stops a --changed run.
    const keptGoing = run(dir, 'order', ['--changed']);
    check('Y2 --changed runs every chosen check after a new failure and says how to rerun only the failed one',
      keptGoing.status !== 0 && keptGoing.ran.join(',') === 'A,B' && !/Stopped after/.test(keptGoing.stdout)
      && /\[VERIFY\] FAIL A at [\d.]+s — the run goes on\./.test(keptGoing.stderr)
      && /1 failed: A — after the fix, rerun only these: node \.crabshell\/verification\/run-verify\.js --failed; once they pass, run --changed once\./.test(keptGoing.stderr),
      `ran=${keptGoing.ran} ${keptGoing.stdout.slice(-300)} || ${keptGoing.stderr.slice(-300)}`);
    write(dir, 'game/a.py', 'A = "ok"  # fixed\n');
    const onlyFailed = run(dir, 'order', ['--failed']);
    const afterFix = run(dir, 'order', ['--changed']);
    check('Y3 --failed runs only the failed check, and the next --changed reuses its pass and the pass B got in the failing run',
      onlyFailed.status === 0 && onlyFailed.ran.join(',') === 'A' && afterFix.status === 0 && afterFix.ran.length === 0,
      `failed=[${onlyFailed.ran}] ${onlyFailed.stdout.slice(-200)} || after=[${afterFix.ran}] ${afterFix.stdout.slice(-200)}`);
    fs.writeFileSync(flag, '1');
    const flaky = run(dir, 'order', ['--no-reuse']);
    fs.rmSync(flag, { force: true });
    // D143_T011 (approved contract change): a declared check failing again on a retry with
    // the inputs it passed with distrusts its declaration until the declaration changes.
    check('Y4 a declared check failing on the inputs it passed with, even on a retry, distrusts its inputs',
      /F failed on inputs it passed with: its "inputs" miss something, so it uses the whole project until they change\./.test(flaky.stdout), flaky.stdout.slice(-300));
    const manifestAfterY4 = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    manifestAfterY4.entries.find(item => item.id === 'F').inputs = ['tools/'];
    fs.writeFileSync(manifestFile, JSON.stringify(manifestAfterY4, null, 2));
    const full = run(dir, 'order', ['--no-reuse']);
    check('Y6 a full run does not stop early: every check runs', full.ran.sort().join(',') === 'A,B,F,Q,S', `ran=${full.ran}`);

    // D143_T008: a check failing again on the inputs it failed with is named apart from a
    // new failure (D170: neither stops the run).
    write(dir, 'game/a.py', 'A = "bad"\n');
    write(dir, 'game/b.py', 'B = "ok"  # changed for Y7\n');
    const firstFail = run(dir, 'order', ['--changed']);
    write(dir, 'game/b.py', 'B = "ok"  # changed again for Y7\n');
    const sameFail = run(dir, 'order', ['--changed']);
    check('Y7 a check failing again on the inputs it failed with is named as still failing',
      firstFail.ran.join(',') === 'A,B' && !/Still failing/.test(firstFail.stdout) && sameFail.status !== 0 && sameFail.ran.join(',') === 'A,B'
      && /Still failing on the inputs they failed with last time: A/.test(sameFail.stdout) && !/Stopped after/.test(sameFail.stdout),
      `first=${firstFail.ran} same=${sameFail.ran} ${sameFail.stdout.slice(-300)}`);
    write(dir, 'game/a.py', 'A = "still bad"\n');
    write(dir, 'game/b.py', 'B = "ok"  # changed for Y8\n');
    const changedFail = run(dir, 'order', ['--changed']);
    check('Y8 a failed check whose input changed and that fails again is a new failure, not "still failing"',
      changedFail.status !== 0 && changedFail.ran.join(',') === 'A,B' && /FAIL A/.test(changedFail.stdout) && !/Still failing/.test(changedFail.stdout),
      `ran=${changedFail.ran} ${changedFail.stdout.slice(-300)}`);
    const mapFile = path.join(dir, '.crabshell', 'verification', 'test-map.json');
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    delete map.entries.A.failKey;
    fs.writeFileSync(mapFile, JSON.stringify(map, null, 2));
    write(dir, 'game/b.py', 'B = "ok"  # changed for Y9\n');
    const legacy = run(dir, 'order', ['--changed']);
    check('Y9 an older failure record without a failure key counts as a new failure',
      legacy.status !== 0 && legacy.ran.join(',') === 'A,B' && !/Still failing/.test(legacy.stdout), `ran=${legacy.ran} ${legacy.stdout.slice(-300)}`);
  }
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
console.log(`runner-any-project: ${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed ? 1 : 0);
