'use strict';
// D143_T011: the run policy — a failure on inputs a check passed with is retried
// (`retries`), heavy checks are told apart by their median pass time
// (`slowAfterSeconds`), --changed runs the likeliest failures and the quickest checks
// first, and `jobs` runs checks side by side within the CPUs and `memoryShare`.
// D151_T006: `riskPaths` brings heavy checks in, flaky checks are left out until their test
// changes, and a failure that is only a forbidden-file change is run once more.
// D152: checks chosen by the report of what they used (files, folders, items, cases), the
// gate, and which runner code changes rerun every check.
const crypto = require('crypto');
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
// A record holds a value outside its input hashes (where every input's hash already is).
const holdsOutsideInputs = (rec, value) => { const { inputHashes, ...rest } = rec || {}; return JSON.stringify(rest).includes(value); };
// The stdout lines that name every one of `words`: a check id as a whole word, a path as written.
const lines = (r, ...words) => r.stdout.split(/\r?\n/)
  .filter(line => words.every(word => (word.includes('/') ? line.includes(word) : new RegExp(`\\b${word}\\b`).test(line))));
// A check with `src/f.txt` as a forbidden path that writes it every run (`always`), or once
// while a flag file named after it exists outside the project — the one-time write stands in
// for another process writing the file while the check runs.
const forbiddenCheck = (id, { always = false } = {}) => [
  "const fs = require('fs'); const path = require('path');",
  `fs.appendFileSync(path.join(process.env.POLICY_OUTSIDE, process.env.POLICY_NAME + '.log'), '${id} 0 0\\n');`,
  `const flag = path.join(process.env.POLICY_OUTSIDE, '${id}.fail');`,
  `if (${always} || fs.existsSync(flag)) { fs.writeFileSync(path.join(process.env.PROJECT_ROOT, 'src', 'f.txt'), 'written by ${id}\\n'); fs.rmSync(flag, { force: true }); }`,
].join('\n') + '\n';

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
    // Start order (D151_T001: checks may run side by side by default, so the log's finish
    // order is not the order they were started in).
    const started = [...ordered.log].sort((a, b) => a.start - b.start).map(item => item.id).join(',');
    check('P4 --changed runs the check that failed last time first, then new checks, then the quickest', started === 'F,N,Q,S', `started=${started} ${show(ordered)}`);
  });

  attempt('P5 jobs runs checks side by side; exclusive and group keep them apart; a low memoryShare starts one at a time', () => {
    // Long enough that two checks started side by side still overlap when the machine is busy
    // (at 600 ms, startup delays under load once kept them apart — D151_T007).
    const scripts = { A: nodeCheck('A', 'src/a.txt', { ms: 1500 }), B: nodeCheck('B', 'src/b.txt', { ms: 1500 }) };
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
      // X runs long enough for Y to start beside it (starts are spaced, D151_T001) before X fails.
      X: nodeCheck('X', 'src/a.txt', { ms: 600 }), Y: nodeCheck('Y', 'src/a.txt', { ms: 900 }), Z: nodeCheck('Z', 'src/a.txt', { ms: 1500 }),
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

  // D151_T001 — several names in one call; side by side by default for recorded traced Node
  // checks only; a free-memory floor; one start at a time.
  attempt('P8 several check names in one call run exactly those; an unknown name stops the run and is named', () => {
    const scripts = { A: nodeCheck('A', 'src/a.txt'), B: nodeCheck('B', 'src/a.txt'), C: nodeCheck('C', 'src/a.txt') };
    const dir = project('p8', [entry('A'), entry('B'), entry('C')], scripts);
    const two = run(dir, 'p8', ['A', 'C']);
    const unknown = run(dir, 'p8', ['A', 'NOPE']);
    check('P8 several check names in one call run exactly those; an unknown name stops the run and is named',
      two.status === 0 && [...two.ran].sort().join(',') === 'A,C' && unknown.status !== 0 && unknown.ran.length === 0
      && /NOPE/.test(unknown.stdout + unknown.stderr), `${show(two)} | ${show(unknown)}`);
  });

  const scheduleModule = require(path.join(path.dirname(RUNNER), 'runner', 'schedule.js'));
  const canRunTwo = typeof scheduleModule.defaultJobs === 'function' ? scheduleModule.defaultJobs() >= 2 : true;
  attempt('P9 with no jobs setting, recorded traced Node checks run side by side; a check run by another program runs alone', () => {
    if (!canRunTwo) { check('P9 skipped: this machine runs one check at a time by default', true); return; }
    // C is run by another program (Python here): the runner cannot trace it, so by default
    // it never shares the machine (it might share a cache, as a game engine does).
    const pyCheck = 'import os, time\nstart = int(time.time() * 1000)\ntime.sleep(0.7)\n'
      + 'open(os.path.join(os.environ["POLICY_OUTSIDE"], os.environ["POLICY_NAME"] + ".log"), "a").write("C %d %d\\n" % (start, int(time.time() * 1000)))\n';
    const scripts = { A: nodeCheck('A', 'src/a.txt', { ms: 700 }), B: nodeCheck('B', 'src/b.txt', { ms: 700 }) };
    const entries = [entry('A'), entry('B')];
    if (hasPython) {
      scripts['tools/c.py'] = pyCheck;
      entries.push({ id: 'C', type: 'structural', command: { file: PYTHON, args: ['-B', 'tools/c.py'] }, contract: { exitCode: 0 }, inputs: ['tools/c.py'] });
    }
    const dir = project('p9', entries, scripts, { minFreeMemoryMB: 0 });
    const first = run(dir, 'p9', ['--no-reuse']);
    const second = run(dir, 'p9', ['--no-reuse']);
    const cAlone = !hasPython || (second.ran.includes('C') && !overlap(second.log, 'A', 'C') && !overlap(second.log, 'B', 'C'));
    check('P9 with no jobs setting, recorded traced Node checks run side by side; a check run by another program runs alone',
      first.status === 0 && !overlap(first.log, 'A', 'B') && second.status === 0 && overlap(second.log, 'A', 'B') && cAlone,
      `first A/B=${overlap(first.log, 'A', 'B')} second A/B=${overlap(second.log, 'A', 'B')} A/C=${overlap(second.log, 'A', 'C')} B/C=${overlap(second.log, 'B', 'C')} ${show(second)}`);
  });

  attempt('P10 a free-memory floor above the free memory runs checks one at a time', () => {
    const scripts = { A: nodeCheck('A', 'src/a.txt', { ms: 600 }), B: nodeCheck('B', 'src/b.txt', { ms: 600 }) };
    // memoryShare 1 takes the older usage gate out of the way: only the floor can hold B back.
    const dir = project('p10', [entry('A'), entry('B')], scripts, { jobs: 2, memoryShare: 1, minFreeMemoryMB: 1e9 });
    const tight = run(dir, 'p10', ['--no-reuse']);
    check('P10 a free-memory floor above the free memory runs checks one at a time',
      tight.status === 0 && tight.ran.length === 2 && !overlap(tight.log, 'A', 'B'), show(tight));
  });

  attempt('P11 side-by-side checks start one at a time, spaced, and still overlap', () => {
    const scripts = { A: nodeCheck('A', 'src/a.txt', { ms: 1200 }), B: nodeCheck('B', 'src/a.txt', { ms: 1200 }), C: nodeCheck('C', 'src/a.txt', { ms: 1200 }) };
    const dir = project('p11', [entry('A'), entry('B'), entry('C')], scripts, { jobs: 3, minFreeMemoryMB: 0, startSpacingMs: 300 });
    const spaced = run(dir, 'p11', ['--no-reuse']);
    const starts = spaced.log.map(item => item.start).sort((a, b) => a - b);
    const [first, , last] = [...spaced.log].sort((a, b) => a.start - b.start);
    check('P11 side-by-side checks start one at a time, spaced, and still overlap',
      spaced.status === 0 && starts.length === 3 && starts[1] - starts[0] >= 200 && starts[2] - starts[1] >= 200
      && Boolean(first && last) && overlap(spaced.log, first.id, last.id),
      `starts=${starts.map(s => s - starts[0]).join(',')} ${show(spaced)}`);
  });
  attempt('P12 each run says how many check runs there were since the last commit; a commit starts the count again', () => {
    const git = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
    const dir = project('p12', [entry('A')], { A: nodeCheck('A', 'src/a.txt') });
    if (git(dir, ['init', '-q']).status !== 0) { check('P12 skipped: git is not available', true); return; }
    const commit = message => { git(dir, ['add', '-A']); git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message]); };
    commit('first');
    const one = run(dir, 'p12', ['--changed']);
    write(dir, 'src/a.txt', 'a changed\n');
    const two = run(dir, 'p12', ['--changed']);
    commit('second');
    const again = run(dir, 'p12', ['--changed']);
    const count = r => (r.stdout.match(/Check run (\d+) since the last commit/) || [])[1];
    check('P12 each run says how many check runs there were since the last commit; a commit starts the count again',
      count(one) === '1' && count(two) === '2' && count(again) === '1', `one=${count(one)} two=${count(two)} again=${count(again)} ${show(again)}`);
  });
  attempt('P13 a changed test that holds its input\'s text word for word is named once; derived, own or short text is not', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog every day';
    const own = 'this sentence is written only inside the test file itself';
    const reads = id => "const fs = require('fs'); const path = require('path');\n"
      + `fs.appendFileSync(path.join(process.env.POLICY_OUTSIDE, process.env.POLICY_NAME + '.log'), '${id} 0 0\\n');\n`
      + "const text = fs.readFileSync(path.join(process.env.PROJECT_ROOT, 'src/msg.txt'), 'utf8');\n";
    const dir = project('p13', [entry('C'), entry('D')], {
      C: `${reads('C')}const own = '${own}';\nif (!own || !text.includes('${sentence}')) process.exit(1);\n`,
      D: `${reads('D')}if (text.trim().split(' ').length < 3) process.exit(1);\n`,
    });
    write(dir, 'src/msg.txt', `${sentence}\n`);
    const named = (r, test) => r.stdout.split(/\r?\n/).filter(line => line.includes(test) && line.includes('src/msg.txt'));
    const first = run(dir, 'p13', ['--changed']);
    const quiet = run(dir, 'p13', ['--changed']);
    setManifest(dir, manifest => { manifest.copyLiteralMinChars = sentence.length + 1; });
    write(dir, 'scripts/_test-C.js', `${fs.readFileSync(path.join(dir, 'scripts', '_test-C.js'), 'utf8')}// edited\n`);
    const longer = run(dir, 'p13', ['--changed']);
    const copied = named(first, 'scripts/_test-C.js');
    check('P13 a changed test that holds its input\'s text word for word is named once; derived, own or short text is not',
      first.status === 0 && copied.length === 1 && copied[0].includes(sentence.slice(0, 19)) && !first.stdout.includes(own.slice(0, 19))
      && named(first, 'scripts/_test-D.js').length === 0 && named(quiet, 'scripts/_test-C.js').length === 0
      && longer.status === 0 && longer.ran.includes('C') && named(longer, 'scripts/_test-C.js').length === 0,
      `first=${show(first)} | quiet=${show(quiet)} | longer=${show(longer)}`);
    // The run settings added with D151 are checked like the others: a wrong value is a manifest error naming it.
    const wrong = { copyLiteralMinChars: 0, minFreeMemoryMB: -1, startSpacingMs: 'soon' };
    const refused = Object.entries(wrong).filter(([name, value]) => {
      setManifest(dir, manifest => { delete manifest.copyLiteralMinChars; manifest[name] = value; });
      const r = run(dir, 'p13', ['--changed']);
      setManifest(dir, manifest => { delete manifest[name]; });
      return r.status !== 0 && `${r.stdout}${r.stderr}`.includes(name);
    }).map(([name]) => name);
    check('P13b a wrong value of a D151 run setting is a manifest error naming the setting',
      refused.length === Object.keys(wrong).length, `refused=${refused.join(',')}`);
  });

  // D151_T006 — heavy checks by declared risk paths; flaky checks quarantined; a failure
  // that is only a forbidden-file change is checked again.
  attempt('P14 a changed file under riskPaths brings heavy checks whose inputs changed into --changed; otherwise they wait for --slow', () => {
    const dir = project('p14', [entry('H', { slow: true }), entry('G', { slow: true }), entry('L')], {
      H: nodeCheck('H', 'src/a.txt'), G: nodeCheck('G', 'src/b.txt'), L: nodeCheck('L', 'src/a.txt'),
    }, { riskPaths: ['src/risk/'] });
    write(dir, 'src/risk/core.txt', 'core\n');
    run(dir, 'p14');
    write(dir, 'src/a.txt', 'a changed\n');
    const quiet = run(dir, 'p14', ['--changed']);
    write(dir, 'src/a.txt', 'a changed again\n');
    write(dir, 'src/risk/core.txt', 'core changed\n');
    const risky = run(dir, 'p14', ['--changed']);
    check('P14 a changed file under riskPaths brings heavy checks whose inputs changed into --changed; otherwise they wait for --slow',
      quiet.status === 0 && quiet.ran.join(',') === 'L' && lines(quiet, 'H').length > 0
      && risky.status === 0 && [...risky.ran].sort().join(',') === 'H,L' && lines(risky, 'H', 'src/risk/core.txt').length === 1
      && lines(risky, 'G').length > 0,
      `quiet=${show(quiet)} | risky=${show(risky)}`);
  });

  attempt('P15 a check that failed and then passed on the same inputs is left out of --changed until its test file changes', () => {
    const testFile = 'scripts/_test-R.js';
    const dir = project('p15', [entry('R'), entry('M')], { R: nodeCheck('R', 'src/a.txt', { once: true }), M: nodeCheck('M', 'src/b.txt') });
    run(dir, 'p15');
    flag('R', true);
    const flaky = run(dir, 'p15', ['--no-reuse']);
    flag('R', false);
    // The record keeps the mark with the test file's content identity (beyond its input hashes).
    const testHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, testFile))).digest('hex');
    const marked = holdsOutsideInputs(record(dir, 'R'), testHash);
    write(dir, 'src/a.txt', 'a changed\n');
    const left = run(dir, 'p15', ['--changed']);
    const slow = run(dir, 'p15', ['--changed', '--slow']);
    write(dir, 'src/a.txt', 'a changed again\n');
    const leftAgain = run(dir, 'p15', ['--changed']);
    const full = run(dir, 'p15');
    const byName = run(dir, 'p15', ['R']);
    write(dir, testFile, `${fs.readFileSync(path.join(dir, testFile), 'utf8')}// edited\n`);
    const back = run(dir, 'p15', ['--changed']);
    check('P15 a check that failed and then passed on the same inputs is left out of --changed until its test file changes',
      flaky.status === 0 && flaky.ran.filter(id => id === 'R').length === 2 && marked
      && left.status === 0 && !left.ran.includes('R') && lines(left, 'R', testFile).length === 1
      && slow.ran.includes('R') && !leftAgain.ran.includes('R') && full.ran.includes('R') && byName.ran.includes('R')
      && back.status === 0 && back.ran.includes('R') && lines(back, 'R', testFile).length === 0,
      `marked=${marked} flaky=${show(flaky)} | left=${show(left)} | slow=${slow.ran} leftAgain=${leftAgain.ran} full=${full.ran} byName=${byName.ran} | back=${show(back)}`);
  });

  attempt('P16 a failure that is only a forbidden-file change runs once more: unchanged then is PASS and named; written again stays FAIL', () => {
    const contract = { exitCode: 0, forbiddenChanges: ['src/f.txt'] };
    const other = project('p16-other', [entry('OTHER', { contract })], { OTHER: forbiddenCheck('OTHER') });
    const self = project('p16-self', [entry('SELF', { contract })], { SELF: forbiddenCheck('SELF', { always: true }) });
    for (const dir of [other, self]) write(dir, 'src/f.txt', 'seed\n');
    flag('OTHER', true);
    const cleared = run(other, 'p16');
    flag('OTHER', false);
    const stands = run(self, 'p16');
    const lastRun = dir => JSON.parse(fs.readFileSync(path.join(dir, '.crabshell', 'verification', 'last-run.json'), 'utf8'));
    const selfResult = lastRun(self).find(result => result.id === 'SELF') || {};
    const testHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(other, 'scripts', '_test-OTHER.js'))).digest('hex');
    check('P16 a failure that is only a forbidden-file change runs once more: unchanged then is PASS and named; written again stays FAIL',
      cleared.status === 0 && cleared.ran.join(',') === 'OTHER,OTHER' && lines(cleared, 'OTHER', 'src/f.txt').length === 1
      && !lines(cleared, 'OTHER').some(line => /flaky/i.test(line)) && !holdsOutsideInputs(record(other, 'OTHER'), testHash)
      && stands.status !== 0 && stands.ran.join(',') === 'SELF,SELF' && selfResult.status === 'FAIL'
      && Boolean(selfResult.observation) && selfResult.observation.changedForbidden.includes('src/f.txt'),
      `cleared=${show(cleared)} | stands=${show(stands)}`);
  });

  attempt('P17 a wrong riskPaths value is a manifest error naming the setting', () => {
    const dir = project('p17', [entry('A')], { A: nodeCheck('A', 'src/a.txt') });
    const wrong = ['src/', ['C:/outside/'], ['']];
    const refused = wrong.filter(value => {
      setManifest(dir, manifest => { manifest.riskPaths = value; });
      const r = run(dir, 'p17', ['--changed']);
      return r.status !== 0 && r.ran.length === 0 && `${r.stdout}${r.stderr}`.includes('riskPaths');
    });
    check('P17 a wrong riskPaths value is a manifest error naming the setting', refused.length === wrong.length, `refused=${JSON.stringify(refused)}`);
  });
  attempt('P18 a changed test holding a command, a code line or a code span from its input is not named; only prose is', () => {
    // Long quoted text that is not prose: a command line, a code statement, and a code span in
    // backticks inside a comment. Each is word for word in the input the test reads.
    const command = 'node scripts/run-thing.js --flag value --other';
    const code = "const { spawnSync } = require('child_process');";
    const span = "process.env.SOME_LONG_FLAG_NAME === 'enabled'";
    const dir = project('p18', [entry('E')], {
      E: "const fs = require('fs'); const path = require('path');\n"
        + `fs.appendFileSync(path.join(process.env.POLICY_OUTSIDE, process.env.POLICY_NAME + '.log'), 'E 0 0\\n');\n`
        + "const text = fs.readFileSync(path.join(process.env.PROJECT_ROOT, 'src/cmd.txt'), 'utf8');\n"
        + `// The source checks \`${span}\` first.\n`
        + `const lines = ['${command}', ${JSON.stringify(code)}];\n`
        + 'if (!lines.every(line => text.includes(line))) process.exit(1);\n',
    });
    write(dir, 'src/cmd.txt', `${command}\n${code}\n${span}\n`);
    const first = run(dir, 'p18', ['--changed']);
    const named = first.stdout.split(/\r?\n/).filter(line => line.includes('scripts/_test-E.js') && line.includes('src/cmd.txt'));
    check('P18 a changed test holding a command, a code line or a code span from its input is not named; only prose is',
      first.status === 0 && first.ran.includes('E') && named.length === 0, `named=${named.join(' | ').slice(0, 200)} ${show(first)}`);
  });
  attempt('P19 a folder a check only lists or probes stands for its names; a folder it copies, for every file in it', () => {
    const logLine = id => `fs.appendFileSync(path.join(process.env.POLICY_OUTSIDE, process.env.POLICY_NAME + '.log'), '${id} 0 0\\n');\n`;
    const head = "const fs = require('fs'); const os = require('os'); const path = require('path');\nconst src = path.join(process.env.PROJECT_ROOT, 'src');\n";
    const dir = project('p19', [entry('L'), entry('X'), entry('C')], {
      L: `${head}${logLine('L')}fs.readdirSync(src);\n`,
      X: `${head}${logLine('X')}if (!fs.existsSync(src)) process.exit(1);\n`,
      C: `${head}${logLine('C')}const t = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-copy-'));\nfs.cpSync(src, path.join(t, 'src'), { recursive: true });\nfs.rmSync(t, { recursive: true, force: true });\n`,
    });
    const first = run(dir, 'p19', ['--changed']);
    write(dir, 'src/b.txt', 'b edited\n');
    const edited = run(dir, 'p19', ['--changed']);
    write(dir, 'src/c.txt', 'c\n');
    const added = run(dir, 'p19', ['--changed']);
    const same = (r, ids) => r.status === 0 && [...r.ran].sort().join(',') === [...ids].sort().join(',');
    check('P19 a folder a check only lists or probes stands for its names; a folder it copies, for every file in it',
      same(first, ['L', 'X', 'C']) && same(edited, ['C']) && same(added, ['L', 'X', 'C']),
      `first=[${first.ran}] edited=[${edited.ran}] added=[${added.ran}] ${show(added)}`);
  });
  attempt('P20 --replay N estimates from the records which checks each of the last N commits would run; nothing runs', () => {
    const git = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
    const dir = project('p20', [entry('A'), entry('B')], { A: nodeCheck('A', 'src/a.txt'), B: nodeCheck('B', 'src/b.txt') });
    if (git(dir, ['init', '-q']).status !== 0) { check('P20 skipped: git is not available', true); return; }
    const commit = message => { git(dir, ['add', '-A']); git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message]); };
    commit('first');
    run(dir, 'p20', ['--changed']);
    write(dir, 'src/a.txt', 'a changed\n');
    commit('touch a');
    const head = git(dir, ['rev-parse', '--short', 'HEAD']).stdout.trim();
    const replayed = run(dir, 'p20', ['--replay', '1', '--json']);
    let rows = null;
    try { rows = JSON.parse(replayed.stdout); } catch (_) {}
    const row = Array.isArray(rows) ? rows[0] : null;
    check('P20 --replay N estimates from the records which checks each of the last N commits would run; nothing runs',
      replayed.status === 0 && replayed.ran.length === 0 && Array.isArray(rows) && rows.length === 1 && Boolean(row)
      && head.startsWith(row.commit) && row.selected === 1 && Number.isFinite(row.estimatedMs),
      `rows=${JSON.stringify(rows)} head=${head} ${show(replayed)}`);
  });
  // D152 — a check that reports what it used is chosen by that report. The checks below are
  // written in a language the runner never names, and read data in a made-up sectioned format
  // ("[name]" opens an item; lines before the first one are the file's rest) that only the
  // project's own code knows.
  const { REPORT_ENV } = require(path.join(path.dirname(RUNNER), 'runner', 'used-report.js'));
  const store = [
    'import hashlib, os',
    "ROOT = os.environ['PROJECT_ROOT']",
    "def esc(value): return str(value).replace('%', '%25').replace('\\t', '%09').replace('\\r', '%0D').replace('\\n', '%0A')",
    'def line(*fields):',
    `    target = os.environ.get('${REPORT_ENV}')`,
    '    if target:',
    "        with open(target, 'a', encoding='utf-8') as out: out.write('\\t'.join(esc(f) for f in fields) + '\\n')",
    'def log(name):',
    "    with open(os.path.join(os.environ['POLICY_OUTSIDE'], os.environ['POLICY_NAME'] + '.log'), 'a') as out: out.write(name + ' 0 0\\n')",
    'def sections(rel):',
    '    items, rest, current = {}, [], None',
    "    with open(os.path.join(ROOT, rel), encoding='utf-8') as source: text = source.read()",
    '    for raw in text.splitlines():',
    "        if raw.startswith('[') and raw.endswith(']'): current = raw[1:-1]; items[current] = ''",
    '        elif current is None: rest.append(raw)',
    "        else: items[current] += raw + '\\n'",
    "    return items, '\\n'.join(rest)",
    "def fp(text): return hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]",
    'def lookup(rel, name, case=None):',
    '    value = sections(rel)[0].get(name)',
    "    line('item', rel, name, fp(value) if value is not None else '', *([case] if case else []))",
    '    return value',
    'def whole(rel, case=None):',
    "    line('file', rel, *([case] if case else []))",
    '    return True',
    "def done(): line('done')",
    'def raw(text):',
    `    with open(os.environ['${REPORT_ENV}'], 'a', encoding='utf-8') as out: out.write(text)`,
  ].join('\n') + '\n';
  // The project's item identity command: every item's fingerprint and the rest, per file.
  const identity = "import os, sys\nsys.path.insert(0, os.path.join(os.environ['PROJECT_ROOT'], 'tools'))\nfrom store import *\n"
    + "for rel in sys.argv[1:]:\n    items, rest = sections(rel)\n"
    + "    for name, text in items.items(): print('\\t'.join(esc(f) for f in ['item', rel, name, fp(text)]))\n"
    + "    print('\\t'.join(esc(f) for f in ['rest', rel, fp(rest)]))\n";
  const pyCheck = (id, body) => "import os, sys\nsys.path.insert(0, os.path.join(os.environ['PROJECT_ROOT'], 'tools'))\nfrom store import *\n"
    + `log('${id}')\n${body}\n`;
  const pyEntry = (id, extra = {}) => ({ id, type: 'structural', command: { file: PYTHON, args: ['-B', `tools/${id.toLowerCase()}.py`] },
    contract: { exitCode: 0 }, inputs: ['data/', 'tools/'], reportScope: ['data/'], ...extra });
  const itemIdentity = { file: PYTHON, args: ['-B', 'tools/identity.py'] };
  const stock = (alpha, beta, rest = 'unit = coin') => `${rest}\n[alpha]\nprice = ${alpha}\n[beta]\nprice = ${beta}\n`;
  const sorted = r => [...r.ran].sort().join(',');
  const lastRun = dir => JSON.parse(fs.readFileSync(path.join(dir, '.crabshell', 'verification', 'last-run.json'), 'utf8'));
  const dryRun = (dir, name) => JSON.parse(run(dir, name, ['--changed', '--dry-run']).stdout);

  if (hasPython) attempt('P21 a check that reports the files it used reruns only when one of them changes; a folder it reports reruns it when a file is added there', () => {
    // W reports one file; F reports the data folder (its list of names); O declares other/ and reports nothing.
    const dir = project('p21', [pyEntry('W'), pyEntry('F'), { ...pyEntry('O'), inputs: ['other/', 'tools/o.py'] }], {
      'tools/store.py': store, 'tools/w.py': pyCheck('W', "whole('data/one.kv')\ndone()"),
      'tools/f.py': pyCheck('F', "whole('data/')\ndone()"), 'tools/o.py': pyCheck('O', ''),
      'data/one.kv': 'one\n', 'data/two.kv': 'two\n', 'other/x.kv': 'x\n',
    });
    const first = run(dir, 'p21');
    write(dir, 'data/two.kv', 'two edited\n');
    const unused = run(dir, 'p21', ['--changed']);
    write(dir, 'data/one.kv', 'one edited\n');
    const used = run(dir, 'p21', ['--changed']);
    write(dir, 'data/three.kv', 'three\n');
    const added = run(dir, 'p21', ['--changed']);
    // Predicted: [] (AC1, and AC6: O does not read data/two.kv yet is not run for it), [W], [F].
    check('P21 a check that reports the files it used reruns only when one of them changes; a folder it reports reruns it when a file is added there',
      first.status === 0 && sorted(first) === 'F,O,W' && record(dir, 'W').kind === 'reported' && record(dir, 'F').files.includes('data/')
      && unused.status === 0 && sorted(unused) === '' && used.status === 0 && sorted(used) === 'W' && added.status === 0 && sorted(added) === 'F',
      `first=[${first.ran}] unused=[${unused.ran}] used=[${used.ran}] added=[${added.ran}] W=${JSON.stringify(record(dir, 'W'))}`);
  });

  if (hasPython) attempt('P22 a broken report (no done line, empty, a path outside the project) or none chooses the check as before', () => {
    const dir = project('p22', [pyEntry('B1'), pyEntry('B2'), pyEntry('B3'), pyEntry('B4')], {
      'tools/store.py': store,
      'tools/b1.py': pyCheck('B1', "whole('data/one.kv')"),
      'tools/b2.py': pyCheck('B2', `open(os.environ['${REPORT_ENV}'], 'a').close()`),
      'tools/b3.py': pyCheck('B3', "whole('../outside.kv')\ndone()"),
      'tools/b4.py': pyCheck('B4', ''),
      'data/one.kv': 'one\n', 'data/two.kv': 'two\n',
    });
    const first = run(dir, 'p22');
    write(dir, 'data/two.kv', 'two edited\n');
    const after = run(dir, 'p22', ['--changed']);
    const kinds = ['B1', 'B2', 'B3', 'B4'].map(id => record(dir, id).kind).join(',');
    const problems = ['B1', 'B2', 'B3'].filter(id => record(dir, id).reportProblem).length;
    // Predicted: all four run again (each declares data/), all recorded as declared.
    check('P22 a broken report (no done line, empty, a path outside the project) or none chooses the check as before',
      first.status === 0 && after.status === 0 && sorted(after) === 'B1,B2,B3,B4' && kinds === 'declared,declared,declared,declared' && problems === 3,
      `after=[${after.ran}] kinds=${kinds} problems=${problems} ${show(after)}`);
  });

  if (hasPython) attempt('P23 an item report reruns a check when its item or the rest of its file changes, not another item; without itemIdentity the file counts', () => {
    const scripts = {
      'tools/store.py': store, 'tools/identity.py': identity,
      'tools/ia.py': pyCheck('IA', "lookup('data/stock.kv', 'alpha')\ndone()"),
      'tools/ib.py': pyCheck('IB', "lookup('data/stock.kv', 'beta')\ndone()"),
      'tools/ic.py': pyCheck('IC', "lookup('data/stock.kv', 'gamma')\ndone()"),
      'data/stock.kv': stock(1, 2),
    };
    const entries = [pyEntry('IA'), pyEntry('IB'), pyEntry('IC')];
    const items = project('p23', entries, scripts, { itemIdentity });
    const whole = project('p23-whole', entries, scripts);
    const steps = dir => {
      const out = [run(dir, 'p23')];
      write(dir, 'data/stock.kv', stock(1, 3)); out.push(run(dir, 'p23', ['--changed']));
      write(dir, 'data/stock.kv', `${stock(1, 3)}[gamma]\nprice = 9\n`); out.push(run(dir, 'p23', ['--changed']));
      write(dir, 'data/stock.kv', `${stock(1, 3, 'unit = gem')}[gamma]\nprice = 9\n`); out.push(run(dir, 'p23', ['--changed']));
      return out;
    };
    const [i0, iBeta, iGamma, iRest] = steps(items);
    const [w0, wBeta] = steps(whole);
    // Predicted with itemIdentity: [IB], [IC] (an item looked up and missing, then added), [IA,IB,IC] (the rest);
    // without it: [IA,IB,IC] for the beta edit.
    check('P23 an item report reruns a check when its item or the rest of its file changes, not another item; without itemIdentity the file counts',
      i0.status === 0 && sorted(iBeta) === 'IB' && sorted(iGamma) === 'IC' && sorted(iRest) === 'IA,IB,IC'
      && w0.status === 0 && sorted(wBeta) === 'IA,IB,IC',
      `beta=[${iBeta.ran}] gamma=[${iGamma.ran}] rest=[${iRest.ran}] wholeBeta=[${wBeta.ran}] ${show(iBeta)}`);
  });

  if (hasPython) attempt('P24 a gate: narrowed checks are reused only once it passed on the current files, and are not run when it fails', () => {
    const dir = project('p24', [pyEntry('G', { gate: true, inputs: ['data/', 'tools/g.py'] }), pyEntry('IA'), pyEntry('IB')], {
      'tools/store.py': store, 'tools/identity.py': identity,
      'tools/g.py': pyCheck('G', "sys.exit(1 if 'BROKEN' in open(os.path.join(ROOT, 'data/stock.kv')).read() else 0)"),
      'tools/ia.py': pyCheck('IA', "lookup('data/stock.kv', 'alpha')\ndone()"),
      'tools/ib.py': pyCheck('IB', "lookup('data/stock.kv', 'beta')\ndone()"),
      'data/stock.kv': stock(1, 2),
    }, { itemIdentity });
    run(dir, 'p24');
    write(dir, 'data/stock.kv', stock(1, 3));
    const waiting = dryRun(dir, 'p24');
    const passed = run(dir, 'p24', ['--changed']);
    const reusedAfterGate = (lastRun(dir).find(result => result.id === 'IA') || {});
    write(dir, 'data/stock.kv', stock(1, '3\nBROKEN'));
    const failed = run(dir, 'p24');
    const blocked = (lastRun(dir).find(result => result.id === 'IA') || {});
    // Predicted: IA waits for G; --changed runs [G,IB] and reuses IA after G; when G fails, IA is NOT_RUN.
    check('P24 a gate: narrowed checks are reused only once it passed on the current files, and are not run when it fails',
      waiting.awaitingGate && waiting.awaitingGate.checks.join(',') === 'IA' && waiting.selected.join(',') === 'G,IB'
      && passed.status === 0 && sorted(passed) === 'G,IB' && reusedAfterGate.status === 'PASS' && reusedAfterGate.reused === true
      && failed.status !== 0 && blocked.status === 'NOT_RUN' && /gate G did not pass/.test(blocked.message) && !failed.ran.includes('IA'),
      `waiting=${JSON.stringify(waiting.awaitingGate)} selected=${waiting.selected} passed=[${passed.ran}] IA=${JSON.stringify(reusedAfterGate)} failed=[${failed.ran}] blocked=${JSON.stringify(blocked)}`);
  });

  if (hasPython) attempt('P25 a {cases} entry runs again only the cases that used what changed, and the cases that failed', () => {
    const cases = pyCheck('K', [
      "CASES = {'c1': lambda: lookup('data/stock.kv', 'alpha', 'c1'), 'c2': lambda: lookup('data/stock.kv', 'beta', 'c2'), 'c3': lambda: whole('data/other.kv', 'c3')}",
      "failing = os.path.exists(os.path.join(os.environ['POLICY_OUTSIDE'], 'K.fail'))",
      'code = 0',
      'for name in (sys.argv[1:] or sorted(CASES)):',
      "    log('K:' + name)",
      '    CASES[name]()',
      "    ok = not (failing and name == 'c2')",
      "    line('result', name, 'pass' if ok else 'fail')",
      '    code = code or (0 if ok else 1)',
      'done()',
      'sys.exit(code)',
    ].join('\n'));
    const entryK = { ...pyEntry('K'), command: { file: PYTHON, args: ['-B', 'tools/k.py', '{cases}'] } };
    const dir = project('p25', [entryK], { 'tools/store.py': store, 'tools/identity.py': identity, 'tools/k.py': cases,
      'data/stock.kv': stock(1, 2), 'data/other.kv': 'other\n' }, { itemIdentity });
    const cased = r => r.ran.filter(id => id.startsWith('K:')).map(id => id.slice(2)).sort().join(',');
    const first = run(dir, 'p25');
    write(dir, 'data/other.kv', 'other edited\n');
    const other = run(dir, 'p25', ['--changed']);
    write(dir, 'data/stock.kv', stock(1, 3));
    const beta = run(dir, 'p25', ['--changed']);
    flag('K', true);
    write(dir, 'data/stock.kv', stock(1, 4));
    const failing = run(dir, 'p25', ['--changed']);
    flag('K', false);
    const fixed = run(dir, 'p25', ['--changed']);
    const quiet = run(dir, 'p25', ['--changed']);
    write(dir, 'tools/k.py', `${cases}# edited\n`);
    const testEdited = run(dir, 'p25', ['--changed']);
    // Predicted: all three, then [c3], [c2], [c2] failing, [c2] (the failed case), nothing, all three (the test changed).
    check('P25 a {cases} entry runs again only the cases that used what changed, and the cases that failed',
      cased(first) === 'c1,c2,c3' && cased(other) === 'c3' && cased(beta) === 'c2' && failing.status !== 0 && cased(failing) === 'c2'
      && fixed.status === 0 && cased(fixed) === 'c2' && quiet.ran.length === 0 && cased(testEdited) === 'c1,c2,c3',
      `first=${cased(first)} other=${cased(other)} beta=${cased(beta)} failing=${cased(failing)} fixed=${cased(fixed)} quiet=[${quiet.ran}] edited=${cased(testEdited)} ${show(fixed)}`);
  });

  if (hasPython) attempt('P26 a Node check with declared inputs whose trace is incomplete keeps its traced reads and is not named as unknown inputs', () => {
    const dir = project('p26', [entry('N', { inputs: ['src/a.txt'] })], {
      N: "const fs = require('fs'); const path = require('path'); const { spawnSync } = require('child_process');\n"
        + "fs.appendFileSync(path.join(process.env.POLICY_OUTSIDE, process.env.POLICY_NAME + '.log'), 'N 0 0\\n');\n"
        + "fs.readFileSync(path.join(process.env.PROJECT_ROOT, 'src', 'a.txt')); fs.readFileSync(path.join(process.env.PROJECT_ROOT, 'src', 'b.txt'));\n"
        + `spawnSync(${JSON.stringify(PYTHON)}, ['-c', 'pass'], { cwd: process.env.PROJECT_ROOT });\n`,
    });
    const first = run(dir, 'p26');
    write(dir, 'src/b.txt', 'b edited\n');
    const plan = dryRun(dir, 'p26');
    // Predicted: kind declared (not project), no unknown-inputs notice, rerun because src/b.txt (a traced read) changed.
    check('P26 a Node check with declared inputs whose trace is incomplete keeps its traced reads and is not named as unknown inputs',
      first.status === 0 && record(dir, 'N').kind === 'declared' && Array.isArray(record(dir, 'N').incomplete)
      && lines(first, 'N').filter(line => /Unknown inputs/.test(line)).length === 0
      && plan.selected.join(',') === 'N' && plan.reasons.N === 'src/b.txt changed' && !plan.unknownInputs.includes('N'),
      `kind=${record(dir, 'N').kind} reason=${plan.reasons.N} unknown=${plan.unknownInputs} ${show(first)}`);
  });

  attempt('P27 a runner update that changes only the code recording inputs keeps every pass; contract, execute or the tracer code reruns', () => {
    const dir = project('p27', [entry('A')], { A: nodeCheck('A', 'src/a.txt') });
    run(dir, 'p27');
    const modules = path.join(dir, '.crabshell', 'verification', 'runner');
    for (const name of ['select.js', 'fingerprint.js', 'snapshot.js', 'manifest.js']) fs.appendFileSync(path.join(modules, name), '\nmodule.exports.releaseMarker = 1;\n');
    const tracePath = path.join(modules, 'trace.js');
    fs.appendFileSync(tracePath, '\nmodule.exports.releaseMarker = 1;\n');
    const recording = dryRun(dir, 'p27');
    const contractPath = path.join(modules, 'contract.js');
    const contractText = fs.readFileSync(contractPath, 'utf8');
    fs.appendFileSync(contractPath, '\nmodule.exports.releaseMarker = 1;\n');
    const judging = dryRun(dir, 'p27');
    fs.writeFileSync(contractPath, contractText);
    const traceText = fs.readFileSync(tracePath, 'utf8');
    const opening = "const TRACER_SOURCE = `'use strict';\n";
    fs.writeFileSync(tracePath, traceText.replace(opening, `${opening}const releaseMarker = 1;\n`));
    const tracing = dryRun(dir, 'p27');
    // Predicted: [] after the recording modules change; [A] for contract.js; [A] for the tracer source.
    check('P27 a runner update that changes only the code recording inputs keeps every pass; contract, execute or the tracer code reruns',
      recording.selected.length === 0 && judging.selected.join(',') === 'A' && /decision code changed/.test(judging.reasons.A)
      && traceText.includes(opening) && tracing.selected.join(',') === 'A',
      `recording=${recording.selected} judging=${judging.selected} tracing=${tracing.selected}`);
  });

  // D152 review fixes. A broken report chooses its check as before: each check below declares
  // data/, so editing data/two.kv (which no report names) runs it again.
  const runsAsBefore = (name, bodies) => {
    const ids = Object.keys(bodies);
    const scripts = { 'tools/store.py': store, 'data/one.kv': 'one\n', 'data/two.kv': 'two\n' };
    for (const id of ids) scripts[`tools/${id.toLowerCase()}.py`] = pyCheck(id, bodies[id]);
    const dir = project(name, ids.map(id => pyEntry(id)), scripts);
    const first = run(dir, name);
    write(dir, 'data/two.kv', 'two edited\n');
    const after = run(dir, name, ['--changed']);
    const records = ids.map(id => record(dir, id));
    return { ok: first.status === 0 && after.status === 0 && sorted(after) === [...ids].sort().join(',')
      && records.every(rec => rec.kind === 'declared' && typeof rec.reportProblem === 'string'),
    detail: `after=[${after.ran}] ${records.map(rec => `${rec.kind}/${rec.reportProblem}`).join(' | ')}` };
  };
  if (hasPython) attempt('P28 a report whose only line is done is broken', () => {
    const { ok, detail } = runsAsBefore('p28', { DO: 'done()' });
    check('P28 a report whose only line is done is broken', ok, detail);
  });
  if (hasPython) attempt('P29 a report naming a file that is not there, or a field holding the item separator, is broken', () => {
    const { ok, detail } = runsAsBefore('p31', {
      MF: "whole('data/missing.kv')\ndone()",
      NU: "raw('item\\tdata/one.kv\\ta%00b\\tf\\ndone\\n')",
    });
    check('P29 a report naming a file that is not there, or a field holding the item separator, is broken', ok, detail);
  });
  if (hasPython) attempt('P30 a writer name that began more often than it finished makes the report broken', () => {
    const { ok, detail } = runsAsBefore('p34', { BW: "raw('begin\\tw\\nbegin\\tw\\nfile\\tdata/one.kv\\ndone\\tw\\n')" });
    check('P30 a writer name that began more often than it finished makes the report broken', ok, detail);
  });

  // A {cases} entry whose cases each use one whole file. A flag file outside the project named
  // after the run makes the run crash before its done line (.crash), or fail c2 and stop
  // before the cases after it (.stop).
  const wholeCases = pyCheck('K', [
    "CASES = {'c1': 'data/a.kv', 'c2': 'data/b.kv', 'c3': 'data/c.kv'}",
    "flag = lambda kind: os.path.exists(os.path.join(os.environ['POLICY_OUTSIDE'], os.environ['POLICY_NAME'] + kind))",
    'for name in (sys.argv[1:] or sorted(CASES)):',
    "    log('K:' + name)",
    '    whole(CASES[name], name)',
    "    if flag('.crash'): sys.exit(1)",
    "    if flag('.stop') and name == 'c2':",
    "        line('result', name, 'fail')",
    '        done()',
    '        sys.exit(1)',
    "    line('result', name, 'pass')",
    'done()',
  ].join('\n'));
  const casesProject = name => project(name, [{ ...pyEntry('K'), command: { file: PYTHON, args: ['-B', 'tools/k.py', '{cases}'] } }], {
    'tools/store.py': store, 'tools/k.py': wholeCases, 'data/a.kv': 'a\n', 'data/b.kv': 'b\n', 'data/c.kv': 'c\n' });
  const casesRan = r => r.ran.filter(id => id.startsWith('K:')).map(id => id.slice(2)).sort().join(',');
  const outsideFlag = (name, kind, on) => { const file = path.join(outside, `${name}${kind}`); if (on) fs.writeFileSync(file, '1'); else fs.rmSync(file, { force: true }); };

  if (hasPython) attempt('P31 a failing {cases} run whose report does not apply keeps no case results: the next run runs every case', () => {
    const dir = casesProject('p29');
    run(dir, 'p29');
    write(dir, 'data/c.kv', 'c edited\n');
    outsideFlag('p29', '.crash', true);
    const crashed = run(dir, 'p29', ['--changed']);
    outsideFlag('p29', '.crash', false);
    write(dir, 'data/b.kv', 'b edited\n');
    const next = run(dir, 'p29', ['--changed']);
    // Predicted: the crash runs [c3] and fails; the next run runs every case (c3, which failed, included).
    check('P31 a failing {cases} run whose report does not apply keeps no case results: the next run runs every case',
      crashed.status !== 0 && casesRan(crashed) === 'c3' && next.status === 0 && casesRan(next) === 'c1,c2,c3',
      `crashed=${casesRan(crashed)} next=${casesRan(next)} ${show(next)}`);
  });

  if (hasPython) attempt('P32 a failing {cases} run removes no input or case: a case it was to run and did not report runs next', () => {
    const dir = casesProject('p30');
    run(dir, 'p30');
    write(dir, 'data/b.kv', 'b edited\n');
    write(dir, 'data/c.kv', 'c edited\n');
    outsideFlag('p30', '.stop', true);
    const stopped = run(dir, 'p30', ['--changed']);
    outsideFlag('p30', '.stop', false);
    const kept = record(dir, 'K');
    const next = run(dir, 'p30', ['--changed']);
    // Predicted: [c2,c3] asked, c2 fails and c3 is never reached; data/c.kv and case c3 stay in
    // the record (c3 counted as failed); the next run runs c2 and c3, not c1.
    check('P32 a failing {cases} run removes no input or case: a case it was to run and did not report runs next',
      stopped.status !== 0 && casesRan(stopped) === 'c2' && kept.files.includes('data/c.kv') && Boolean(kept.cases && kept.cases.c3)
      && kept.cases.c3.result === 'fail' && next.status === 0 && casesRan(next) === 'c2,c3',
      `stopped=${casesRan(stopped)} cases=${JSON.stringify(kept.cases)} next=${casesRan(next)} ${show(next)}`);
  });

  if (hasPython) attempt('P33 after --changed reuses a check whose item file changed elsewhere, the hooks\' view reuses it too', () => {
    const dir = project('p32', [pyEntry('IA')], {
      'tools/store.py': store, 'tools/identity.py': identity,
      'tools/ia.py': pyCheck('IA', "lookup('data/stock.kv', 'alpha')\ndone()"), 'data/stock.kv': stock(1, 2),
    }, { itemIdentity });
    run(dir, 'p32');
    write(dir, 'data/stock.kv', stock(1, 3));
    const changed = run(dir, 'p32', ['--changed']);
    const launcherDir = path.join(dir, '.crabshell', 'verification');
    const hooks = require(path.join(launcherDir, 'runner', 'project-state.js'));
    const upToDate = hooks.entryUpToDate(dir, launcherDir, 'IA');
    const pending = hooks.pendingChecks(dir, launcherDir);
    // Predicted: --changed runs nothing; the hooks (which never run itemIdentity) agree.
    check('P33 after --changed reuses a check whose item file changed elsewhere, the hooks\' view reuses it too',
      changed.status === 0 && changed.ran.length === 0 && Boolean(upToDate) && Array.isArray(pending) && pending.length === 0,
      `changed=[${changed.ran}] upToDate=${Boolean(upToDate)} pending=${JSON.stringify(pending)}`);
  });

  attempt('P34 the code that builds a check\'s environment and arguments, and recheck.js, rerun every check; the rest of their modules does not', () => {
    const dir = project('p33', [entry('A')], { A: nodeCheck('A', 'src/a.txt') });
    run(dir, 'p33');
    const modules = path.join(dir, '.crabshell', 'verification', 'runner');
    // Each edit is tried alone and undone; selectedAfter gives the checks a --changed run would choose.
    const selectedAfter = (file, edit) => {
      const target = path.join(modules, file);
      const text = fs.readFileSync(target, 'utf8');
      const edited = edit(text);
      if (edited === text) return 'unedited';
      fs.writeFileSync(target, edited);
      try { return dryRun(dir, 'p33').selected.join(','); } finally { fs.writeFileSync(target, text); }
    };
    const inFunction = name => text => text.replace(new RegExp(`(function ${name}\\([^)]*\\) \\{\\n)`), '$1  const releaseMarker = 1;\n');
    const appended = text => `${text}\nmodule.exports.releaseMarker = 1;\n`;
    const environment = selectedAfter('trace.js', inFunction('traceEnvironment'));
    const cases = selectedAfter('used-report.js', inFunction('expandCases'));
    const recheck = selectedAfter('recheck.js', appended);
    const reading = selectedAfter('used-report.js', inFunction('parseIdentity'));
    // Predicted: A, A, A for the three decision parts; nothing for the report reader.
    check('P34 the code that builds a check\'s environment and arguments, and recheck.js, rerun every check; the rest of their modules does not',
      environment === 'A' && cases === 'A' && recheck === 'A' && reading === '',
      `environment=${environment} cases=${cases} recheck=${recheck} reading=${reading}`);
  });
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

if (!hasPython) console.log(`NOTE: ${PYTHON} is not available; P2 (a declared non-Node check) did not run`);
console.log(`runner-policy: ${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed ? 1 : 0);
