'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');
const source = process.env.CRABSHELL_TEST_RUNNER || path.join(__dirname, '..', 'skills', 'verifying', 'scripts', 'run-verify.js');
const api = require(source);
const { copyRunner } = require('../skills/verifying/scripts/runner/install');
const root = h.makeWorkRoot('runner-reuse');
const report = h.createReporter('runner-reuse');
const check = (name, fn) => {
  try { fn(); report.check(name, true); }
  catch (error) { report.check(name, false, error.message); }
};
const write = (dir, file, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
};
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } };
const entry = (id, extra = {}) => ({ id, type: 'structural', command: { file: 'node', args: [`scripts/_test-${id}.js`] }, contract: { exitCode: 0 }, timeout: 3000, ...extra });
function fixture(name, entries = [entry('A')]) {
  const dir = path.join(root, name);
  write(dir, '.gitignore', '.crabshell/\ncounter*\n');
  write(dir, 'input.data', 'a');
  write(dir, 'optional.data', 'present');
  write(dir, 'notes/first', 'one');
  fs.mkdirSync(path.join(dir, 'node_modules', 'counters'), { recursive: true });
  for (const item of entries) write(dir, `scripts/_test-${item.id}.js`, [
    "const fs = require('fs');",
    // Execution counters are outputs, not inputs; keep them outside the tracer.
    "fs.mkdirSync('node_modules/counters', { recursive: true });",
    `fs.appendFileSync('node_modules/counters/${item.id}', 'x');`,
    "fs.readFileSync('input.data');",
    `if (process.env.FIXTURE_MUTATE === '${item.id}') fs.appendFileSync('input.data', 'changed during check');`,
    "fs.readdirSync('notes');",
    "fs.existsSync('optional.data');",
    "if (process.env.FIXTURE_HANG === '1') setInterval(() => {}, 1000);",
    "if (process.env.FIXTURE_FAIL === '1') { console.log('noise'); console.log('FAIL deliberate fixture failure'); console.log('FAIL later failure'); for (let i=1;i<=7;i++) console.error('detail '+i); process.exit(1); }",
    "console.log('PASS fixture');",
  ].join('\n'));
  write(dir, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries }));
  copyRunner(source, path.join(dir, '.crabshell/verification'));
  return dir;
}
const mapFile = dir => path.join(dir, '.crabshell/verification/test-map.json');
const resultFile = dir => path.join(dir, '.crabshell/verification/last-run.json');
const manifestFile = dir => path.join(dir, '.crabshell/verification/manifest.json');
const counter = (dir, id = 'A') => { try { return fs.readFileSync(path.join(dir, 'node_modules', 'counters', id), 'utf8').length; } catch (_) { return 0; } };
function run(dir, args = [], extraEnv = {}) {
  const env = { ...process.env, PROJECT_ROOT: dir, CRABSHELL_VERIFY_JSON: '', ...extraEnv };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CRABSHELL_VERIFY_RUNNING;
  const result = spawnSync(process.execPath, [path.join(dir, '.crabshell/verification/run-verify.js'), ...args], {
    cwd: dir, env, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  if (result.error) throw result.error;
  // Reading old stdout too lets every assertion run against the HEAD runner.
  const match = (result.stdout || '').match(/^\[\]$|^\[\r?\n[\s\S]*?\r?\n\]$/m);
  return { ...result, results: match ? JSON.parse(match[0])
    : result.stdout.startsWith('No checks selected') ? [] : readJson(resultFile(dir)) || [] };
}
// D143_T009: checks are chosen by the content of their inputs, so a change is a real
// edit. Each listed file (comma-separated) gets one more line, or is created when it
// does not exist, for the dry run; afterwards its bytes are put back (or it is removed).
const dry = (dir, files = null, args = []) => {
  const undo = [];
  for (const rel of (files ? files.split(',') : []).filter(Boolean)) {
    const file = path.join(dir, rel);
    if (fs.existsSync(file)) { undo.push([file, fs.readFileSync(file)]); fs.appendFileSync(file, '\n'); }
    else { undo.push([file, null]); write(dir, rel, 'new\n'); }
  }
  try {
    const result = run(dir, ['--changed', '--dry-run', ...args]);
    return JSON.parse(result.stdout);
  } finally {
    for (const [file, bytes] of undo) { if (bytes) fs.writeFileSync(file, bytes); else fs.rmSync(file, { force: true }); }
  }
};
const updateManifest = (dir, update) => {
  const manifest = readJson(manifestFile(dir));
  update(manifest);
  fs.writeFileSync(manifestFile(dir), JSON.stringify(manifest));
};

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
  // D143: --changed runs the faster check first and stops at the first failure, so the
  // recorded times are fixed here to run the passing A before the failing B.
  if (partial) {
    const map = readJson(mapFile(dir));
    map.entries.A.lastDurationMs = 1; map.entries.B.lastDurationMs = 60000;
    map.entries.A.durations = [1]; map.entries.B.durations = [60000]; // D143_T011: order by median pass time
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
  assert.match(failure.stderr, /1 failed check\(s\) will run again on the next --changed: B/);
  const countA = counter(dir); const countB = counter(dir, 'B'); const next = run(dir);
  assert.equal(next.results[0].reused, true); assert.equal(counter(dir), countA); assert.equal(counter(dir, 'B'), countB + 1);
});
check('first failed full run records the passing check and the failed check\'s inputs', () => {
  const dir = fixture('first-failure', [entry('A'), entry('B')]);
  fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), '\nprocess.exit(1);\n');
  const result = run(dir); const map = readJson(mapFile(dir));
  assert.equal(result.status, 1); assert(map.entries.A.passHistory[0]); assert(map.entries.A.files.includes('input.data'));
  assert(map.entries.B.files.includes('scripts/_test-B.js')); assert(!map.entries.B.passHistory);
  assert.equal(map.schema, 3);
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
  assert.equal(result.stdout.split(/\r?\n/)[0], 'No checks selected — nothing changed that a check reads.');
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

const git = (dir, ...args) => {
  const result = spawnSync('git', ['-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=',
    '-c', 'user.name=runner fixture', '-c', 'user.email=fixture@example.com', ...args], {
    cwd: dir, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_NAME: 'runner fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'runner fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com' },
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout;
};
function committedFixture(name, entries = [entry('A'), entry('B')], trackManifest = true, prepare = () => {}) {
  const dir = fixture(name, entries);
  prepare(dir);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'fixture@example.com');
  git(dir, 'config', 'user.name', 'fixture');
  git(dir, 'add', '.');
  if (trackManifest) git(dir, 'add', '-f', '.crabshell/verification/manifest.json');
  git(dir, 'commit', '-q', '-m', 'fixture');
  assert.equal(run(dir).status, 0);
  return dir;
}
const manifestRelative = '.crabshell/verification/manifest.json';
for (const newTest of [false, true]) check(`dry-run includes fail-before time for a test ${newTest ? 'new to' : 'present in'} HEAD and honors hash exemptions`, () => {
  const dir = committedFixture(`fail-before-estimate-${newTest}`, [entry('A')]);
  if (newTest) {
    git(dir, 'rm', '--cached', 'scripts/_test-A.js');
    git(dir, 'commit', '-q', '-m', 'test is new to HEAD');
  }
  const map = readJson(mapFile(dir));
  const duration = 1200;
  map.entries.A.lastDurationMs = duration;
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  write(dir, 'input.data', 'b');
  fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), "\nif (fs.readFileSync('input.data', 'utf8') !== 'b') process.exit(1);\n");
  const count = counter(dir);
  const args = ['--changed', '--fail-before', '--dry-run'];
  const plan = JSON.parse(run(dir, args).stdout);
  assert.deepEqual(plan.selected, ['A']);
  assert.equal(plan.failBeforeTargets, 1);
  assert.equal(plan.estimatedSeconds, duration * (newTest ? 2 : 3) / 1000);
  const disabled = JSON.parse(run(dir, [...args, '--no-fail-before']).stdout);
  assert.equal(disabled.failBeforeTargets, 0); assert.equal(disabled.estimatedSeconds, duration / 1000);
  const exemptions = { 'scripts/_test-A.js': {
    sha256: require('crypto').createHash('sha256').update(fs.readFileSync(path.join(dir, 'scripts/_test-A.js'))).digest('hex'),
    reason: 'fixture exemption',
  } };
  write(dir, '.crabshell/verification/fail-before-exempt.json', JSON.stringify(exemptions));
  const exempt = JSON.parse(run(dir, args).stdout);
  assert.equal(exempt.failBeforeTargets, 0); assert.equal(exempt.estimatedSeconds, duration / 1000);
  fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), '\n// invalidates the exemption\n');
  const stale = JSON.parse(run(dir, args).stdout);
  assert.equal(stale.failBeforeTargets, 1); assert.equal(stale.estimatedSeconds, plan.estimatedSeconds);
  assert.equal(counter(dir), count, 'dry-run must not execute the check');
});
// D143_T009: fail-before learns which tests changed from git; with no readable HEAD it
// compares nothing (and the run says so — runner-failure-kind).
check('without a readable HEAD, --fail-before plans no comparison', () => {
  const dir = fixture('fail-before-estimate-git-error');
  assert.equal(run(dir).status, 0);
  const map = readJson(mapFile(dir)); map.entries.A.lastDurationMs = 1000;
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), '\n// changed\n');
  const plan = dry(dir, 'input.data', ['--fail-before']);
  assert.equal(plan.failBeforeTargets, 0); assert.equal(plan.estimatedSeconds, 1);
});
check('failed check is selected without file changes until an executed PASS clears lastFailedAt', () => {
  const dir = committedFixture('failed-reselection', [entry('A'), entry('B')], true, dir => {
    fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), "\nif (process.env.FAIL_B === '1') process.exit(1);\n");
  });
  const failure = run(dir, ['B'], { FAIL_B: '1' });
  assert.equal(failure.status, 1);
  const record = readJson(mapFile(dir)).entries.B;
  assert(Number.isFinite(Date.parse(record.lastFailedAt)));
  assert.equal(git(dir, 'status', '--porcelain').trim(), '');
  const plan = JSON.parse(run(dir, ['--changed', '--dry-run']).stdout);
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, ['B']);
  assert.equal(plan.reasons.B, 'failed in the last run'); assert.equal(plan.wouldReuse, 1);
  const before = counter(dir, 'B'); const passed = run(dir, ['--changed']);
  assert.equal(passed.status, 0); assert.deepEqual(passed.results.map(item => item.id), ['B']);
  assert(!passed.results[0].reused); assert.equal(counter(dir, 'B'), before + 1);
  assert(!Object.hasOwn(readJson(mapFile(dir)).entries.B, 'lastFailedAt'));
  const cleared = JSON.parse(run(dir, ['--changed', '--dry-run']).stdout);
  assert.equal(cleared.full, false); assert.deepEqual(cleared.selected, []);
  assert(!Object.values(cleared.reasons).includes('failed in the last run'));
});
check('fail-before failure clears the working-tree pass key and records the check for retry', () => {
  const dir = committedFixture('fail-before-reselection', [entry('A')]);
  fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), '\n// behavior stays the same\n');
  write(dir, 'input.data', 'b');
  const result = run(dir, ['--changed', '--fail-before']);
  assert.equal(result.status, 1);
  assert.equal(result.results.find(item => item.id === 'FAIL_BEFORE:A').status, 'FAIL');
  const record = readJson(mapFile(dir)).entries.A;
  assert(Number.isFinite(Date.parse(record.lastFailedAt)));
  const plan = JSON.parse(run(dir, ['--changed', '--dry-run']).stdout);
  assert.equal(plan.reasons.A, 'failed in the last run');
});
check('local manifest entry change selects only itself and manifest readers against the load map', () => {
  const dir = committedFixture('manifest-one', [entry('A'), entry('B'), entry('C')], true, dir => {
    fs.appendFileSync(path.join(dir, 'scripts/_test-C.js'), `\nrequire('fs').readFileSync('${manifestRelative}');\n`);
  });
  const before = readJson(mapFile(dir));
  updateManifest(dir, m => { m.entries[0].timeout++; });
  const plan = dry(dir, manifestRelative);
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, ['A', 'C']);
  assert.equal(plan.reasons.A, 'entry, program or runner changed');
  assert.equal(plan.reasons.C, `${manifestRelative} changed`);
  const result = run(dir, ['--changed']);
  assert.equal(result.status, 0); assert.equal(counter(dir, 'A'), 2); assert.equal(counter(dir, 'B'), 1);
  assert.equal(counter(dir, 'C'), 2);
  const afterMap = readJson(mapFile(dir));
  assert.notEqual(afterMap.entries.A.passHistory[0], before.entries.A.passHistory[0]);
  assert.deepEqual(afterMap.entries.B, before.entries.B);
  git(dir, 'commit', '-q', '-am', 'one entry');
  const after = dry(dir, 'unread.md');
  assert.equal(after.full, false); assert.deepEqual(after.selected, []);
});
check('entry committed without a run and a later local entry change both select against the load map', () => {
  const dir = committedFixture('manifest-unrun-head', [entry('A'), entry('B'), entry('C')]);
  updateManifest(dir, m => { m.entries[0].timeout++; });
  git(dir, 'commit', '-q', '-am', 'unverified A change');
  const committed = JSON.parse(run(dir, ['--changed', '--dry-run']).stdout);
  assert.equal(committed.full, false); assert.deepEqual(committed.selected, ['A']);
  updateManifest(dir, m => { m.entries[1].timeout++; });
  const plan = JSON.parse(run(dir, ['--changed', '--dry-run']).stdout);
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, ['A', 'B']);
  assert.equal(plan.reasons.A, 'entry, program or runner changed'); assert.equal(plan.reasons.B, 'entry, program or runner changed');
  const result = run(dir, ['--changed']);
  assert.equal(result.status, 0); assert.deepEqual(result.results.map(item => item.id), ['A', 'B']);
  assert.deepEqual(['A', 'B', 'C'].map(id => counter(dir, id)), [2, 2, 1]);
  git(dir, 'commit', '-q', '-am', 'verified B change');
  assert.deepEqual(JSON.parse(run(dir, ['--changed', '--dry-run']).stdout).selected, []);
});
check('a manifest top-level field change reruns no check (it changes no check\'s fields)', () => {
  const dir = committedFixture('manifest-top');
  updateManifest(dir, m => { m.tools = { changed: 'node runner.js --changed' }; });
  const plan = dry(dir, 'unread.md');
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, []);
});
check('an ignored manifest uses its load map without a committed manifest', () => {
  const dir = committedFixture('manifest-not-committed', undefined, false);
  updateManifest(dir, m => { m.entries[0].timeout++; });
  const plan = JSON.parse(run(dir, ['--changed', '--dry-run']).stdout);
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, ['A']);
  assert.equal(plan.reasons.A, 'entry, program or runner changed');
});
check('a load map from an older runner (no schema) reruns every check once', () => {
  const dir = committedFixture('manifest-old-map');
  const map = readJson(mapFile(dir)); delete map.schema;
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  const plan = dry(dir);
  assert.equal(plan.full, true); assert.equal(plan.reasons.A, 'record from an older runner');
});
check('a record without pass history selects its check, and the run records one', () => {
  const dir = committedFixture('manifest-old-entry');
  const map = readJson(mapFile(dir)); delete map.entries.A.passHistory;
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  const plan = dry(dir);
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, ['A']);
  const result = run(dir, ['--changed']);
  assert.equal(result.status, 0); assert.notEqual(result.results[0].reused, true);
  assert.match(readJson(mapFile(dir)).entries.A.passHistory[0], /^[a-f0-9]{64}$/);
});
check('manifest metadata and removals select nothing while additions name the new entry', () => {
  const dir = committedFixture('manifest-add-remove');
  updateManifest(dir, m => { m.created = 'new metadata'; m.updated = 'new metadata'; m.entries.pop(); });
  let plan = dry(dir, manifestRelative);
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, []);
  const saved = fs.readFileSync(resultFile(dir));
  const empty = run(dir, ['--changed']);
  assert.equal(empty.status, 0); assert.deepEqual(empty.results, []);
  assert(fs.readFileSync(resultFile(dir)).equals(saved));
  git(dir, 'commit', '-q', '-am', 'metadata and removal');
  assert.equal(dry(dir, 'unread.md').full, false);
  updateManifest(dir, m => { m.entries.push(entry('C', { command: entry('B').command })); });
  plan = dry(dir, manifestRelative);
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, ['C']);
  assert.equal(plan.reasons.C, 'new check');
});
check('changed discovery entry selects its expanded checks and other changed-file readers', () => {
  const dir = fixture('manifest-discover', [entry('A'), entry('B'), entry('C')]);
  const manifest = readJson(manifestFile(dir));
  manifest.entries = [entry('C'), { id: 'D', type: 'structural', discover: { pattern: 'scripts/_test-*.js' }, contract: { exitCode: 0 }, timeout: 3000 }];
  fs.writeFileSync(manifestFile(dir), JSON.stringify(manifest));
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 'fixture@example.com'); git(dir, 'config', 'user.name', 'fixture');
  git(dir, 'add', '.'); git(dir, 'add', '-f', manifestRelative); git(dir, 'commit', '-q', '-m', 'fixture');
  assert.equal(run(dir).status, 0);
  updateManifest(dir, m => { m.entries[1].timeout++; });
  const plan = dry(dir, manifestRelative);
  assert.deepEqual(plan.selected, ['D:scripts/_test-A.js', 'D:scripts/_test-B.js']);
  assert.equal(plan.reasons['D:scripts/_test-A.js'], 'entry, program or runner changed');
  assert.equal(plan.reasons['D:scripts/_test-B.js'], 'entry, program or runner changed');
  assert.equal(plan.wouldReuse, 1);
  const withInput = dry(dir, 'input.data');
  assert.deepEqual(withInput.selected, ['C', 'D:scripts/_test-A.js', 'D:scripts/_test-B.js']);
  assert.equal(withInput.reasons.C, 'input.data changed');
  assert.equal(run(dir, ['--changed']).status, 0);
  assert.deepEqual(dry(dir, 'unread.md').selected, [], 'discovered checks record their own fingerprints');
});
check('manifest readers still run when only metadata changes', () => {
  const dir = fixture('manifest-reader', [entry('A'), entry('B')]);
  fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), `\nrequire('fs').readFileSync('${manifestRelative}');\n`);
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 'fixture@example.com'); git(dir, 'config', 'user.name', 'fixture');
  git(dir, 'add', '.'); git(dir, 'add', '-f', manifestRelative); git(dir, 'commit', '-q', '-m', 'fixture');
  assert.equal(run(dir).status, 0);
  updateManifest(dir, m => { m.updated = 'metadata'; });
  const plan = dry(dir, manifestRelative);
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, ['B']); assert.equal(plan.reasons.B, `${manifestRelative} changed`);
});
check('committed metadata changes still select manifest readers from the load map', () => {
  const dir = committedFixture('manifest-committed-reader', [entry('A'), entry('B')], true, dir => {
    fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), `\nrequire('fs').readFileSync('${manifestRelative}');\n`);
  });
  updateManifest(dir, m => { m.updated = 'committed metadata'; });
  git(dir, 'commit', '-q', '-am', 'unread metadata');
  const plan = JSON.parse(run(dir, ['--changed', '--dry-run']).stdout);
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, ['B']); assert.equal(plan.reasons.B, `${manifestRelative} changed`);
});
check('BOM manifest in a nested project compares with the load map', () => {
  const outer = path.join(root, 'nested-manifest-repo');
  const dir = fixture('nested-manifest-repo/project');
  fs.writeFileSync(manifestFile(dir), '\uFEFF' + fs.readFileSync(manifestFile(dir), 'utf8'));
  git(outer, 'init', '-q'); git(outer, 'config', 'user.email', 'fixture@example.com'); git(outer, 'config', 'user.name', 'fixture');
  git(outer, 'add', '.'); git(dir, 'add', '-f', manifestRelative); git(outer, 'commit', '-q', '-m', 'nested BOM manifest');
  assert.equal(run(dir).status, 0);
  const manifest = JSON.parse(fs.readFileSync(manifestFile(dir), 'utf8').replace(/^\uFEFF/, ''));
  manifest.entries[0].timeout++;
  fs.writeFileSync(manifestFile(dir), JSON.stringify(manifest));
  const plan = dry(dir, manifestRelative);
  assert.deepEqual(plan.selected, ['A']); assert.equal(plan.reasons.A, 'entry, program or runner changed');
});
check('an explicit-id run updates only its own record; a failing full run keeps the passing checks\' records', () => {
  const dir = fixture('manifest-pass-records', [entry('A'), entry('B'), entry('C')]);
  fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), "\nif (process.env.FAIL_B === '1') process.exit(1);\n");
  assert.equal(run(dir).status, 0);
  const before = readJson(mapFile(dir));
  updateManifest(dir, m => { m.tools = { changed: 'node runner.js --changed' }; m.entries[0].timeout++; m.entries[1].timeout++; });
  assert.equal(run(dir, ['A']).status, 0);
  const partial = readJson(mapFile(dir));
  assert.notEqual(partial.entries.A.passHistory[0], before.entries.A.passHistory[0]);
  assert.deepEqual(partial.entries.B, before.entries.B); assert.deepEqual(partial.entries.C, before.entries.C);
  // Reordered JSON keys are the same entry, so A's pass is reused during a mixed failure.
  updateManifest(dir, m => { m.entries[0] = Object.fromEntries(Object.entries(m.entries[0]).reverse()); });
  const failure = run(dir, [], { FAIL_B: '1' });
  assert.equal(failure.status, 1); assert.equal(failure.results[0].reused, true);
  const failed = readJson(mapFile(dir));
  assert(failed.entries.B.lastFailedAt); assert.deepEqual(failed.entries.C, before.entries.C);
  assert.equal(run(dir).status, 0);
  assert.deepEqual(dry(dir, 'unread.md').selected, []);
});

function coverageFixture(name) {
  const dir = fixture(name, [entry('A', { coveredBy: 'B' }), entry('B')]);
  write(dir, 'covered-only.data', 'present');
  fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), "\nif (require.main === module) require('fs').readFileSync('covered-only.data');\n");
  fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), [
    "\nif (process.env.COVER_FAIL === '1') process.exit(1);",
    "if (process.env.COVER_TIMEOUT === '1') setInterval(() => {}, 1000);",
    "require('./_test-A.js');\n",
  ].join('\n'));
  return dir;
}
function assertCovered(dir, result) {
  assert.equal(result.status, 0);
  assert.deepEqual(result.results.map(item => item.id), ['A', 'B'], 'keep manifest order despite running B first');
  const covered = result.results[0];
  assert.equal(covered.status, 'PASS'); assert.equal(covered.coveredBy, 'B'); assert.equal(covered.durationMs, 0);
  assert(!Object.hasOwn(covered, 'reused'));
  assert.match(result.stdout, /1 covered by B/);
}
check('previously failed child executes independently of a reused covering PASS', () => {
  const dir = coverageFixture('coverage-failed-retry');
  assert.equal(run(dir, ['--no-reuse']).status, 0);
  const failed = run(dir, ['A'], { FIXTURE_FAIL: '1' });
  assert.equal(failed.status, 1);
  const plan = JSON.parse(run(dir, ['--dry-run']).stdout);
  assert.equal(plan.wouldCover, 0); assert.equal(plan.wouldReuse, 1);
  const before = counter(dir, 'A'); const result = run(dir);
  assert.equal(result.status, 0); assert.equal(result.results[1].reused, true);
  assert(!result.results[0].coveredBy); assert(!result.results[0].reused);
  assert.equal(counter(dir, 'A'), before + 1);
  assert(!Object.hasOwn(readJson(mapFile(dir)).entries.A, 'lastFailedAt'));
});
check('selected passing covering check runs first and avoids the duplicate command', () => {
  const dir = coverageFixture('coverage-pass');
  assert.equal(run(dir, ['--no-reuse']).status, 0);
  updateManifest(dir, m => { m.entries[1].timeout++; });
  const before = ['A', 'B'].map(id => counter(dir, id));
  const result = run(dir);
  assertCovered(dir, result);
  assert.deepEqual(['A', 'B'].map(id => counter(dir, id)), before.map(n => n + 1));
  assert.match(result.stdout, /\(ran 1, 1 covered by B\)/);
});
check('reused covering PASS covers without creating an independent pass key', () => {
  const dir = coverageFixture('coverage-reused');
  assert.equal(run(dir, ['--no-reuse']).status, 0);
  assert(readJson(mapFile(dir)).entries.A.passHistory[0]);
  const before = ['A', 'B'].map(id => counter(dir, id));
  const result = run(dir); assertCovered(dir, result);
  assert.equal(result.results[1].reused, true);
  assert.deepEqual(['A', 'B'].map(id => counter(dir, id)), before);
  assert(!/ran \d/.test(result.stdout));
});
for (const [name, env] of [['failing', { COVER_FAIL: '1' }], ['timing out', { COVER_TIMEOUT: '1' }]]) {
  check(`${name} covering check forces the covered command to produce its own evidence`, () => {
    const dir = coverageFixture(`coverage-${name.replace(/ /g, '-')}`);
    assert.equal(run(dir, ['--no-reuse']).status, 0);
    assertCovered(dir, run(dir));
    // Seed an independent cached child pass; a failing covering command must
    // not reuse it. Change only B's entry so B executes and A's key still matches.
    assert.equal(run(dir, ['A']).status, 0);
    const before = counter(dir, 'A');
    updateManifest(dir, m => { m.entries[1].timeout = env.COVER_TIMEOUT ? 400 : m.entries[1].timeout + 1; });
    const result = run(dir, [], env);
    assert.equal(result.status, 1); assert.equal(result.results[1].status, 'FAIL');
    assert.equal(result.results[0].status, 'PASS'); assert(!result.results[0].coveredBy); assert(!result.results[0].reused);
    assert(counter(dir, 'A') > before); assert.match(result.stdout, /\(ran 2\)/);
  });
}
check('covering check absent from selection leaves the child runnable', () => {
  const dir = coverageFixture('coverage-absent');
  assert.equal(run(dir, ['--no-reuse']).status, 0);
  assertCovered(dir, run(dir));
  write(dir, 'covered-only.data', 'edited'); const before = counter(dir, 'A'); const result = run(dir, ['--changed']);
  assert.equal(result.status, 0); assert.deepEqual(result.results.map(item => item.id), ['A']);
  assert(!result.results[0].coveredBy); assert.equal(counter(dir, 'A'), before + 1);
});
check('explicit id executes the child even after a covering PASS', () => {
  const dir = coverageFixture('coverage-explicit');
  assert.equal(run(dir, ['--no-reuse']).status, 0); assertCovered(dir, run(dir));
  const before = counter(dir, 'A'); const result = run(dir, ['A']);
  assert.equal(result.status, 0); assert.deepEqual(result.results.map(item => item.id), ['A']);
  assert(!result.results[0].coveredBy); assert(!result.results[0].reused); assert.equal(counter(dir, 'A'), before + 1);
});
check('--no-reuse executes both checks instead of covering', () => {
  const dir = coverageFixture('coverage-no-reuse');
  assert.equal(run(dir, ['--no-reuse']).status, 0); assertCovered(dir, run(dir));
  const before = counter(dir, 'A'); const result = run(dir, ['--no-reuse']);
  assert.equal(result.status, 0); assert(result.results.every(item => !item.coveredBy && !item.reused));
  assert.equal(counter(dir, 'A'), before + 2); assert.match(result.stdout, /\(ran 2\)/);
});
check('changed child test executes independently for fail-before despite a selected covering check', () => {
  const dir = coverageFixture('coverage-fail-before');
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 'fixture@example.com'); git(dir, 'config', 'user.name', 'fixture');
  git(dir, 'add', '.'); git(dir, 'add', '-f', manifestRelative); git(dir, 'commit', '-q', '-m', 'coverage baseline');
  assert.equal(run(dir, ['--no-reuse']).status, 0);
  assertCovered(dir, run(dir));
  write(dir, 'input.data', 'b');
  fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), "\nif (require('fs').readFileSync('input.data', 'utf8') !== 'b') process.exit(1);\n");
  const result = run(dir, ['--changed', '--fail-before']);
  assert.equal(result.status, 0);
  const child = result.results.find(item => item.id === 'A');
  assert.equal(child.status, 'PASS'); assert(!child.coveredBy); assert(!child.reused);
  assert.equal(result.results.find(item => item.id === 'FAIL_BEFORE:A').status, 'PASS');
});
check('dry-run counts coverage separately and excludes its duration without changing reasons', () => {
  const dir = coverageFixture('coverage-estimate'); assert.equal(run(dir, ['--no-reuse']).status, 0);
  const map = readJson(mapFile(dir)); map.entries.A.lastDurationMs = 5000; map.entries.B.lastDurationMs = 2000;
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  updateManifest(dir, m => { m.entries[1].reuse = false; });
  const before = counter(dir, 'A'); const plan = JSON.parse(run(dir, ['--dry-run']).stdout);
  assert.equal(plan.wouldCover, 1); assert.equal(plan.wouldReuse, 0); assert.equal(plan.estimatedSeconds, 2);
  assert.deepEqual(plan.reasons, { B: 'reuse:false' });
  const forced = JSON.parse(run(dir, ['--dry-run', '--no-reuse']).stdout);
  assert.equal(forced.wouldCover, 0); assert.equal(forced.estimatedSeconds, 7); assert.equal(counter(dir, 'A'), before);
});
check('discovery coveredBy maps accept either slash style and keep expanded result order', () => {
  const dir = coverageFixture('coverage-discover');
  updateManifest(dir, m => { m.entries = [{ id: 'D', type: 'structural', discover: { pattern: 'scripts/_test-*.js' },
    coveredBy: { 'scripts\\_test-A.js': 'B' }, contract: { exitCode: 0 } }, m.entries[1]]; });
  assert.equal(run(dir, ['--no-reuse']).status, 0);
  const before = counter(dir, 'A');
  updateManifest(dir, m => { m.entries[1].timeout++; });
  const result = run(dir);
  assert.equal(result.status, 0); assert.deepEqual(result.results.map(item => item.id), ['D:scripts/_test-A.js', 'B']);
  assert.equal(result.results[0].coveredBy, 'B'); assert.equal(counter(dir, 'A'), before + 1);
});
check('multiple covering ids report covered by other checks and exclude covered commands from ran', () => {
  const dir = fixture('coverage-multiple', [entry('A', { coveredBy: 'B' }), entry('B'), entry('C', { coveredBy: 'D' }), entry('D')]);
  fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), "\nrequire('./_test-A.js');\n");
  fs.appendFileSync(path.join(dir, 'scripts/_test-D.js'), "\nrequire('./_test-C.js');\n");
  assert.equal(run(dir, ['--no-reuse']).status, 0);
  const before = ['A', 'B', 'C', 'D'].map(id => counter(dir, id));
  updateManifest(dir, m => { m.entries[1].timeout++; m.entries[3].timeout++; });
  const result = run(dir);
  assert.equal(result.status, 0); assert.match(result.stdout, /\(ran 2, 2 covered by other checks\)/);
  assert.deepEqual(result.results.map(item => item.id), ['A', 'B', 'C', 'D']);
  assert.deepEqual(['A', 'B', 'C', 'D'].map(id => counter(dir, id)), before.map(n => n + 1));
});
check('a covered result cannot itself authorize another covered PASS', () => {
  const dir = fixture('coverage-chain', [entry('A', { coveredBy: 'B' }), entry('B', { coveredBy: 'C' }), entry('C')]);
  fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), "\nrequire('./_test-A.js');\n");
  fs.appendFileSync(path.join(dir, 'scripts/_test-C.js'), "\nrequire('./_test-B.js');\n");
  assert.equal(run(dir, ['--no-reuse']).status, 0);
  const before = ['A', 'B', 'C'].map(id => counter(dir, id));
  updateManifest(dir, m => { m.entries[2].timeout++; });
  const result = run(dir);
  assert.equal(result.status, 0); assert.equal(result.results[1].coveredBy, 'C'); assert(!result.results[0].coveredBy);
  assert.deepEqual(['A', 'B', 'C'].map(id => counter(dir, id)), [before[0] + 2, before[1] + 1, before[2] + 1]);
});
for (const mode of ['first map', 'missing record', 'missing files', 'empty files']) {
  check(`covered check executes to establish real inputs: ${mode}`, () => {
    const dir = coverageFixture(`coverage-record-${mode.replace(/ /g, '-')}`);
    if (mode !== 'first map') {
      assert.equal(run(dir, ['--no-reuse']).status, 0);
      const map = readJson(mapFile(dir));
      if (mode === 'missing record') delete map.entries.A;
      else if (mode === 'missing files') delete map.entries.A.files;
      else map.entries.A.files = [];
      fs.writeFileSync(mapFile(dir), JSON.stringify(map));
    }
    const plan = JSON.parse(run(dir, ['--dry-run']).stdout);
    assert.equal(plan.wouldCover, 0);
    const before = counter(dir, 'A'); const result = run(dir);
    assert.equal(result.status, 0); assert(!result.results[0].coveredBy); assert(!result.results[0].reused);
    assert(counter(dir, 'A') > before);
    assert(readJson(mapFile(dir)).entries.A.files.includes('covered-only.data'));
    assertCovered(dir, run(dir));
    assert.deepEqual(dry(dir, 'unread.md').selected, [], 'no perpetual no-recorded-files selection');
  });
}
for (const mode of ['reuse:false', 'always:true', 'reuseExclude']) {
  check(`${mode} child requires an executed covering PASS and dry-run predicts it`, () => {
    const dir = coverageFixture(`coverage-fresh-${mode.replace(':', '-')}`);
    const childId = mode === 'reuseExclude' ? 'D:scripts/_test-A.js' : 'A';
    updateManifest(dir, m => {
      if (mode === 'reuseExclude') m.entries[0] = { id: 'D', type: 'structural',
        discover: { pattern: 'scripts/_test-*.js' }, reuseExclude: ['scripts/_test-A.js'],
        coveredBy: { 'scripts/_test-A.js': 'B' }, contract: { exitCode: 0 } };
      else if (mode === 'reuse:false') m.entries[0].reuse = false;
      else m.entries[0].always = true;
    });
    assert.equal(run(dir, ['--no-reuse']).status, 0);
    let before = counter(dir, 'A');
    let plan = JSON.parse(run(dir, ['--dry-run']).stdout);
    assert.equal(plan.wouldCover, 0); assert.equal(plan.wouldReuse, 1);
    const reusedParent = run(dir);
    assert.equal(reusedParent.status, 0); assert.equal(reusedParent.results[1].reused, true);
    assert(!reusedParent.results[0].coveredBy); assert(!reusedParent.results[0].reused);
    assert.equal(counter(dir, 'A'), before + 1);
    updateManifest(dir, m => { m.entries[1].timeout++; });
    plan = JSON.parse(run(dir, ['--dry-run']).stdout);
    assert.equal(plan.wouldCover, 1); assert.equal(plan.wouldReuse, 0);
    before = counter(dir, 'A');
    const executedParent = run(dir);
    assert.equal(executedParent.status, 0); assert(!executedParent.results[1].reused);
    assert.equal(executedParent.results[0].id, childId); assert.equal(executedParent.results[0].coveredBy, 'B');
    assert.equal(counter(dir, 'A'), before + 1);
  });
}
for (const discovery of [false, true]) {
  for (const field of ['assertions', 'forbiddenChanges']) {
    check(`coverage rejects independent ${field} on ${discovery ? 'discovered' : 'explicit'} children before execution`, () => {
      const dir = coverageFixture(`coverage-contract-${discovery}-${field}`);
      const childId = discovery ? 'D:scripts/_test-A.js' : 'A';
      updateManifest(dir, m => {
        if (discovery) m.entries[0] = { id: 'D', type: 'structural', discover: { pattern: 'scripts/_test-*.js' },
          coveredBy: { 'scripts/_test-A.js': 'B' }, contract: { exitCode: 0 } };
        m.entries[0].contract[field] = field === 'assertions'
          ? [{ kind: 'fileExists', path: 'input.data' }] : ['input.data'];
      });
      const result = run(dir);
      assert.equal(result.status, 1);
      assert(result.results[0].error.includes(childId)); assert(result.results[0].error.includes('B'));
      assert(result.results[0].error.includes(`contract.${field}`));
      assert.equal(counter(dir, 'A'), 0); assert.equal(counter(dir, 'B'), 0);
    });
  }
  check(`coverage accepts a forbiddenChanges subset on ${discovery ? 'discovered' : 'explicit'} children`, () => {
    const dir = coverageFixture(`coverage-contract-subset-${discovery}`);
    updateManifest(dir, m => {
      if (discovery) m.entries[0] = { id: 'D', type: 'structural', discover: { pattern: 'scripts/_test-*.js' },
        coveredBy: { 'scripts/_test-A.js': 'B' }, contract: { exitCode: 0 } };
      m.entries[0].contract.forbiddenChanges = ['input.data'];
      m.entries[1].contract.forbiddenChanges = ['input.data', 'optional.data'];
    });
    assert.equal(run(dir, ['--no-reuse']).status, 0);
    const result = run(dir);
    assert.equal(result.status, 0); assert.equal(result.results[0].coveredBy, 'B');
  });
}
check('a covered PASS keeps its files and its own pass history during a mixed failure', () => {
  const dir = coverageFixture('coverage-hash-mixed');
  write(dir, 'scripts/_test-C.js', "if (process.env.FAIL_C === '1') process.exit(1);\n");
  updateManifest(dir, m => { m.entries.push(entry('C')); });
  assert.equal(run(dir, ['--no-reuse']).status, 0);
  const before = readJson(mapFile(dir));
  updateManifest(dir, m => { m.entries[0].timeout++; m.entries[2].timeout++; m.projectType = 'changed'; });
  const result = run(dir, [], { FAIL_C: '1' });
  assert.equal(result.status, 1); assert.equal(result.results[0].coveredBy, 'B');
  assert.equal(result.results[1].reused, true); assert.equal(result.results[2].status, 'FAIL');
  const after = readJson(mapFile(dir));
  assert.deepEqual(after.entries.A.files, before.entries.A.files);
  assert.deepEqual(after.entries.A.passHistory, before.entries.A.passHistory, 'a covered check adds no pass of its own');
  assert(after.entries.C.lastFailedAt);
});
for (const [name, change, reason] of [
  ['unknown id', m => { m.entries[0].coveredBy = 'MISSING'; }, /unknown coveredBy check id MISSING/],
  ['cycle', m => { m.entries[1].coveredBy = 'A'; }, /coveredBy cycle/],
]) check(`invalid coverage ${name} is a manifest error before any command runs`, () => {
  const dir = coverageFixture(`coverage-invalid-${name.replace(/ /g, '-')}`); updateManifest(dir, change);
  const result = run(dir); assert.equal(result.status, 1); assert.match(result.stdout, reason);
  assert.equal(counter(dir, 'A'), 0); assert.equal(counter(dir, 'B'), 0);
});
console.log('PASSING FIXTURE STDOUT\n' + second.stdout + 'END PASSING FIXTURE STDOUT');
report.finish();
