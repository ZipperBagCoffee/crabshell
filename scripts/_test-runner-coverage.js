'use strict';
// coveredBy: a check whose test another check already runs is covered by that check's pass
// instead of running again. (Moved out of _test-runner-reuse.js with D187: that file had
// reached the check timeout; the steps are unchanged.)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { report, check, write, readJson, entry, fixture, mapFile, counter, run, dry, updateManifest, git, manifestRelative } = require('./testlib/runner-project').createRunnerProject('runner-coverage');

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
// D170: a covering check failing in a --changed run no longer stops it, so the covered check,
// chosen too, runs itself instead of being left unrun.
check('covering check failing in a --changed run lets the chosen covered check run itself', () => {
  const dir = coverageFixture('coverage-changed-failing');
  assert.equal(run(dir, ['--no-reuse']).status, 0);
  // Both A and B read input.data, so both are chosen and A waits for B.
  write(dir, 'input.data', 'changed');
  const before = counter(dir, 'A');
  const result = run(dir, ['--changed'], { COVER_FAIL: '1' });
  assert.equal(result.status, 1);
  const [covered, covering] = ['A', 'B'].map(id => result.results.find(item => item.id === id) || {});
  assert.equal(covering.status, 'FAIL');
  assert.equal(covered.status, 'PASS'); assert(!covered.coveredBy); assert(!covered.reused);
  assert.equal(counter(dir, 'A'), before + 1);
  assert.doesNotMatch(result.stdout, /Stopped after/);
});
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
report.finish();
