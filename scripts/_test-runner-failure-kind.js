'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');
const source = process.env.CRABSHELL_TEST_RUNNER || path.join(__dirname, '../skills/verifying/scripts/run-verify.js');
const report = h.createReporter('runner-failure-kind');
const write = (dir, file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
const git = (dir, ...args) => {
  const result = spawnSync('git', ['-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=',
    '-c', 'user.name=runner fixture', '-c', 'user.email=fixture@example.com', ...args], {
    cwd: dir, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_NAME: 'runner fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'runner fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com' },
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
};
const testFile = 'scripts/_test-A.js';
const mapFile = '.crabshell/verification/test-map.json';
const record = dir => JSON.parse(fs.readFileSync(path.join(dir, mapFile), 'utf8')).entries.A;
const count = dir => fs.readFileSync(path.join(dir, 'node_modules/count'), 'utf8').length;
function run(dir, args = []) {
  const env = { ...process.env, PROJECT_ROOT: dir, CRABSHELL_VERIFY_JSON: '' };
  delete env.CRABSHELL_VERIFY_RUNNING;
  delete env.CLAUDE_PROJECT_DIR;
  const result = spawnSync(process.execPath, [path.join(dir, '.crabshell/verification/run-verify.js'), '--json', ...args], {
    cwd: dir, env, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  if (result.error) throw result.error;
  if (args.includes('--dry-run')) return { ...result, plan: JSON.parse(result.stdout) };
  const match = result.stdout.match(/^\[\]$|^\[\r?\n[\s\S]*?\r?\n\]$/m);
  assert(match, result.stdout + result.stderr);
  return { ...result, results: JSON.parse(match[0]) };
}
function fixture(dir) {
  write(dir, '.gitignore', '.crabshell/\nnode_modules/\n');
  write(dir, 'input.data', 'old');
  write(dir, 'previous-only.data', 'retained dependency');
  write(dir, testFile, [
    "const fs = require('fs');",
    "fs.mkdirSync('node_modules', { recursive: true });",
    "fs.appendFileSync('node_modules/count', 'x');",
    "fs.readFileSync('input.data');",
    "fs.readFileSync('previous-only.data');",
    "console.log('observation');",
    '',
  ].join('\n'));
  write(dir, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries: [{
    id: 'A', type: 'structural', command: { file: 'node', args: [testFile] }, contract: { exitCode: 0 },
  }] }));
  copyRunner(source, path.join(dir, '.crabshell/verification'));
  git(dir, 'init', '-q');
  git(dir, 'add', '.');
  git(dir, 'add', '-f', '.crabshell/verification/manifest.json');
  git(dir, 'commit', '-q', '-m', 'baseline');
  assert.equal(run(dir).status, 0);
}
function failBefore(dir) {
  write(dir, 'input.data', 'new');
  fs.appendFileSync(path.join(dir, testFile), '// changed test still accepts old input\n');
  const result = run(dir, ['--changed', '--fail-before']);
  assert.equal(result.status, 1);
  assert.equal(result.results.find(item => item.id === 'A').status, 'PASS');
  assert.equal(result.results.find(item => item.id === 'FAIL_BEFORE:A').status, 'FAIL');
  const failed = record(dir);
  assert.equal(failed.lastFailedKind, 'fail-before');
  assert(Number.isFinite(Date.parse(failed.lastFailedAt)));
  assert(failed.failKey, 'a failure records the inputs it failed with');
  return failed;
}
function check(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-failure-kind-'));
  try { fixture(dir); fn(dir); report.check(name, true); }
  catch (error) { report.check(name, false, error.stack); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function retained(dir, before) {
  const after = record(dir);
  assert.equal(after.lastFailedAt, before.lastFailedAt);
  assert.equal(after.lastFailedKind, 'fail-before');
  assert.deepEqual(after.files, before.files);
  assert.equal(after.entryHash, before.entryHash);
  assert.equal(after.passedAt, before.passedAt, 'no new pass is recorded');
  const plan = run(dir, ['--changed', '--no-fail-before', '--dry-run']).plan;
  assert(plan.selected.includes('A'));
  assert.equal(plan.reasons.A, 'failed in the last run');
}
function cleared(dir) {
  const after = record(dir);
  assert(!Object.hasOwn(after, 'lastFailedAt'));
  assert(!Object.hasOwn(after, 'lastFailedKind'));
}

for (const [name, args] of [
  ['explicit-id PASS', ['A']],
  ['changed no-fail-before PASS', ['--changed', '--no-fail-before']],
  ['full no-fail-before PASS', ['--no-fail-before']],
  ['full PASS without comparison', []],
  // A hand-picked --files list can leave out the test or its source (Fable, D139).
  ['changed --files test-only PASS', ['--changed', '--files', testFile]],
  ['changed --files source-only PASS', ['--changed', '--files', 'input.data']],
]) check(`fail-before mark survives ${name} with old files and no pass key`, dir => {
  const before = failBefore(dir);
  write(dir, testFile, fs.readFileSync(path.join(dir, testFile), 'utf8').replace("fs.readFileSync('previous-only.data');\n", ''));
  const executions = count(dir);
  const result = run(dir, args);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(count(dir), executions + 1, 'must be an executed PASS');
  assert(!result.results[0].reused && !result.results[0].coveredBy);
  retained(dir, before);
});

check('fail-before mark clears when the changed test fails on HEAD and passes now', dir => {
  failBefore(dir);
  fs.appendFileSync(path.join(dir, testFile), "if (fs.readFileSync('input.data', 'utf8') !== 'new') process.exit(1);\n");
  const result = run(dir, ['--changed', '--fail-before']);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.results.find(item => item.id === 'FAIL_BEFORE:A').status, 'PASS');
  cleared(dir);
});

for (const action of ['commit', 'revert']) check(`fail-before mark clears when ${action} removes the comparison target`, dir => {
  failBefore(dir);
  if (action === 'commit') { git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'accept behavior-preserving change'); }
  else git(dir, 'checkout', '--', 'input.data', testFile);
  const executions = count(dir);
  const result = run(dir, ['--changed', '--fail-before']);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(count(dir), executions + 1);
  assert(!result.results.some(item => item.id.startsWith('FAIL_BEFORE:')));
  cleared(dir);
});

check('hash-matched exemption clears a fail-before mark; stale exemption does not', dir => {
  failBefore(dir);
  const exemptionFile = '.crabshell/verification/fail-before-exempt.json';
  write(dir, exemptionFile, JSON.stringify({ [testFile]: { sha256: 'stale', reason: 'behavior-preserving fixture' } }));
  assert.equal(run(dir, ['--changed', '--fail-before']).status, 1);
  assert.equal(record(dir).lastFailedKind, 'fail-before');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, testFile))).digest('hex');
  write(dir, exemptionFile, JSON.stringify({ [testFile]: { sha256, reason: 'behavior-preserving fixture' } }));
  const result = run(dir, ['--changed', '--fail-before']);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.results.find(item => item.id === 'FAIL_BEFORE:A').message, /^exempt:/);
  cleared(dir);
});

check('manual HEAD comparison preserves a fail-before mark', dir => {
  const before = failBefore(dir);
  // Make the HEAD test fail while leaving the working test passing.
  const working = fs.readFileSync(path.join(dir, testFile), 'utf8');
  write(dir, testFile, working + 'process.exit(1);\n');
  git(dir, 'add', testFile); git(dir, 'commit', '-q', '-m', 'failing HEAD baseline');
  write(dir, testFile, working);
  const result = run(dir, ['--changed', '--fail-before']);
  assert.equal(result.results.find(item => item.id === 'FAIL_BEFORE:A').status, 'manual');
  retained(dir, before);
});

check('unknown Git diff cannot clear a fail-before mark', dir => {
  const before = failBefore(dir);
  fs.renameSync(path.join(dir, '.git'), path.join(dir, 'saved-git'));
  const result = run(dir, ['--changed', '--fail-before']);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /git diff failed/);
  const after = record(dir);
  assert.equal(after.lastFailedKind, before.lastFailedKind);
  assert.equal(after.lastFailedAt, before.lastFailedAt);
  assert.deepEqual(after.files, before.files);
  assert.equal(after.passedAt, before.passedAt, 'no new pass is recorded');
});

for (const args of [['A'], ['--no-fail-before'], ['--changed', '--no-fail-before']]) {
  check(`check failure wins over a prior fail-before mark and clears on executed ${args.join(' ')} PASS`, dir => {
    failBefore(dir);
    const working = fs.readFileSync(path.join(dir, testFile), 'utf8');
    write(dir, testFile, working + 'process.exit(1);\n');
    assert.equal(run(dir, ['--changed', '--fail-before']).status, 1);
    const failed = record(dir);
    assert.equal(failed.lastFailedKind, 'check');
    assert(failed.failKey, 'a failure records the inputs it failed with');
    write(dir, testFile, working);
    const executions = count(dir);
    assert.equal(run(dir, args).status, 0);
    assert.equal(count(dir), executions + 1);
    cleared(dir);
  });
}
report.finish();
