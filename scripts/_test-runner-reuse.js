'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');
const { source, root, report, check, write, readJson, entry, fixture, mapFile, resultFile, manifestFile, counter, run, dry, updateManifest, git, manifestRelative } = require('./testlib/runner-project').createRunnerProject('runner-reuse');
const api = require(source);
const { SCHEMA_VERSION } = require('../skills/verifying/scripts/runner/fingerprint');

// Inspect private helpers without adding a test API to the portable runner: the
// runner's modules (runner/ beside the launcher) are loaded into a fresh context whose
// built-in modules, process and console can be replaced. path.win32 exercises
// extended-path handling on every host, not just Windows.
function internals(overrides = {}) {
  const runnerDir = path.join(path.dirname(source), 'runner');
  const loaded = new Map();
  const load = file => {
    if (loaded.has(file)) return loaded.get(file).exports;
    const mod = { exports: {} };
    loaded.set(file, mod);
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      module: mod, exports: mod.exports, __filename: file, __dirname: path.dirname(file),
      require: name => (name.startsWith('./') || name.startsWith('../'))
        ? load(require.resolve(path.resolve(path.dirname(file), name)))
        : Object.hasOwn(overrides, name) ? overrides[name] : require(name),
      process: overrides.process || { ...process, env: { ...process.env, CRABSHELL_VERIFY_JSON: '' } },
      console: overrides.console || console, Buffer,
    }, { filename: file });
    return mod.exports;
  };
  const { printResults } = load(path.join(runnerDir, 'output.js'));
  // The launcher writes last-run.json beside itself; overrides.dirname stands for that folder.
  const resultsPath = path.join(overrides.dirname || path.dirname(source), 'last-run.json');
  return {
    entryFingerprint: load(path.join(runnerDir, 'fingerprint.js')).entryFingerprint,
    readTrace: load(path.join(runnerDir, 'trace.js')).readTrace,
    printResults: (results, options) => printResults(results, { resultsPath, ...options }),
  };
}

check('runner accepts reuse and JSON switches', () => {
  const args = api.parseArgs(['--json', '--no-reuse']);
  assert.equal(args.error, null); assert.equal(args.json, true); assert.equal(args.reuse, false);
});

const main = fixture('main');
const first = run(main);
const second = run(main);
check('unchanged second run reuses PASS without executing', () => {
  assert.equal(first.status, 0); assert.equal(second.status, 0);
  assert.equal(second.results[0].status, 'PASS'); assert.equal(second.results[0].reused, true);
  assert.equal(second.results[0].durationMs, 0); assert.equal(counter(main), 1);
});
check('run duration and pass key persist without replacing duration on reuse', () => {
  const record = readJson(mapFile(main)).entries.A;
  assert(first.results[0].durationMs > 0);
  assert.equal(record.lastDurationMs, first.results[0].durationMs);
  assert.match(record.passHistory[0], /^[a-f0-9]{64}$/);
  assert(Number.isFinite(Date.parse(record.passedAt)));
});
check('default stdout is summary only and full array is written beside runner', () => {
  assert.match(second.stdout, /^PASS — 1 of 1 checks \(reused 1 unchanged since they passed\), [\d.]+s\r?\n/);
  assert(!/^\[/m.test(second.stdout));
  assert.match(second.stdout, /Verification Results: PASS: 1 \/ FAIL: 0 \/ Manual: 0 \/ Total: 1/);
  assert(second.stdout.trimEnd().endsWith(`Full results: ${resultFile(main)}`));
  assert.deepEqual(readJson(resultFile(main)), second.results);
});
check('environment JSON mode prints current results and preserves the previous file byte for byte', () => {
  const previous = '[ { "id": "PERSON", "status": "PASS" } ]\n';
  fs.writeFileSync(resultFile(main), previous);
  const result = run(main, [], { CRABSHELL_VERIFY_JSON: '1' });
  assert.match(result.stdout, /^\[/); assert(result.stdout.indexOf(']') < result.stdout.indexOf('PASS —'));
  assert.equal(fs.readFileSync(resultFile(main), 'utf8'), previous);
  assert(!result.stdout.includes('Full results:'));
});
check('--json prints the array too', () => {
  const result = run(main, ['--json']); assert.equal(result.status, 0); assert.match(result.stdout, /^\[/);
});
// Each case starts from its own fixture: a pass is reused for any input state it has
// passed on before (D143_T009 pass history), so only a state never seen must run.
for (const [name, mutate, prepare] of [
  ['recorded byte', dir => write(dir, 'input.data', 'b')],
  ['test byte', dir => fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), '\n')],
  ['manifest entry', dir => updateManifest(dir, m => { m.entries[0].timeout += 1; })],
  // D143_T009 (approved contract change): the runner modules that decide results count;
  // the launcher only finds them.
  // D143_T020: a code line of a deciding module; comment and blank lines do not count.
  ['deciding runner module code line', dir => fs.appendFileSync(path.join(dir, '.crabshell/verification/runner/execute.js'), '\nmodule.exports.reuseMarker = 1;\n')],
  ['folder entry added', dir => write(dir, 'notes/second', 'two')],
  ['folder entry removed', dir => fs.unlinkSync(path.join(dir, 'notes/second')), dir => write(dir, 'notes/second', 'two')],
  ['previously missing input created', dir => write(dir, 'optional.data', 'present'), dir => fs.unlinkSync(path.join(dir, 'optional.data'))],
  ['recorded input deleted', dir => fs.unlinkSync(path.join(dir, 'optional.data'))],
]) check(`${name} invalidates the cached pass`, () => {
  const dir = fixture(`invalidate-${name.replace(/ /g, '-')}`);
  if (prepare) prepare(dir);
  run(dir);
  const before = counter(dir); mutate(dir);
  const result = run(dir); const reused = run(dir);
  assert.equal(result.status, 0); assert.notEqual(result.results[0].reused, true); assert.equal(counter(dir), before + 1);
  assert.equal(reused.results[0].reused, true);
});
check('a launcher edit or a return to an input state that passed before reuses the pass', () => {
  const dir = fixture('reuse-history');
  run(dir);
  const before = counter(dir);
  fs.appendFileSync(path.join(dir, '.crabshell/verification/run-verify.js'), '\n');
  const launcher = run(dir);
  write(dir, 'input.data', 'b'); run(dir);
  write(dir, 'input.data', 'a');
  const back = run(dir);
  assert.equal(launcher.results[0].reused, true); assert.equal(back.results[0].reused, true); assert.equal(counter(dir), before + 1);
});
check('manifest property order does not invalidate a pass', () => {
  const before = counter(main);
  updateManifest(main, m => { m.entries[0] = Object.fromEntries(Object.entries(m.entries[0]).reverse()); });
  const result = run(main); assert.equal(result.results[0].reused, true); assert.equal(counter(main), before);
});
check('failure clears pass key and must execute on the next run', () => {
  const failure = run(main, ['--no-reuse'], { FIXTURE_FAIL: '1' });
  assert.equal(failure.status, 1); assert.equal(failure.results[0].status, 'FAIL');
  assert(Number.isFinite(Date.parse(readJson(mapFile(main)).entries.A.lastFailedAt)));
  const before = counter(main); const next = run(main);
  assert.equal(next.status, 0); assert.notEqual(next.results[0].reused, true); assert.equal(counter(main), before + 1);
});
check('timeout clears pass key and preserves the previous execution duration', () => {
  const originalTimeout = readJson(manifestFile(main)).entries[0].timeout;
  run(main);
  const previousDuration = readJson(mapFile(main)).entries.A.lastDurationMs;
  updateManifest(main, m => { m.entries[0].timeout = 200; });
  const timeout = run(main, ['--no-reuse'], { FIXTURE_HANG: '1' });
  assert.equal(timeout.status, 1); assert.match(timeout.results[0].error, /ETIMEDOUT/);
  assert.equal(timeout.results[0].timedOut, true);
  assert.equal(readJson(mapFile(main)).entries.A.lastDurationMs, previousDuration);
  assert(timeout.results[0].durationMs >= 150); assert(readJson(mapFile(main)).entries.A.lastFailedAt);
  updateManifest(main, m => { m.entries[0].timeout = originalTimeout; });
  const next = run(main); assert.equal(next.status, 0); assert.notEqual(next.results[0].reused, true);
});
check('first timeout has no duration estimate or pass key', () => {
  const dir = fixture('first-timeout', [entry('A', { timeout: 200 })]);
  const result = run(dir, [], { FIXTURE_HANG: '1' });
  assert.equal(result.status, 1); assert.equal(result.results[0].timedOut, true);
  const record = readJson(mapFile(dir)).entries.A;
  assert(!Object.hasOwn(record, 'lastDurationMs')); assert(!record.passHistory); assert(!record.passedAt);
  assert(Number.isFinite(Date.parse(record.lastFailedAt)));
});
const forbidden = fixture('forbidden', [entry('A'), entry('B', { reuse: false })]);
run(forbidden);
check('reuse:false runs each time while other entries reuse', () => {
  const before = counter(forbidden, 'B'); const result = run(forbidden);
  assert.equal(result.results[0].reused, true); assert.notEqual(result.results[1].reused, true);
  assert.equal(counter(forbidden, 'B'), before + 1);
});
check('--no-reuse executes all selected checks', () => {
  const before = ['A', 'B'].map(id => counter(forbidden, id)); const result = run(forbidden, ['--no-reuse']);
  assert.equal(result.status, 0); assert(result.results.every(item => item.reused !== true));
  assert.deepEqual(['A', 'B'].map(id => counter(forbidden, id)), before.map(n => n + 1));
});
check('dry-run gives path reasons, reuse count and duration estimate without executing', () => {
  const map = readJson(mapFile(forbidden)); map.entries.A.lastDurationMs = 1250; map.entries.B.lastDurationMs = 2350;
  fs.writeFileSync(mapFile(forbidden), JSON.stringify(map));
  const before = counter(forbidden); const plan = dry(forbidden, 'input.data');
  assert.equal(plan.full, true); assert.equal(plan.reasons.A, 'input.data changed'); assert.equal(plan.reasons.B, 'reuse:false');
  assert.equal(plan.wouldReuse, 0); assert.equal(plan.estimatedSeconds, 3.6); assert.equal(counter(forbidden), before);
  const quiet = dry(forbidden);
  assert.deepEqual(quiet.selected, ['B']); assert.equal(quiet.wouldReuse, 1); assert.equal(quiet.estimatedSeconds, 2.4);
  const noReuse = dry(forbidden, null, ['--no-reuse']);
  assert.equal(noReuse.wouldReuse, 0); assert.equal(noReuse.estimatedSeconds, 3.6);
  assert.equal(dry(forbidden, 'notes/new').reasons.A, 'notes/ changed');
});
check('dry-run and --explain estimate the run length with the runner\'s own side-by-side rule', () => {
  const times = { A: 1000, B: 2000, C: 500 };
  const dir = fixture('wall', [entry('A', { exclusive: false }), entry('B', { exclusive: false }), entry('C', { exclusive: true })]);
  run(dir);
  const map = readJson(mapFile(dir));
  for (const [id, ms] of Object.entries(times)) map.entries[id].lastDurationMs = ms;
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  // How many checks this machine's run starts at once comes from the runner's own schedule.
  const { concurrencyLimit, defaultJobs } = require(path.join(path.dirname(source), 'runner', 'schedule.js'));
  const limit = defaultJobs() > 1 ? concurrencyLimit(defaultJobs()) : 1;
  // A and B share lanes, C runs alone after them; with one lane every time adds up.
  const sum = (times.A + times.B + times.C) / 1000;
  const wall = limit > 1 ? (Math.max(times.A, times.B) + times.C) / 1000 : sum;
  const plan = dry(dir, 'input.data');
  assert.deepEqual(plan.selected.sort(), ['A', 'B', 'C']);
  assert.equal(plan.estimatedSeconds, sum); assert.equal(plan.estimatedWallSeconds, wall);
  const file = path.join(dir, 'input.data'); const before = fs.readFileSync(file);
  fs.appendFileSync(file, '\n');
  try {
    // The estimate line gives the run's length, how many checks run at once and the sum, in that order.
    const first = run(dir, ['--explain']).stdout.split(/\r?\n/)[0];
    assert(first.startsWith('Estimated'), first);
    assert.deepEqual((first.match(/\d+(\.\d+)?/g) || []).map(Number), limit > 1 ? [wall, limit, sum] : [sum]);
  } finally { fs.writeFileSync(file, before); }
});
check('full dry-run explains each selection', () => {
  const dir = fixture('no-map'); const plan = dry(dir);
  assert.equal(plan.reasons.A, 'new check'); assert.equal(plan.reason, '1 new'); assert.equal(plan.estimatedSeconds, 0); assert.equal(plan.wouldReuse, 0);
});
check('dry-run explains always, a record that names no file (unknown inputs), and new check selections', () => {
  const dir = fixture('selection-reasons', [entry('A', { always: true }), entry('B')]); run(dir);
  const map = readJson(mapFile(dir));
  map.entries.B.files = [];
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  const plan = dry(dir, 'unread.md');
  assert.equal(plan.reasons.A, 'always'); assert.match(plan.reasons.B, /unknown inputs/);
  delete map.entries.B;
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  assert.equal(dry(dir, 'unread.md').reasons.B, 'new check');
});
check('explicit entry id always executes and records its new duration', () => {
  const dir = fixture('target'); const first = run(dir, ['A']); const second = run(dir, ['A']);
  assert.equal(first.status, 0); assert.equal(second.status, 0);
  assert.notEqual(second.results[0].reused, true); assert.equal(counter(dir), 2);
  assert.equal(readJson(mapFile(dir)).entries.A.lastDurationMs, second.results[0].durationMs);
});
check('discovered entries inherit reuse:false', () => {
  const dir = fixture('discovered', [entry('A'), entry('B')]);
  updateManifest(dir, m => { m.entries = [{ id: 'D', type: 'structural', reuse: false, reuseExclude: ['scripts/_test-B.js'], discover: { pattern: 'scripts/_test-*.js' }, contract: { exitCode: 0 } }]; });
  run(dir); const result = run(dir);
  assert.equal(result.status, 0); assert.equal(result.results.length, 2);
  assert(result.results.every(item => item.reused !== true));
  assert.deepEqual(['A', 'B'].map(id => counter(dir, id)), [2, 2]);
  assert.equal(dry(dir).wouldReuse, 0);
});
for (const [name, args] of [['full', []], ['changed', ['--changed']]]) {
  check(`discovery reuseExclude reruns only the excluded file on an unchanged second ${name} run`, () => {
    const dir = fixture(`discovered-exclusion-${name}`, [entry('A'), entry('B')]);
    updateManifest(dir, m => { m.entries = [{ id: 'D', type: 'structural', reuseExclude: ['scripts/_test-B.js'], discover: { pattern: 'scripts/_test-*.js' }, contract: { exitCode: 0 } }]; });
    const first = run(dir, args);
    assert.equal(first.status, 0); assert.equal(first.results.length, 2);
    assert(first.results.every(item => item.status === 'PASS' && item.reused !== true));
    assert.deepEqual(['A', 'B'].map(id => counter(dir, id)), [1, 1]);
    const second = run(dir, args);
    // A --changed run lists only the checks it runs; a full run lists every check.
    assert.equal(second.status, 0); assert.equal(second.results.length, name === 'full' ? 2 : 1);
    assert(second.results.every(item => item.status === 'PASS'));
    if (name === 'full') assert.equal(second.results.find(item => item.id === 'D:scripts/_test-A.js').reused, true);
    assert.notEqual(second.results.find(item => item.id === 'D:scripts/_test-B.js').reused, true);
    assert.deepEqual(['A', 'B'].map(id => counter(dir, id)), [1, 2]);
    assert.equal(dry(dir).wouldReuse, 1);
  });
}
for (const partial of [false, true]) check(`mixed ${partial ? 'partial' : 'full'} failure refreshes passing inputs and reuses that PASS next time`, () => {
  const dir = fixture(`mixed-${partial}`, [entry('A'), entry('B')]);
  write(dir, 'extra.data', 'newly read after input changes');
  fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), "\nif (fs.readFileSync('input.data', 'utf8') === 'z') fs.readFileSync('extra.data');\n");
  assert.equal(run(dir).status, 0);
  const before = readJson(mapFile(dir));
  assert(!before.entries.A.files.includes('extra.data'));
  const testB = path.join(dir, 'scripts/_test-B.js');
  fs.appendFileSync(testB, '\nprocess.exit(1);\n');
  write(dir, 'input.data', 'z');
  // D143: --changed runs the faster check first. D170: the run goes on after a failure, so the
  // recorded times are fixed here to run the failing B before the passing A — A's pass, after
  // B failed, must still be recorded.
  if (partial) {
    const map = readJson(mapFile(dir));
    map.entries.A.lastDurationMs = 60000; map.entries.B.lastDurationMs = 1;
    map.entries.A.durations = [60000]; map.entries.B.durations = [1]; // D143_T011: order by median pass time
    fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  }
  const args = partial ? ['--changed', '--no-fail-before'] : [];
  const failure = run(dir, args); const after = readJson(mapFile(dir));
  assert.equal(failure.status, 1); assert(after.entries.A.passHistory[0]); assert.notEqual(after.entries.A.passHistory[0], before.entries.A.passHistory[0]);
  assert(after.entries.A.files.includes('extra.data')); assert(after.entries.A.inputHashes['extra.data']);
  assert.notEqual(after.entries.A.inputHashes['input.data'], before.entries.A.inputHashes['input.data']);
  assert.equal(after.entries.B.passedAt, before.entries.B.passedAt);
  assert.deepEqual(after.entries.B.files, before.entries.B.files);
  assert(Number.isFinite(Date.parse(after.entries.B.lastFailedAt)));
  assert.match(failure.stderr, /1 failed: B — after the fix, rerun only these: node \S+ --failed; once they pass, run --changed once\./);
  const countA = counter(dir); const countB = counter(dir, 'B'); const next = run(dir);
  assert.equal(next.results[0].reused, true); assert.equal(counter(dir), countA); assert.equal(counter(dir, 'B'), countB + 1);
});
check('first failed full run records the passing check and the failed check\'s inputs', () => {
  const dir = fixture('first-failure', [entry('A'), entry('B')]);
  fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), '\nprocess.exit(1);\n');
  const result = run(dir); const map = readJson(mapFile(dir));
  assert.equal(result.status, 1); assert(map.entries.A.passHistory[0]); assert(map.entries.A.files.includes('input.data'));
  assert(map.entries.B.files.includes('scripts/_test-B.js')); assert(!map.entries.B.passHistory);
  assert.equal(map.schema, SCHEMA_VERSION);
  const plan = dry(dir, 'unread.md');
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, ['B']);
  assert.equal(plan.reasons.B, 'failed in the last run');
  assert(!plan.reason.includes('load map has no manifest record'));
  const next = run(dir); assert.equal(next.results[0].reused, true);
});
check('failed output shows first FAIL and only the last five stderr lines', () => {
  const dir = fixture('failure-output'); const result = run(dir, [], { FIXTURE_FAIL: '1' });
  assert.match(result.stdout, /^FAIL — 1 of 1 checks failed \(ran 1\), [\d.]+s/);
  assert.match(result.stdout, /FAIL A: FAIL deliberate fixture failure/);
  assert(!result.stdout.includes('FAIL later failure')); assert(!result.stdout.includes('detail 2'));
  for (let i = 3; i <= 7; i++) assert(result.stdout.includes(`  detail ${i}`));
  assert(result.stdout.includes('Failure Categories:')); assert.deepEqual(readJson(resultFile(dir)), result.results);
  console.log('FAILING FIXTURE STDOUT\n' + result.stdout + 'END FAILING FIXTURE STDOUT');
});
check('argument errors also write full results and compact failure summary', () => {
  const dir = fixture('error-output'); const result = run(dir, ['--unknown']);
  assert.equal(result.status, 1); assert.match(result.stdout, /^FAIL —/);
  assert.match(result.stdout, /FAIL RUNNER_ARGS: Unknown flag/); assert.deepEqual(readJson(resultFile(dir)), result.results);
});

for (const mixedFailure of [false, true]) check(`input edited during its check stores no key (${mixedFailure ? 'mixed failure' : 'all pass'})`, () => {
  const dir = fixture(`during-check-${mixedFailure}`, mixedFailure ? [entry('A'), entry('B')] : [entry('A')]);
  assert.equal(run(dir).status, 0);
  const firstPass = readJson(mapFile(dir)).entries.A;
  assert(firstPass.passHistory[0]);
  if (mixedFailure) fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), '\nprocess.exit(1);\n');
  const mutated = run(dir, ['--no-reuse'], { FIXTURE_MUTATE: 'A' });
  assert.equal(mutated.status, mixedFailure ? 1 : 0);
  assert.equal(mutated.results[0].status, 'PASS');
  const record = readJson(mapFile(dir)).entries.A;
  assert.deepEqual(record.passHistory, firstPass.passHistory); assert.equal(record.passedAt, firstPass.passedAt);
  const before = counter(dir);
  const next = run(dir);
  assert.notEqual(next.results[0].reused, true); assert.equal(counter(dir), before + 1);
});
check('newly traced input written during the first check stores no key', () => {
  const dir = fixture('new-input-edited');
  const result = run(dir, [], { FIXTURE_MUTATE: 'A' });
  assert.equal(result.status, 0); assert(!readJson(mapFile(dir)).entries.A.passHistory);
  const next = run(dir);
  assert.notEqual(next.results[0].reused, true); assert.equal(counter(dir), 2);
});
check('later check edits cannot give an earlier pass a key for untested content', () => {
  const dir = fixture('later-check-edit', [entry('A'), entry('B')]); run(dir);
  const before = readJson(mapFile(dir)).entries.A;
  assert(before.passHistory[0]);
  assert.equal(run(dir, ['--no-reuse'], { FIXTURE_MUTATE: 'B' }).status, 0);
  const after = readJson(mapFile(dir));
  assert.deepEqual(after.entries.A.passHistory, before.passHistory); assert.equal(after.entries.A.passedAt, before.passedAt);
  assert.equal(after.entries.B.passHistory.length, 1);
  const count = counter(dir); const next = run(dir);
  assert.notEqual(next.results[0].reused, true); assert.equal(counter(dir), count + 1);
});

// D143_T009: no file name, stale map or missing git makes checks run; only their own
// inputs do. A file no check reads, a package.json and an unchanged tree run nothing.
for (const [name, prepare] of [
  ['unknown file', dir => write(dir, 'unknown.js', 'module.exports = 0;\n')],
  ['package.json', dir => write(dir, 'package.json', '{"name":"fixture"}\n')],
  ['nothing changed (no git)', () => {}],
]) check(`checks whose inputs did not change are not selected: ${name}`, () => {
  const dir = fixture(`fallback-${name.replace(/[^a-z]+/gi, '-')}`, [entry('A'), entry('B')]); run(dir);
  prepare(dir);
  const plan = JSON.parse(run(dir, ['--changed', '--dry-run']).stdout);
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, []); assert.equal(plan.wouldReuse, 2);
  const result = run(dir, ['--changed']);
  assert.equal(result.status, 0); assert.deepEqual(result.results, []);
  assert.deepEqual(['A', 'B'].map(id => counter(dir, id)), [1, 1]);
});

for (const [label, project, absolute] of [
  ['drive', 'C:\\repo', '\\\\?\\C:\\repo\\input.data'],
  ['UNC', '\\\\server\\share\\repo', '\\\\?\\UNC\\server\\share\\repo\\input.data'],
]) check(`tracer records an extended ${label} path relative to the project`, () => {
  const traced = internals({ path: path.win32, fs: {
    existsSync: () => true,
    readFileSync: () => JSON.stringify([absolute]) + '\n',
    statSync: () => ({ isFile: () => true }),
  } }).readTrace('trace.jsonl', project);
  assert.deepEqual([...traced], ['input.data']);
});

check('always:true executes even with an unchanged cached pass', () => {
  const dir = fixture('always', [entry('A', { always: true }), entry('B')]); run(dir);
  const result = run(dir);
  assert.equal(result.status, 0); assert.notEqual(result.results[0].reused, true);
  assert.equal(result.results[1].reused, true); assert.deepEqual(['A', 'B'].map(id => counter(dir, id)), [2, 1]);
});
check('a check that reads no project file uses the whole project as inputs and is not reused while it writes into it', () => {
  const item = entry('A', { command: { file: 'node', args: ['-e', "require('fs').appendFileSync('node_modules/counters/A', 'x')"] } });
  const dir = fixture('empty-inputs', [item]); run(dir);
  const record = readJson(mapFile(dir)).entries.A;
  assert.deepEqual(record.files, []); assert.equal(record.kind, 'project'); assert(!record.passHistory);
  const next = run(dir); assert.notEqual(next.results[0].reused, true); assert.equal(counter(dir), 2);
});
check('a pass does not expire: an old pass is reused while its inputs are unchanged', () => {
  const dir = fixture('expired'); run(dir);
  const map = readJson(mapFile(dir));
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  map.entries.A.passedAt = old;
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  const next = run(dir); assert.equal(next.results[0].reused, true); assert.equal(counter(dir), 1);
  assert.equal(readJson(mapFile(dir)).entries.A.passedAt, old, 'reuse does not rewrite the pass time');
});
check('platform and architecture each change the fingerprint', () => {
  const key = (platform, arch) => internals({ process: { ...process, platform, arch } })
    .entryFingerprint({ entry: entry('A'), files: ['input.data'], identityOf: () => 'content', program: 'node', decision: 'runner' });
  const original = key(process.platform, process.arch);
  assert(original); assert.equal(original, key(process.platform, process.arch));
  assert.notEqual(original, key('another-platform', process.arch));
  assert.notEqual(original, key(process.platform, 'another-architecture'));
});

for (const failAt of [null, 'write', 'rename']) check(`full results are ${failAt ? `reported as not saved when ${failAt} fails` : 'replaced by a same-folder rename'}`, () => {
  const dir = fixture(`atomic-results-${failAt}`); const target = resultFile(dir);
  const previous = [{ id: 'PREVIOUS', status: 'PASS' }];
  const results = [{ id: 'CURRENT', status: 'PASS' }];
  fs.writeFileSync(target, JSON.stringify(previous));
  const lines = []; let renames = 0;
  const wrappedFs = Object.create(fs);
  wrappedFs.writeFileSync = (...args) => {
    if (failAt === 'write') throw new Error('fixture write denied');
    return fs.writeFileSync(...args);
  };
  wrappedFs.renameSync = (from, to) => {
    renames++;
    assert.equal(to, target); assert.notEqual(from, target); assert.equal(path.dirname(from), path.dirname(target));
    assert.deepEqual(readJson(target), previous, 'old complete results survive until rename');
    assert.deepEqual(readJson(from), results, 'temporary results must be complete');
    if (failAt === 'rename') throw new Error('fixture rename denied');
    fs.renameSync(from, to);
  };
  const runner = internals({ dirname: path.dirname(target), fs: wrappedFs,
    console: { log: line => lines.push(line), error: line => lines.push(line) } });
  assert.equal(runner.printResults(results, { args: { failBefore: true }, started: process.hrtime.bigint() }), 0);
  assert.equal(renames, failAt === 'write' ? 0 : 1);
  assert.deepEqual(readJson(target), failAt ? previous : results);
  assert.equal(lines.at(-1), failAt ? `Full results: not saved (fixture ${failAt} denied)` : `Full results: ${target}`);
  assert(!fs.readdirSync(path.dirname(target)).some(file => file.endsWith('.tmp')));
});
check('manual entry waits for a person and is neither ran nor passed', () => {
  const dir = fixture('manual', [{ id: 'PERSON', type: 'manual' }]);
  const result = run(dir, ['PERSON']);
  assert.equal(result.status, 0); assert.equal(result.results[0].status, 'manual');
  assert.match(result.stdout, /^PASS — 0 of 1 checks \(1 manual check waiting for a person\), [\d.]+s/);
  assert(!/ran \d|reused \d/.test(result.stdout));
});
check('mixed verdict counts executed and reused passes separately from manual checks', () => {
  const dir = fixture('mixed-counts'); const lines = [];
  internals({ dirname: path.dirname(resultFile(dir)), console: { log: line => lines.push(line), error: () => {} } }).printResults([
    { id: 'A', status: 'PASS' }, { id: 'B', status: 'PASS' },
    { id: 'C', status: 'PASS', reused: true }, { id: 'PERSON', status: 'manual' },
  ], { args: { failBefore: true }, started: process.hrtime.bigint(), plan: { total: 5, reason: 'fixture' } });
  assert.match(lines[0], /^PASS — 3 of 5 checks \(ran 2, reused 1 unchanged since they passed, 1 manual check waiting for a person\), [\d.]+s$/);
});
check('empty selection says no checks selected and exits successfully', () => {
  const dir = fixture('empty-selection'); run(dir);
  const previous = fs.readFileSync(resultFile(dir));
  const before = counter(dir); const result = run(dir, ['--changed']);
  assert.equal(result.status, 0); assert.deepEqual(result.results, []); assert.equal(counter(dir), before);
  assert(fs.readFileSync(resultFile(dir)).equals(previous));
  assert(!result.stdout.includes('Full results:'));
  // The message's wording is not pinned (D151_T005); the run said something and reported no checks.
  assert(result.stdout.trim().length > 0);
  assert(!result.stdout.includes('PASS —'));
});

for (const [name, args, env, prepare] of [
  ['legacy guard', ['--no-fail-before'], {}],
  ['ticket guard', ['--changed', '--no-fail-before'], { CRABSHELL_VERIFY_JSON: '1' }, dir => write(dir, 'input.data', 'edited for the guard run')],
]) check(`${name} leaves saved results byte-identical without a Full results line`, () => {
  const dir = fixture(`saved-${name.replace(/ /g, '-')}`);
  assert.equal(run(dir).status, 0);
  const previous = fs.readFileSync(resultFile(dir));
  if (prepare) prepare(dir);
  const result = run(dir, args, env);
  assert.equal(result.status, 0); assert.equal(result.results[0].status, 'PASS');
  assert(fs.readFileSync(resultFile(dir)).equals(previous));
  assert(!result.stdout.includes('Full results:'));
});
check('person full, changed, JSON and explicit-id runs replace the preserved file', () => {
  const dir = fixture('person-results');
  const previous = '[ { "id": "PERSON", "status": "PASS" } ]\n';
  for (const args of [[], ['--changed'], ['--json'], ['A']]) {
    fs.writeFileSync(resultFile(dir), previous);
    // Establish that an internal call leaves these exact bytes for the person.
    assert.equal(run(dir, ['--no-fail-before']).status, 0);
    assert.equal(fs.readFileSync(resultFile(dir), 'utf8'), previous);
    // A --changed run needs a changed input to run (and save) anything.
    if (args[0] === '--changed') write(dir, 'input.data', `edited ${Date.now()}`);
    const result = run(dir, args);
    assert.equal(result.status, 0); assert.match(result.stdout, /Full results: /);
    assert.notEqual(fs.readFileSync(resultFile(dir), 'utf8'), previous);
    assert.deepEqual(readJson(resultFile(dir)), result.results);
  }
});

console.log('PASSING FIXTURE STDOUT\n' + second.stdout + 'END PASSING FIXTURE STDOUT');
report.finish();
