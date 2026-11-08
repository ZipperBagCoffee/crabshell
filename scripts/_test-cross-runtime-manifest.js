'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');
const root = path.resolve(__dirname, '..');
const runner = require(process.env.CRABSHELL_TEST_RUNNER || '../skills/verifying/scripts/run-verify');
const script = process.env.CRABSHELL_TEST_CROSS_RUNTIME || path.join(__dirname, 'verify-cross-runtime.js');
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.crabshell/verification/manifest.json'), 'utf8'));
const entry = manifest.entries.find(item => item.id === 'V059');
const report = h.createReporter('cross-runtime-manifest');
const check = (name, fn) => {
  try { fn(); report.check(name, true); }
  catch (error) { report.check(name, false, error.stack); }
};

// The named observations live in the manifest's V059 fileAssertions (verify-cross-runtime.js
// reads them from there; the next check confirms it), and each child check fails when its
// test stops printing one. This check is about the runner: every file with named
// observations becomes its own V059 check that carries them. It takes them from the
// manifest instead of a copied list (D151_T005), so removing an observation on purpose
// is a manifest edit only.
check('V059 runs each file with named observations as its own check, carrying them; V013 is gone', () => {
  assert(!manifest.entries.some(item => item.id === 'V013'));
  const named = Object.entries(entry.fileAssertions || {});
  assert(named.length > 0, 'V059 has no named observations');
  const expanded = runner.expandEntries(manifest, root);
  for (const [file, assertions] of named) {
    for (const assertion of assertions) {
      assert.equal(assertion.kind, 'stdoutMatches', file);
      assert.equal(assertion.flags || '', '', file);
    }
    const child = expanded.find(item => item.id === `V059:${file}`);
    assert(child, file);
    assert(!child.coveredBy, file);
    const patterns = child.contract.assertions.map(assertion => assertion.pattern);
    assert.deepEqual(assertions.map(assertion => assertion.pattern).filter(pattern => !patterns.includes(pattern)), [], file);
    for (const forbidden of entry.contract.forbiddenChanges || []) assert(child.contract.forbiddenChanges.includes(forbidden), file);
  }
  const failOpen = expanded.find(item => item.id === 'V059:scripts/_test-fail-open-edge-cases.js');
  assert(failOpen && !failOpen.coveredBy);
  assert.deepEqual(failOpen.contract.assertions, []);
});

check('exported manual plan matches the manifest with 11 suites and fail-open isolated last', () => {
  const { suites, validatePlan, runSuite, runAll } = require('./verify-cross-runtime');
  assert.equal(typeof runSuite, 'function'); assert.equal(typeof runAll, 'function');
  assert.equal(suites.length, 11);
  assert.deepEqual(suites.slice(0, -1).map(suite => ({
    file: `scripts/${suite.file}`,
    assertions: suite.observations.map(pattern => ({ kind: 'stdoutMatches', pattern: pattern.source, flags: pattern.flags })),
  })), Object.entries(entry.fileAssertions).map(([file, assertions]) => ({
    file, assertions: assertions.map(assertion => ({ ...assertion, flags: assertion.flags || '' })),
  })));
  assert.equal(suites.at(-1).file, '_test-fail-open-edge-cases.js');
  assert.equal(suites.at(-1).isolatedLast, true);
  assert.deepEqual(suites.at(-1).observations, []);
  assert.equal(validatePlan(), true);
  assert.throws(() => validatePlan([...suites].reverse()), /single isolated last/);
  assert.throws(() => validatePlan([...suites, suites.at(-1)]), /single isolated last/);
  assert.throws(() => validatePlan(suites.map((suite, i) => i ? suite : { ...suite, verdict: 'PASS' })), /PASS text/);
});

check('manual CLI and exports follow changed manifest files and regexes without consumer edits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-cross-runtime-manifest-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.crabshell/verification'), { recursive: true });
    const target = path.join(dir, 'scripts/verify-cross-runtime.js');
    fs.copyFileSync(script, target);
    const initialScript = fs.readFileSync(target);
    const file = 'scripts/_test-manifest-probe.js';
    fs.writeFileSync(path.join(dir, file), "console.log('observed marker');\n");
    fs.writeFileSync(path.join(dir, 'scripts/_test-fail-open-edge-cases.js'), "console.log('isolated');\n");
    const fixtureManifest = { entries: [{ id: 'V059', fileAssertions: {
      [file]: [{ kind: 'stdoutMatches', pattern: '^OBSERVED marker$', flags: 'im' }],
    } }] };
    const save = () => fs.writeFileSync(path.join(dir, '.crabshell/verification/manifest.json'), JSON.stringify(fixtureManifest));
    const cli = (args = ['--json']) => {
      const result = spawnSync(process.execPath, [target, ...args], {
        cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 30000,
      });
      if (result.error) throw result.error;
      return result;
    };
    save();
    let result = cli();
    assert.equal(result.status, 0, result.stderr + result.stdout);
    let output = JSON.parse(result.stdout);
    assert.equal(output.passed, true);
    assert.deepEqual(output.suites.map(suite => suite.file), ['_test-manifest-probe.js', '_test-fail-open-edge-cases.js']);
    assert.equal(output.coverage.failOpenIsolatedLast, true);
    assert.match(cli([]).stdout, /OK _test-manifest-probe.js[\s\S]*OK cross-runtime behavioral verification/);

    fixtureManifest.entries[0].fileAssertions[file][0].pattern = 'missing observation';
    save();
    result = cli();
    assert.equal(result.status, 1);
    output = JSON.parse(result.stdout);
    assert.equal(output.passed, false);
    assert.deepEqual(output.suites[0].missingObservations, ['missing observation']);
    assert.equal(output.suites[1].passed, true, 'later checks still run after an observation failure');

    const renamed = 'scripts/_test-renamed-probe.js';
    fs.renameSync(path.join(dir, file), path.join(dir, renamed));
    fixtureManifest.entries[0].fileAssertions = {
      [renamed.replace(/\//g, '\\')]: [{ kind: 'stdoutMatches', pattern: 'observed marker', flags: 'g' }],
    };
    save();
    result = cli();
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(JSON.parse(result.stdout).suites[0].file, '_test-renamed-probe.js');
    const api = require(target);
    assert.equal(api.validatePlan(), true);
    assert.equal(api.runSuite(api.suites[0]).passed, true);
    assert.equal(api.runSuite(api.suites[0]).passed, true, 'global regex cannot retain lastIndex between runs');
    assert.equal(api.runAll().passed, true);
    fs.writeFileSync(path.join(dir, renamed), "console.log('observed marker'); process.exitCode = 1;\n");
    assert.equal(api.runSuite(api.suites[0]).passed, false, 'matching text cannot hide a nonzero exit');
    assert(fs.readFileSync(target).equals(initialScript), 'consumer code was not edited');
    delete require.cache[require.resolve(target)];
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
report.finish();

