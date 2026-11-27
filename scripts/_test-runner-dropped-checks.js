'use strict';
// D187: a check that passed and was then removed or weakened fails the run until the exact
// drop is approved in dropped-checks.json; a flaky quarantine expires after quarantineDays.
// (Moved out of _test-runner-reuse.js, which had reached the check timeout.)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { report, check, write, readJson, entry, fixture, mapFile, manifestFile, counter, run, dry, updateManifest } = require('./testlib/runner-project').createRunnerProject('runner-dropped-checks');

check('deleted discovered file remains REMOVED until its expanded id is approved', () => {
  const dir = fixture('dropped-discovery', [entry('A'), entry('B')]);
  updateManifest(dir, m => { m.entries = [{ id: 'D', type: 'structural', discover: { pattern: 'scripts/_test-*.js' }, contract: { exitCode: 0 } }]; });
  assert.equal(run(dir).status, 0);
  const id = 'D:scripts/_test-B.js';
  fs.unlinkSync(path.join(dir, 'scripts/_test-B.js'));
  const removed = run(dir, ['--changed']);
  assert.equal(removed.status, 1); assert(removed.results.some(result => result.id === `REMOVED:${id}`));
  assert(readJson(mapFile(dir)).retired[id].passHistory);
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ D: { reason: 'Wrong group id' } }));
  assert.equal(run(dir, ['--changed']).status, 1);
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ [id]: { reason: 'Covered elsewhere' } }));
  const approved = run(dir, ['--changed']);
  assert.equal(approved.status, 0); assert(approved.stdout.includes(`Approved drops: ${id} (removed check) — Covered elsewhere`));
});
check('restoring a removed id keeps its baseline; checks that never passed are not retired', () => {
  const dir = fixture('restored-check', [entry('A'), entry('B')]);
  assert.equal(run(dir, ['A']).status, 0);
  const baseline = readJson(mapFile(dir)).entries.A;
  updateManifest(dir, m => { m.entries = []; });
  const removed = run(dir, ['--changed']);
  assert.equal(removed.status, 1); assert.deepEqual(removed.results.map(result => result.id), ['REMOVED:A']);
  updateManifest(dir, m => { m.entries = [entry('A')]; });
  const restored = run(dir, ['--changed']);
  assert.equal(restored.status, 0); assert.deepEqual(readJson(mapFile(dir)).retired, {});
  assert.deepEqual(readJson(mapFile(dir)).entries.A.contractItems, baseline.contractItems);
});
check('weakened contracts preserve the baseline through failures and require every exact removed item', () => {
  const assertion = { kind: 'stdoutMatches', pattern: 'PASS fixture' };
  const dir = fixture('weakened-contract', [entry('A', { contract: { exitCode: 0, assertions: [assertion, { kind: 'fileExists', path: 'input.data' }], forbiddenChanges: ['optional.data'] } })]);
  assert.equal(run(dir).status, 0);
  const baseline = readJson(mapFile(dir)).entries.A;
  const item = '{"kind":"stdoutMatches","pattern":"PASS fixture"}';
  assert.deepEqual(baseline.contractItems, ['exitCode:0', 'forbid:optional.data', '{"kind":"fileExists","path":"input.data"}', item].sort());
  updateManifest(dir, m => { m.entries[0].contract.assertions.shift(); });
  const missing = run(dir, ['--changed']);
  assert.equal(missing.status, 1); assert(missing.results.some(result => result.id === 'WEAKENED:A' && result.error.includes(item)));
  for (const field of ['contractItems', 'passHistory', 'passedAt']) assert.deepEqual(readJson(mapFile(dir)).entries.A[field], baseline[field]);
  assert.equal(readJson(mapFile(dir)).entries.A.lastFailedKind, 'weakened');
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ A: { contract: ['forbid:optional.data'], reason: 'Wrong item' } }));
  const wrong = run(dir, ['--failed']);
  assert.equal(wrong.status, 1); assert.doesNotMatch(wrong.stdout, /Approved drops:/);
  assert.deepEqual(readJson(mapFile(dir)).entries.A.contractItems, baseline.contractItems);
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ A: { contract: [item], reason: 'Assertion replaced' } }));
  const approved = run(dir, ['--failed']);
  assert.equal(approved.status, 0); assert(approved.stdout.includes(`Approved drops: A (contract: ${item}) — Assertion replaced`));
  assert.deepEqual(readJson(mapFile(dir)).entries.A.contractItems, baseline.contractItems.filter(value => value !== item));
  assert(!readJson(mapFile(dir)).entries.A.lastFailedAt);
  // Return to an earlier accepted contract: its old cache entry cannot bypass the latest baseline.
  updateManifest(dir, m => { m.entries[0].contract.assertions.push(assertion); });
  assert.equal(run(dir, ['A']).status, 0);
  write(dir, '.crabshell/verification/dropped-checks.json', '{}');
  updateManifest(dir, m => { m.entries[0].contract.assertions.pop(); });
  assert.equal(run(dir, ['--changed']).status, 1);
});
check('contract comparisons sort nested object keys and protect forbidden paths and exit codes', () => {
  const contract = { exitCode: 0, assertions: [{ kind: 'jsonEquals', path: 'value.json', equals: { alpha: 1, beta: { first: 2, second: 3 } } }], forbiddenChanges: ['optional.data'] };
  const dir = fixture('contract-items', [entry('A', { contract })]);
  write(dir, 'value.json', JSON.stringify({ alpha: 1, beta: { first: 2, second: 3 } }));
  assert.equal(run(dir).status, 0);
  const baseline = readJson(mapFile(dir)).entries.A.contractItems;
  updateManifest(dir, m => { m.entries[0].contract.assertions[0] = { equals: { beta: { second: 3, first: 2 }, alpha: 1 }, path: 'value.json', kind: 'jsonEquals' }; });
  write(dir, 'value.json', JSON.stringify({ beta: { second: 3, first: 2 }, alpha: 1 }));
  assert.equal(run(dir, ['A']).status, 0);
  assert.deepEqual(readJson(mapFile(dir)).entries.A.contractItems, baseline);
  updateManifest(dir, m => { m.entries[0].contract.forbiddenChanges = []; m.entries[0].contract.exitCode = 7; });
  fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), '\nprocess.exit(7);\n');
  const missing = run(dir, ['--changed']);
  assert.equal(missing.status, 1); assert.match(missing.stdout, /forbid:optional.data/); assert.match(missing.stdout, /exitCode:0/);
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ A: { contract: ['forbid:optional.data'], reason: 'Only one item' } }));
  assert.equal(run(dir, ['--failed']).status, 1);
  assert.deepEqual(readJson(mapFile(dir)).entries.A.contractItems, baseline);
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ A: { contract: ['forbid:optional.data', 'exitCode:0'], reason: 'Both changes intended' } }));
  assert.equal(run(dir, ['--failed']).status, 0);
});
check('checkedPattern compares exact stdout names, preserves them on failure and applies names approvals', () => {
  const dir = fixture('checked-names');
  updateManifest(dir, m => { m.checkedPattern = '^PASS: (.+)$'; });
  const script = fs.readFileSync(path.join(dir, 'scripts/_test-A.js'), 'utf8');
  write(dir, 'scripts/_test-A.js', `${script}\nconsole.log('PASS: alpha');\n`);
  assert.equal(run(dir, ['A']).status, 0);
  write(dir, 'scripts/_test-A.js', `${script}\nconsole.log('PASS: beta\\r\\nPASS: alpha\\r\\nPASS: beta');\n`);
  assert.equal(run(dir, ['A']).status, 0);
  const baseline = readJson(mapFile(dir)).entries.A;
  assert.deepEqual(baseline.checkedNames, ['alpha', 'beta']);
  // This exact source already passed earlier; compare against the latest names anyway.
  write(dir, 'scripts/_test-A.js', `${script}\nconsole.log('PASS: alpha');\n`);
  const missing = run(dir, ['--changed']);
  assert.equal(missing.status, 1); assert.match(missing.stdout, /WEAKENED:A.*name: beta/);
  for (const field of ['checkedNames', 'contractItems', 'passHistory']) assert.deepEqual(readJson(mapFile(dir)).entries.A[field], baseline[field]);
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ A: { names: ['alpha'], reason: 'Wrong name' } }));
  assert.equal(run(dir, ['--failed']).status, 1);
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ A: { names: ['beta'], reason: 'Case moved' } }));
  const approved = run(dir, ['--failed']);
  assert.equal(approved.status, 0); assert.match(approved.stdout, /Approved drops: A \(name: beta\) — Case moved/);
  assert.deepEqual(readJson(mapFile(dir)).entries.A.checkedNames, ['alpha']);
  updateManifest(dir, m => { delete m.checkedPattern; });
  write(dir, 'scripts/_test-A.js', script);
  assert.equal(run(dir, ['A']).status, 0, 'no pattern means no name comparison, even with prior names');
});
check('combined contract and name drops apply only when both approvals cover the missing obligations', () => {
  const dir = fixture('combined-drops', [entry('A', { contract: { exitCode: 0, forbiddenChanges: ['optional.data'] } })]);
  updateManifest(dir, m => { m.checkedPattern = '^PASS: (.+)$'; });
  const script = fs.readFileSync(path.join(dir, 'scripts/_test-A.js'), 'utf8');
  write(dir, 'scripts/_test-A.js', `${script}\nconsole.log('PASS: former');\n`);
  assert.equal(run(dir).status, 0);
  const baseline = readJson(mapFile(dir)).entries.A;
  write(dir, 'scripts/_test-A.js', script);
  updateManifest(dir, m => { m.entries[0].contract.forbiddenChanges = []; });
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ A: { contract: ['forbid:optional.data'], reason: 'Partial approval' } }));
  const partial = run(dir, ['--changed']);
  assert.equal(partial.status, 1); assert.match(partial.stdout, /WEAKENED:A.*name: former/);
  assert.doesNotMatch(partial.stdout, /Approved drops:/);
  for (const field of ['contractItems', 'checkedNames', 'passHistory']) assert.deepEqual(readJson(mapFile(dir)).entries.A[field], baseline[field]);
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ A: { contract: ['forbid:optional.data'], names: ['former'], reason: 'Both moved' } }));
  const approved = run(dir, ['--failed']);
  assert.equal(approved.status, 0); assert.match(approved.stdout, /Approved drops: A \(contract: forbid:optional.data; name: former\) — Both moved/);
  assert.deepEqual(readJson(mapFile(dir)).entries.A.checkedNames, []);
});
check('writing a stale map preserves retirement from disk and reports every applied removal approval', () => {
  const { writeMap } = require('../skills/verifying/scripts/runner/store');
  const dir = fixture('retired-merge', [entry('A'), entry('B')]);
  assert.equal(run(dir).status, 0);
  const old = readJson(mapFile(dir));
  updateManifest(dir, m => { m.entries = []; });
  assert.equal(run(dir, ['--changed']).status, 1);
  const disk = readJson(mapFile(dir));
  // A stale writer with no entries of its own must still retain the disk's retired records.
  assert(writeMap({ manifestPath: manifestFile(dir), startedAt: new Date().toISOString(), snapshot: disk.snapshot,
    records: {}, previousRecords: {}, readWriteId: old.writeId, ids: [] }));
  assert.deepEqual(readJson(mapFile(dir)).retired, disk.retired);
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ A: { reason: 'First replacement' }, B: { reason: 'Second replacement' } }));
  const approved = run(dir, ['--changed']);
  assert.equal(approved.status, 0);
  assert.match(approved.stdout, /Approved drops: A \(removed check\) — First replacement/);
  assert.match(approved.stdout, /Approved drops: B \(removed check\) — Second replacement/);
  assert.deepEqual(readJson(mapFile(dir)).retired, {});
});
check('entry and discovery checkedPattern overrides use their declared capture, including null opt-out', () => {
  const dir = fixture('checked-pattern-overrides', [entry('A'), entry('B')]);
  updateManifest(dir, m => {
    m.checkedPattern = '^PASS: (.+)$';
    m.entries = [entry('B', { checkedPattern: null }), { id: 'D', type: 'structural', discover: { pattern: 'scripts/_test-*.js' }, checkedPattern: '^CASE (?<name>.+)$', contract: { exitCode: 0 } }];
  });
  fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), "\nconsole.log('CASE chosen'); console.log('PASS: ignored'); console.error('CASE stderr-only');\n");
  fs.appendFileSync(path.join(dir, 'scripts/_test-B.js'), "\nconsole.log('PASS: disabled');\n");
  assert.equal(run(dir).status, 0);
  const records = readJson(mapFile(dir)).entries;
  assert.deepEqual(records['D:scripts/_test-A.js'].checkedNames, ['chosen']);
  assert(!Object.hasOwn(records.B, 'checkedNames'));
});
check('legacy records without drop baselines accept their first executed pass', () => {
  const dir = fixture('legacy-drop-baseline');
  updateManifest(dir, m => { m.checkedPattern = '^PASS: (.+)$'; });
  fs.appendFileSync(path.join(dir, 'scripts/_test-A.js'), "\nconsole.log('PASS: current');\n");
  assert.equal(run(dir).status, 0);
  const map = readJson(mapFile(dir));
  delete map.entries.A.contractItems; delete map.entries.A.checkedNames;
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  const result = run(dir, ['A']);
  assert.equal(result.status, 0); assert.doesNotMatch(result.stdout, /WEAKENED:/);
  assert.deepEqual(readJson(mapFile(dir)).entries.A.contractItems, ['exitCode:0']);
  assert.deepEqual(readJson(mapFile(dir)).entries.A.checkedNames, ['current']);
});
check('malformed drop approvals fail as RUNNER errors before checks or map changes', () => {
  const dir = fixture('bad-drop-approvals');
  assert.equal(run(dir).status, 0);
  const saved = fs.readFileSync(mapFile(dir));
  const before = counter(dir);
  for (const invalid of ['{', '[]', '{"A":{"reason":" "}}', '{"A":{"reason":"ok","names":"alpha"}}', '{"A":{"reason":"ok","name":["alpha"]}}']) {
    write(dir, '.crabshell/verification/dropped-checks.json', invalid);
    const result = run(dir, ['A']);
    assert.equal(result.status, 1); assert.match(result.stdout, /RUNNER_DROPPED_CHECKS.*dropped-checks.json/);
    assert.equal(counter(dir), before); assert(fs.readFileSync(mapFile(dir)).equals(saved));
  }
});
check('invalid checkedPattern declarations fail before executing', () => {
  const dir = fixture('bad-checked-pattern');
  for (const pattern of ['[', '^PASS$', '(a)(b)', 3]) {
    updateManifest(dir, m => { m.checkedPattern = pattern; });
    const result = run(dir, ['A']);
    assert.equal(result.status, 1); assert.match(result.stdout, /RUNNER_MANIFEST.*checkedPattern/);
    assert.equal(counter(dir), 0);
  }
});
check('quarantine expiry selects unchanged checks, explains why and clears after a successful execution', () => {
  const { hashBuffer } = require('../skills/verifying/scripts/runner/fingerprint');
  const dir = fixture('quarantine-expiry', [entry('A'), entry('B'), entry('C')]);
  assert.equal(run(dir).status, 0);
  const mark = (id, ageDays) => {
    const map = readJson(mapFile(dir));
    const test = `scripts/_test-${id}.js`;
    map.entries[id].quarantine = { at: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString(), test, testHash: hashBuffer(fs.readFileSync(path.join(dir, test))) };
    fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  };
  mark('A', 31); mark('B', 2); mark('C', 8);
  const before = ['A', 'B', 'C'].map(id => counter(dir, id));
  const explainDefault = run(dir, ['--explain']);
  assert.match(explainDefault.stdout, /A: flaky quarantine expired after 30 days/);
  assert.match(explainDefault.stdout, /Left out as flaky:.*B.*C/);
  updateManifest(dir, m => { m.quarantineDays = 7; });
  const explain = run(dir, ['--explain']);
  assert.match(explain.stdout, /C: flaky quarantine expired after 7 days/);
  const result = run(dir, ['--changed']);
  assert.equal(result.status, 0); assert.match(result.stdout, /A: flaky quarantine expired after 7 days/);
  assert.match(result.stdout, /C: flaky quarantine expired after 7 days/);
  assert.deepEqual(['A', 'B', 'C'].map(id => counter(dir, id)), [before[0] + 1, before[1], before[2] + 1]);
  const records = readJson(mapFile(dir)).entries;
  assert(!records.A.quarantine); assert(records.B.quarantine); assert(!records.C.quarantine);
  assert.deepEqual(dry(dir).selected, []);
});
check('an approval on file is shown in every later run, not only in the run that applies it', () => {
  const dir = fixture('standing-approval', [entry('A'), entry('B')]);
  assert.equal(run(dir).status, 0);
  updateManifest(dir, m => { m.entries = m.entries.filter(item => item.id !== 'B'); });
  write(dir, '.crabshell/verification/dropped-checks.json', JSON.stringify({ B: { reason: 'Merged into A' } }));
  const applied = run(dir, ['--changed']);
  assert.equal(applied.status, 0); assert.match(applied.stdout, /Approved drops: B \(removed check\) — Merged into A/);
  const later = run(dir, ['--changed']);
  assert.equal(later.status, 0); assert.match(later.stdout, /Approval on file \(dropped-checks\.json\): B \(removed check\) — Merged into A/);
  assert.match(run(dir, ['--explain']).stdout, /Approval on file \(dropped-checks\.json\): B \(removed check\) — Merged into A/);
});
check('an expired quarantine does not bring a heavy check into a routine run', () => {
  const { hashBuffer } = require('../skills/verifying/scripts/runner/fingerprint');
  const dir = fixture('quarantine-expiry-slow', [entry('A'), entry('S', { slow: true })]);
  assert.equal(run(dir).status, 0);
  const map = readJson(mapFile(dir));
  const test = 'scripts/_test-S.js';
  map.entries.S.quarantine = { at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), test, testHash: hashBuffer(fs.readFileSync(path.join(dir, test))) };
  fs.writeFileSync(mapFile(dir), JSON.stringify(map));
  const before = counter(dir, 'S');
  const routine = run(dir, ['--changed']);
  assert.equal(routine.status, 0); assert.equal(counter(dir, 'S'), before);
  assert.doesNotMatch(routine.stdout, /S: flaky quarantine expired/);
});
report.finish();
