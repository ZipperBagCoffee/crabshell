'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');
const source = process.env.CRABSHELL_TEST_RUNNER || path.join(__dirname, '..', 'skills', 'verifying', 'scripts', 'run-verify.js');
const api = require(source);
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
  fs.copyFileSync(source, path.join(dir, '.crabshell/verification/run-verify.js'));
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
  return { ...result, results: match ? JSON.parse(match[0]) : readJson(resultFile(dir)) || [] };
}
const dry = (dir, files = 'input.data', args = []) => {
  const result = run(dir, ['--changed', '--files', files, '--dry-run', ...args]);
  return JSON.parse(result.stdout);
};
const updateManifest = (dir, update) => {
  const manifest = readJson(manifestFile(dir));
  update(manifest);
  fs.writeFileSync(manifestFile(dir), JSON.stringify(manifest));
};

// Inspect private helpers without adding a test API to the portable runner.
// path.win32 exercises extended-path handling on every host, not just Windows.
function internals(overrides = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(source, 'utf8') + '\nmodule.exports = { passKey, readTrace, printResults };', {
    module: mod, exports: mod.exports, __filename: source,
    __dirname: overrides.dirname || path.dirname(source),
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : require(name),
    process: overrides.process || process, console: overrides.console || console, Buffer,
  }, { filename: source });
  return mod.exports;
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
  assert.match(record.passKey, /^[a-f0-9]{64}$/);
  assert(Number.isFinite(Date.parse(record.passedAt)));
});
check('default stdout is summary only and full array is written beside runner', () => {
  assert.match(second.stdout, /^PASS — 1 of 1 checks \(reused 1 unchanged since they passed\), [\d.]+s\r?\n/);
  assert(!/^\[/m.test(second.stdout));
  assert.match(second.stdout, /Verification Results: PASS: 1 \/ FAIL: 0 \/ Manual: 0 \/ Total: 1/);
  assert(second.stdout.trimEnd().endsWith(`Full results: ${resultFile(main)}`));
  assert.deepEqual(readJson(resultFile(main)), second.results);
});
check('environment JSON mode preserves full results before summary', () => {
  const result = run(main, [], { CRABSHELL_VERIFY_JSON: '1' });
  assert.match(result.stdout, /^\[/); assert(result.stdout.indexOf(']') < result.stdout.indexOf('PASS —'));
  assert.deepEqual(readJson(resultFile(main)), result.results);
});
check('--json prints the array too', () => {
  const result = run(main, ['--json']); assert.equal(result.status, 0); assert.match(result.stdout, /^\[/);
});
for (const [name, mutate, prepare] of [
  ['recorded byte', dir => write(dir, 'input.data', 'b')],
  ['test byte', dir => fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), '\n')],
  ['manifest entry', dir => updateManifest(dir, m => { m.entries[0].timeout += 1; })],
  ['runner byte', dir => fs.appendFileSync(path.join(dir, '.crabshell/verification/run-verify.js'), '\n')],
  ['folder entry added', dir => write(dir, 'notes/second', 'two')],
  ['folder entry removed', dir => fs.unlinkSync(path.join(dir, 'notes/second'))],
  ['previously missing input created', dir => write(dir, 'optional.data', 'present'), dir => fs.unlinkSync(path.join(dir, 'optional.data'))],
  ['recorded input deleted', dir => fs.unlinkSync(path.join(dir, 'optional.data'))],
]) check(`${name} invalidates the cached pass`, () => {
  if (prepare) prepare(main);
  run(main);
  const before = counter(main); mutate(main);
  const result = run(main); const reused = run(main);
  assert.equal(result.status, 0); assert.notEqual(result.results[0].reused, true); assert.equal(counter(main), before + 1);
  assert.equal(reused.results[0].reused, true);
});
check('manifest property order does not invalidate a pass', () => {
  const before = counter(main);
  updateManifest(main, m => { m.entries[0] = Object.fromEntries(Object.entries(m.entries[0]).reverse()); });
  const result = run(main); assert.equal(result.results[0].reused, true); assert.equal(counter(main), before);
});
check('failure clears pass key and must execute on the next run', () => {
  const failure = run(main, ['--no-reuse'], { FIXTURE_FAIL: '1' });
  assert.equal(failure.status, 1); assert.equal(failure.results[0].status, 'FAIL');
  assert(!readJson(mapFile(main)).entries.A.passKey);
  const before = counter(main); const next = run(main);
  assert.equal(next.status, 0); assert.notEqual(next.results[0].reused, true); assert.equal(counter(main), before + 1);
});
check('timeout clears pass key and records duration', () => {
  const originalTimeout = readJson(manifestFile(main)).entries[0].timeout;
  updateManifest(main, m => { m.entries[0].timeout = 200; });
  run(main);
  const timeout = run(main, ['--no-reuse'], { FIXTURE_HANG: '1' });
  assert.equal(timeout.status, 1); assert.match(timeout.results[0].error, /ETIMEDOUT/);
  assert(timeout.results[0].durationMs >= 150); assert(!readJson(mapFile(main)).entries.A.passKey);
  updateManifest(main, m => { m.entries[0].timeout = originalTimeout; });
  const next = run(main); assert.equal(next.status, 0); assert.notEqual(next.results[0].reused, true);
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
  const before = counter(forbidden); const plan = dry(forbidden);
  assert.equal(plan.full, false); assert.equal(plan.reasons.A, 'input.data'); assert.equal(plan.wouldReuse, 1);
  assert.equal(plan.estimatedSeconds, 2.4); assert.equal(counter(forbidden), before);
  const noReuse = dry(forbidden, 'input.data', ['--no-reuse']);
  assert.equal(noReuse.wouldReuse, 0); assert.equal(noReuse.estimatedSeconds, 3.6);
  assert.equal(dry(forbidden, 'notes/new').reasons.A, 'notes/');
});
check('full dry-run explains each selection', () => {
  const dir = fixture('no-map'); const plan = dry(dir);
  assert.equal(plan.reasons.A, plan.reason); assert.equal(plan.estimatedSeconds, 0); assert.equal(plan.wouldReuse, 0);
});
check('dry-run explains always, no recorded files, and new check selections', () => {
  const dir = fixture('selection-reasons', [entry('A', { always: true }), entry('B')]); run(dir);
  const map = readJson(mapFile(dir));
  map.entries.B.files = [];
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  const plan = dry(dir, 'unread.md');
  assert.equal(plan.reasons.A, 'always'); assert.equal(plan.reasons.B, 'no recorded files');
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
for (const [name, args] of [['full', []], ['changed', ['--changed', '--files', 'input.data']]]) {
  check(`discovery reuseExclude reruns only the excluded file on an unchanged second ${name} run`, () => {
    const dir = fixture(`discovered-exclusion-${name}`, [entry('A'), entry('B')]);
    updateManifest(dir, m => { m.entries = [{ id: 'D', type: 'structural', reuseExclude: ['scripts/_test-B.js'], discover: { pattern: 'scripts/_test-*.js' }, contract: { exitCode: 0 } }]; });
    const first = run(dir, args);
    assert.equal(first.status, 0); assert.equal(first.results.length, 2);
    assert(first.results.every(item => item.status === 'PASS' && item.reused !== true));
    assert.deepEqual(['A', 'B'].map(id => counter(dir, id)), [1, 1]);
    const second = run(dir, args);
    assert.equal(second.status, 0); assert.equal(second.results.length, 2);
    assert(second.results.every(item => item.status === 'PASS'));
    assert.equal(second.results.find(item => item.id === 'D:scripts/_test-A.js').reused, true);
    assert.notEqual(second.results.find(item => item.id === 'D:scripts/_test-B.js').reused, true);
    assert.deepEqual(['A', 'B'].map(id => counter(dir, id)), [1, 2]);
    assert.equal(dry(dir).wouldReuse, 1);
  });
}
check('mixed failure stores successful key but preserves dependency records and global hashes', () => {
  const dir = fixture('mixed', [entry('A'), entry('B')]); run(dir);
  const before = readJson(mapFile(dir));
  const testB = path.join(dir, 'scripts/_test-B.js');
  fs.appendFileSync(testB, '\nprocess.exit(1);\n');
  write(dir, 'input.data', 'z');
  const failure = run(dir); const after = readJson(mapFile(dir));
  assert.equal(failure.status, 1); assert(after.entries.A.passKey); assert.notEqual(after.entries.A.passKey, before.entries.A.passKey);
  assert(!after.entries.B.passKey); assert.deepEqual(after.fileHashes, before.fileHashes); assert.deepEqual(after.fileTimes, before.fileTimes);
  for (const id of ['A', 'B']) { assert.deepEqual(after.entries[id].files, before.entries[id].files); assert.equal(after.entries[id].test, before.entries[id].test); }
  const countA = counter(dir); const countB = counter(dir, 'B'); const next = run(dir);
  assert.equal(next.results[0].reused, true); assert.equal(counter(dir), countA); assert.equal(counter(dir, 'B'), countB + 1);
});
check('first failed run stores metadata without trusting incomplete dependency records', () => {
  const dir = fixture('first-failure', [entry('A'), entry('B')]);
  fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), '\nprocess.exit(1);\n');
  const result = run(dir); const map = readJson(mapFile(dir));
  assert.equal(result.status, 1); assert(!map.entries.A.passKey); assert(!map.entries.A.files); assert(!map.entries.B.passKey);
  const next = run(dir); assert.notEqual(next.results[0].reused, true);
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
  assert(readJson(mapFile(dir)).entries.A.passKey);
  if (mixedFailure) fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), '\nprocess.exit(1);\n');
  const mutated = run(dir, ['--no-reuse'], { FIXTURE_MUTATE: 'A' });
  assert.equal(mutated.status, mixedFailure ? 1 : 0);
  assert.equal(mutated.results[0].status, 'PASS');
  const record = readJson(mapFile(dir)).entries.A;
  assert(!record.passKey); assert(!record.passedAt);
  const before = counter(dir);
  const next = run(dir);
  assert.notEqual(next.results[0].reused, true); assert.equal(counter(dir), before + 1);
});
check('newly traced input written during the first check stores no key', () => {
  const dir = fixture('new-input-edited');
  const result = run(dir, [], { FIXTURE_MUTATE: 'A' });
  assert.equal(result.status, 0); assert(!readJson(mapFile(dir)).entries.A.passKey);
  const next = run(dir);
  assert.notEqual(next.results[0].reused, true); assert.equal(counter(dir), 2);
});
check('later check edits cannot give an earlier pass a key for untested content', () => {
  const dir = fixture('later-check-edit', [entry('A'), entry('B')]); run(dir);
  const before = readJson(mapFile(dir)).entries.A.passKey;
  assert(before);
  assert.equal(run(dir, ['--no-reuse'], { FIXTURE_MUTATE: 'B' }).status, 0);
  const after = readJson(mapFile(dir));
  assert.equal(after.entries.A.passKey, before); assert(!after.entries.B.passKey);
  const count = counter(dir); const next = run(dir);
  assert.notEqual(next.results[0].reused, true); assert.equal(counter(dir), count + 1);
});

for (const [name, files, reason, prepare] of [
  ['unknown dependency', 'unknown.js', /not in the load map/],
  ['global dependency', 'package.json', /affects every check/],
  ['stale map', 'unread.md', /load map is older than/, dir => {
    const map = readJson(mapFile(dir));
    map.fileTimes['scripts/_test-A.js'] = 0;
    map.fileHashes['scripts/_test-A.js'] = 'older content';
    fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  }],
  ['git error', null, /git diff failed/],
]) check(`full fallback runs every check without reuse: ${name}`, () => {
  const dir = fixture(`fallback-${name.replace(/ /g, '-')}`, [entry('A'), entry('B')]); run(dir);
  assert(readJson(mapFile(dir)).entries.A.passKey); assert(readJson(mapFile(dir)).entries.B.passKey);
  if (prepare) prepare(dir);
  const args = ['--changed', ...(files ? ['--files', files] : [])];
  const plan = JSON.parse(run(dir, [...args, '--dry-run']).stdout);
  assert.equal(plan.full, true); assert.match(plan.reason, reason); assert.equal(plan.wouldReuse, 0);
  const result = run(dir, args);
  assert.equal(result.status, 0); assert(result.results.every(item => !item.reused));
  assert.deepEqual(['A', 'B'].map(id => counter(dir, id)), [2, 2]);
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
check('empty recorded inputs never get a key and execute again', () => {
  const item = entry('A', { command: { file: 'node', args: ['-e', "require('fs').appendFileSync('node_modules/counters/A', 'x')"] } });
  const dir = fixture('empty-inputs', [item]); run(dir);
  const record = readJson(mapFile(dir)).entries.A;
  assert.deepEqual(record.files, []); assert(!record.passKey);
  const next = run(dir); assert.notEqual(next.results[0].reused, true); assert.equal(counter(dir), 2);
});
check('passes older than seven days execute again and receive a fresh passedAt', () => {
  const dir = fixture('expired'); run(dir);
  const map = readJson(mapFile(dir));
  const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  map.entries.A.passedAt = expired;
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  const next = run(dir); assert.notEqual(next.results[0].reused, true); assert.equal(counter(dir), 2);
  assert(Date.parse(readJson(mapFile(dir)).entries.A.passedAt) > Date.parse(expired));
  const passedAt = readJson(mapFile(dir)).entries.A.passedAt;
  assert.equal(run(dir).results[0].reused, true);
  assert.equal(readJson(mapFile(dir)).entries.A.passedAt, passedAt, 'reuse must not renew the expiry');
});
check('platform and architecture each change the pass key', () => {
  const dir = fixture('platform'); const record = { files: ['input.data'], test: 'scripts/_test-A.js' };
  const key = (platform, arch) => internals({ process: { ...process, platform, arch } }).passKey(entry('A'), record, dir, 'runner');
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
  const before = counter(dir); const result = run(dir, ['--changed', '--files', 'unread.md']);
  assert.equal(result.status, 0); assert.deepEqual(result.results, []); assert.equal(counter(dir), before);
  assert.equal(result.stdout.split(/\r?\n/)[0], 'No checks selected — nothing changed that a check reads.');
  assert(!result.stdout.includes('PASS —'));
});
console.log('PASSING FIXTURE STDOUT\n' + second.stdout + 'END PASSING FIXTURE STDOUT');
report.finish();
