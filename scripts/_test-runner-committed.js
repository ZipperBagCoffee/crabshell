'use strict';
// Runs in a committed fixture: checks compared with HEAD (fail-before, its time estimate and
// exemptions), manifest edits, and a manifest outside the repository root. (Moved out of
// _test-runner-reuse.js with D187: that file had reached the check timeout; the steps are unchanged.)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { root, report, check, write, readJson, entry, fixture, mapFile, manifestFile, counter, run, dry, updateManifest, git, manifestRelative } = require('./testlib/runner-project').createRunnerProject('runner-committed');

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
check('manifest removals fail without executing checks; approval clears retirement and additions name the new entry', () => {
  const dir = committedFixture('manifest-add-remove');
  updateManifest(dir, m => { m.created = 'new metadata'; m.updated = 'new metadata'; m.entries.pop(); });
  let plan = dry(dir, manifestRelative);
  assert.equal(plan.full, false); assert.deepEqual(plan.selected, []);
  const before = readJson(mapFile(dir)).entries.B;
  const removed = run(dir, ['--changed']);
  assert.equal(removed.status, 1); assert.equal(removed.results[0].id, 'REMOVED:B');
  assert.match(removed.stdout, /Restore it.*dropped-checks.json.*old id B/);
  assert.deepEqual(readJson(mapFile(dir)).retired.B, before);
  assert(!readJson(mapFile(dir)).entries.B);
  const repeated = run(dir, ['--failed']);
  assert.equal(repeated.status, 1); assert.match(repeated.stdout, /REMOVED:B/);
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ B: { reason: 'Retired duplicate check' } }));
  const approved = run(dir, ['--failed']);
  assert.equal(approved.status, 0); assert.match(approved.stdout, /Approved drops: B \(removed check\) — Retired duplicate check/);
  assert.deepEqual(readJson(mapFile(dir)).retired, {});
  const empty = run(dir, ['--changed']);
  assert.equal(empty.status, 0); assert.doesNotMatch(empty.stdout, /Approved drops|REMOVED:/);
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

report.finish();
