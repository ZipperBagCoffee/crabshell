'use strict';
// D175_T001: runner runs that overlap in one project, with no manifest declaration.
// - Two runs that both chose a check: the later one waits for the earlier and reuses its pass,
//   so the check executes once.
// - Two runs that ran different checks: neither loses the other's passes in the record map.
// - Runs that chose different checks never wait for each other.
// - A later run stops waiting after `resourceWaitSeconds` and runs the check itself.
// - A run nested in another (CRABSHELL_RUN_CHAIN) never waits for its ancestor.
// - A record or map lock left by a dead process is ignored and removed; a record folder that
//   cannot be written or a broken record never stops a run.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const REPO = path.resolve(__dirname, '..');
const RUNNER = process.env.CRABSHELL_TEST_RUNNER || path.join(REPO, 'skills', 'verifying', 'scripts', 'run-verify.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-overlap-'));
const outside = path.join(base, 'outside');
fs.mkdirSync(outside);
process.on('exit', () => { try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) {} });
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`); }
};
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// A Node check that reads its input, sleeps OVERLAP_SLEEP_<id> ms (default 1200) and logs its
// start and end (ms) with its pid to a file outside the project, which no check reads.
const nodeCheck = id => [
  "const fs = require('fs'); const path = require('path');",
  `fs.readFileSync(path.join(process.env.PROJECT_ROOT, 'src/${id}.txt'));`,
  `const log = path.join(process.env.OVERLAP_OUTSIDE, path.basename(process.env.PROJECT_ROOT) + '.log');`,
  'const started = Date.now();',
  `const ms = Number(process.env.OVERLAP_SLEEP_${id} || 1200);`,
  'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);',
  `fs.appendFileSync(log, ['${id}', process.pid, started, Date.now()].join(' ') + '\\n');`,
].join('\n') + '\n';

const IDS = ['Q1', 'Q2', 'Q3'];
// entryFields: extra settings per check id (uses, timing, ...).
function project(name, manifestFields = {}, entryFields = {}) {
  const dir = path.join(base, name);
  const entries = IDS.map(id => {
    write(dir, `src/${id}.txt`, `${id}\n`);
    write(dir, `scripts/_check-${id}.js`, nodeCheck(id));
    return { id, type: 'structural', command: { file: 'node', args: [`scripts/_check-${id}.js`] }, contract: { exitCode: 0 }, ...(entryFields[id] || {}) };
  });
  write(dir, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, ...manifestFields, entries }, null, 2));
  copyRunner(RUNNER, path.join(dir, '.crabshell', 'verification'));
  return dir;
}

function start(dir, args = [], extraEnv = {}) {
  const env = { ...process.env, OVERLAP_OUTSIDE: outside, CRABSHELL_VERIFY_JSON: '', ...extraEnv };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING', 'CRABSHELL_RUN_CHAIN', 'CRABSHELL_OVERLAP']) {
    if (!(key in extraEnv)) delete env[key];
  }
  const child = spawn(process.execPath, [path.join(dir, '.crabshell', 'verification', 'run-verify.js'), ...args], { cwd: dir, env, windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise(resolve => child.on('close', status => resolve({ status, stdout, stderr, endedAt: Date.now() })));
  return { child, done };
}
const run = (dir, args, env) => start(dir, args, env).done;
const { DIR_NAME } = require('../skills/verifying/scripts/runner/run-record');
const recordDir = dir => path.join(dir, '.crabshell', 'verification', DIR_NAME);
const records = dir => { try { return fs.readdirSync(recordDir(dir)).filter(name => name.endsWith('.json')); } catch (_) { return []; } };
async function untilRecord(dir, pid) {
  for (let i = 0; i < 200; i++) {
    if (records(dir).includes(`${pid}.json`)) return true;
    await pause(50);
  }
  return false;
}
const logLines = dir => {
  try {
    return fs.readFileSync(path.join(outside, `${path.basename(dir)}.log`), 'utf8').trim().split('\n').filter(Boolean)
      .map(line => { const [id, pid, from, to] = line.split(' '); return { id, pid: Number(pid), from: Number(from), to: Number(to) }; });
  } catch (_) { return []; }
};
const clearLog = dir => fs.rmSync(path.join(outside, `${path.basename(dir)}.log`), { force: true });
const map = dir => JSON.parse(fs.readFileSync(path.join(dir, '.crabshell', 'verification', 'test-map.json'), 'utf8'));
const show = r => `status=${r.status} ${(r.stdout + r.stderr).slice(-500).replace(/\s+/g, ' ')}`;
const dryRun = async dir => JSON.parse((await run(dir, ['--changed', '--dry-run'])).stdout);
const touch = (dir, id) => write(dir, `src/${id}.txt`, `${id} ${Date.now()}\n`);
// A pid no process has: above any pid this system hands out.
const deadPid = () => {
  for (let pid = 4194000; pid < 4194300; pid++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return pid; }
  }
  return 4194303;
};

async function main() {
  // Two runs that chose the same checks: each check executes once, the later run reuses.
  {
    const dir = project('same');
    const first = start(dir, ['--changed']);
    check('first run publishes its record', await untilRecord(dir, first.child.pid));
    const second = start(dir, ['--changed']);
    const [a, b] = await Promise.all([first.done, second.done]);
    check('both runs pass', a.status === 0 && b.status === 0, `${show(a)} | ${show(b)}`);
    const lines = logLines(dir);
    check('each check executed once across the two runs', lines.length === IDS.length && IDS.every(id => lines.filter(line => line.id === id).length === 1),
      JSON.stringify(lines.map(line => `${line.id}:${line.pid}`)));
    check('the later run said it waited', /Waiting for Q\d: run pid \d+/.test(b.stderr), b.stderr.slice(-300));
    const after = await dryRun(dir);
    check('nothing is left to run afterwards', Array.isArray(after.selected) && after.selected.length === 0, JSON.stringify(after.selected));
    check('no run record is left', records(dir).length === 0, records(dir).join(','));
  }

  // Two runs of different checks at once: neither loses the other's pass; neither waits.
  {
    const dir = project('apart');
    const setup = await run(dir, ['--changed']);
    check('setup run passes', setup.status === 0, show(setup));
    touch(dir, 'Q1');
    touch(dir, 'Q2');
    clearLog(dir);
    const first = start(dir, ['Q1'], { OVERLAP_SLEEP_Q1: '2500' });
    await untilRecord(dir, first.child.pid);
    const second = start(dir, ['Q2'], { OVERLAP_SLEEP_Q2: '300' });
    const [a, b] = await Promise.all([first.done, second.done]);
    check('both named runs pass', a.status === 0 && b.status === 0, `${show(a)} | ${show(b)}`);
    const lines = logLines(dir);
    const q1 = lines.find(line => line.id === 'Q1');
    const q2 = lines.find(line => line.id === 'Q2');
    check('runs of different checks do not wait for each other', Boolean(q1 && q2) && q2.to < q1.to, JSON.stringify(lines));
    const after = await dryRun(dir);
    check('both passes are kept in the record map', Array.isArray(after.selected) && after.selected.length === 0, JSON.stringify(after.selected));
    const entries = map(dir).entries;
    check('the map keeps both runs in its run log', Array.isArray(map(dir).runs) && map(dir).runs.length >= 3, JSON.stringify(map(dir).runs));
    check('records of all checks remain', IDS.every(id => entries[id] && Array.isArray(entries[id].passHistory)), Object.keys(entries).join(','));
  }

  // Three runs (review finding 1): B writes the map, C reads it, A merges into it, C writes last.
  // C must keep A's pass: "another run wrote since I read" is told by the map's write id, not
  // by its snapshot time, which A's merge keeps from the earlier map.
  {
    const dir = project('three');
    const setup = await run(dir, ['--changed']);
    check('three: setup run passes', setup.status === 0, show(setup));
    for (const id of IDS) touch(dir, id);
    const a = start(dir, ['Q1'], { OVERLAP_SLEEP_Q1: '3500' });
    await untilRecord(dir, a.child.pid);
    const b = await run(dir, ['Q2'], { OVERLAP_SLEEP_Q2: '100' });
    const c = start(dir, ['Q3'], { OVERLAP_SLEEP_Q3: '4000' });
    const [ra, rc] = await Promise.all([a.done, c.done]);
    check('three: all runs pass, A ends before C', ra.status === 0 && b.status === 0 && rc.status === 0 && ra.endedAt < rc.endedAt, `${show(ra)} | ${show(b)} | ${show(rc)}`);
    const after = await dryRun(dir);
    check('three: no run lost another run\'s pass', Array.isArray(after.selected) && after.selected.length === 0, JSON.stringify(after.selected));
    check('three: the run log keeps all three runs', map(dir).runs.length >= 4, JSON.stringify(map(dir).runs.map(item => item.ran)));
  }

  // D175_T002: declared resources and timing inside the runner.
  {
    const dir = project('kiln', { jobs: 3, resources: { kiln: {} } }, { Q1: { uses: ['kiln'], exclusive: false }, Q2: { uses: ['kiln'], exclusive: false }, Q3: { timing: true } });
    const result = await run(dir, ['--changed']);
    check('kiln: the run passes', result.status === 0, show(result));
    const lines = logLines(dir);
    const span = id => lines.find(line => line.id === id);
    const overlaps = (x, y) => Boolean(x && y) && x.from < y.to && y.from < x.to;
    check('two checks that use one resource take turns within a run', Boolean(span('Q1') && span('Q2')) && !overlaps(span('Q1'), span('Q2')), JSON.stringify(lines));
    check('a timing check runs with nothing beside it', Boolean(span('Q3')) && !overlaps(span('Q3'), span('Q1')) && !overlaps(span('Q3'), span('Q2')), JSON.stringify(lines));
  }
  {
    const dir = project('kiln-runs', { resources: { kiln: {} } }, { Q1: { uses: ['kiln'] }, Q2: { uses: ['kiln'] } });
    const first = start(dir, ['Q1'], { OVERLAP_SLEEP_Q1: '2500' });
    await untilRecord(dir, first.child.pid);
    await pause(400);
    const second = await run(dir, ['Q2'], { OVERLAP_SLEEP_Q2: '100' });
    const a = await first.done;
    const lines = logLines(dir);
    const q1 = lines.find(line => line.id === 'Q1');
    const q2 = lines.find(line => line.id === 'Q2');
    check('a check waits while another run\'s check holds its resource', a.status === 0 && second.status === 0 && Boolean(q1 && q2) && q2.from >= q1.to
      && /Waiting for `kiln` \(held by runner pid \d+ running Q1\) before Q2/.test(second.stderr), `${second.stderr.slice(-300)} ${JSON.stringify(lines)}`);
  }
  {
    const dir = project('kiln-limit', { resources: { kiln: {} }, resourceWaitSeconds: 1 }, { Q1: { uses: ['kiln'] }, Q2: { uses: ['kiln'] }, Q3: { uses: ['kiln'] } });
    const first = start(dir, ['Q1'], { OVERLAP_SLEEP_Q1: '6000' });
    await untilRecord(dir, first.child.pid);
    await pause(400);
    const began = Date.now();
    const second = await run(dir, ['Q2', 'Q3'], { OVERLAP_SLEEP_Q2: '100', OVERLAP_SLEEP_Q3: '100' });
    const tookMs = Date.now() - began;
    await first.done;
    check('past the limit the check fails, naming the holder', second.status !== 0 && /Not run: waited 1s for `kiln` \(held by runner pid \d+ running Q1\)/.test(second.stdout + second.stderr), show(second));
    check('the next check of that resource fails without waiting again', /an earlier check of this run waited 1s for `kiln` and gave up/.test(second.stdout + second.stderr) && tookMs < 5500, `${tookMs}ms ${show(second)}`);
  }

  // A timing check of an earlier run beside a later run that is only waiting for it: the
  // waiting run is not heavy work, so neither waits for the other until the limit.
  {
    const dir = project('timing-wait', { resourceWaitSeconds: 3 }, { Q2: { timing: true } });
    const a = start(dir, ['--changed'], { OVERLAP_SLEEP_Q1: '1500' });
    await untilRecord(dir, a.child.pid);
    const b = start(dir, ['--changed']);
    const [ra, rb] = await Promise.all([a.done, b.done]);
    check('a timing check does not wait for a run that only waits for it', ra.status === 0 && rb.status === 0 && !/Not run/.test(ra.stdout + ra.stderr),
      `${show(ra)} | ${show(rb)}`);
  }

  // A later run stops waiting after resourceWaitSeconds and runs the check itself.
  {
    const dir = project('limit', { resourceWaitSeconds: 1 });
    const first = start(dir, ['Q1'], { OVERLAP_SLEEP_Q1: '5000' });
    await untilRecord(dir, first.child.pid);
    const second = start(dir, ['Q1'], { OVERLAP_SLEEP_Q1: '200' });
    const b = await second.done;
    const a = await first.done;
    check('both runs pass', a.status === 0 && b.status === 0, `${show(a)} | ${show(b)}`);
    check('the later run stops waiting and says so', /Stopped waiting for Q1 after 1s/.test(b.stderr), b.stderr.slice(-300));
    check('it ends before the earlier run', b.endedAt < a.endedAt);
  }

  // A run nested in another (its ancestor chain names it) does not wait for it.
  {
    const dir = project('nested');
    const first = start(dir, ['Q1'], { OVERLAP_SLEEP_Q1: '3000' });
    await untilRecord(dir, first.child.pid);
    const second = start(dir, ['Q1'], { OVERLAP_SLEEP_Q1: '200', CRABSHELL_RUN_CHAIN: String(first.child.pid) });
    const b = await second.done;
    const a = await first.done;
    check('the nested run does not wait for its ancestor', b.endedAt < a.endedAt && !/Waiting for/.test(b.stderr), b.stderr.slice(-300));
  }

  // CRABSHELL_OVERLAP=1: no waiting.
  {
    const dir = project('override');
    const first = start(dir, ['Q1'], { OVERLAP_SLEEP_Q1: '3000' });
    await untilRecord(dir, first.child.pid);
    const second = start(dir, ['Q1'], { OVERLAP_SLEEP_Q1: '200', CRABSHELL_OVERLAP: '1' });
    const b = await second.done;
    const a = await first.done;
    check('CRABSHELL_OVERLAP=1 runs without waiting', b.endedAt < a.endedAt && !/Waiting for/.test(b.stderr), b.stderr.slice(-300));
  }

  // Leftovers of a dead process are ignored and removed; broken state never stops a run.
  {
    const dir = project('stale');
    const pid = deadPid();
    fs.mkdirSync(recordDir(dir), { recursive: true });
    fs.writeFileSync(path.join(recordDir(dir), `${pid}.json`), JSON.stringify({ schema: 1, pid, startedAt: '2000-01-01T00:00:00.000Z', selected: IDS, running: [{ id: 'Q1' }], done: [] }));
    fs.writeFileSync(path.join(recordDir(dir), 'broken.json'), '{ not json');
    fs.writeFileSync(path.join(dir, '.crabshell', 'verification', 'test-map.json.lock'), String(pid));
    const began = Date.now();
    const result = await run(dir, ['--changed']);
    check('a dead run record and lock do not hold the run', result.status === 0 && Date.now() - began < 30000 && !/Waiting for/.test(result.stderr), show(result));
    check('the dead record and the lock are removed', !fs.existsSync(path.join(recordDir(dir), `${pid}.json`))
      && !fs.existsSync(path.join(dir, '.crabshell', 'verification', 'test-map.json.lock')));
    check('the map was written', IDS.every(id => map(dir).entries[id]));
  }
  // A record whose pid another live process took over (its start time differs) is not waited for.
  {
    const dir = project('reused');
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { windowsHide: true, stdio: 'ignore' });
    const otherEnded = new Promise(resolve => other.on('exit', resolve));
    fs.mkdirSync(recordDir(dir), { recursive: true });
    fs.writeFileSync(path.join(recordDir(dir), `${other.pid}.json`), JSON.stringify({ schema: 1, pid: other.pid, processStartedAt: 1000,
      startedAt: '2000-01-01T00:00:00.000Z', selected: IDS, running: [{ id: 'Q1' }], done: [] }));
    const result = await run(dir, ['--changed']);
    other.kill();
    await otherEnded;
    check('a run record left by a process whose pid was reused causes no wait', result.status === 0 && !/Waiting for/.test(result.stderr), show(result));
  }
  {
    const dir = project('unwritable');
    // A file where the record folder would be: nothing can be written there.
    fs.writeFileSync(recordDir(dir), 'not a folder');
    const result = await run(dir, ['--changed']);
    check('a record folder that cannot be written does not stop the run', result.status === 0, show(result));
  }

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => { console.log(`FAIL: test crashed -- ${error.stack}`); process.exit(1); });
