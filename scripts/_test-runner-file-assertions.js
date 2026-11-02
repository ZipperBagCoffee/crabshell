'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');
const source = process.env.CRABSHELL_TEST_RUNNER || path.join(__dirname, '../skills/verifying/scripts/run-verify.js');
const api = require(source);
const report = h.createReporter('runner-file-assertions');
const observation = (pattern, flags) => ({ kind: 'stdoutMatches', pattern, ...(flags === undefined ? {} : { flags }) });
const explicit = id => ({ id, type: 'structural', command: { file: 'node', args: [`scripts/_test-${id}.js`] }, contract: { exitCode: 0 } });
const discover = extra => ({ id: 'D', type: 'structural', discover: { pattern: 'scripts/_test-*.js', exclude: [] },
  contract: { exitCode: 0, assertions: [observation('common observation')] }, ...extra });
const write = (dir, file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
};
function run(dir, entries, args = []) {
  write(dir, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries }));
  const env = { ...process.env, PROJECT_ROOT: dir, CRABSHELL_VERIFY_JSON: '' };
  delete env.CRABSHELL_VERIFY_RUNNING;
  delete env.CLAUDE_PROJECT_DIR;
  const result = spawnSync(process.execPath, [path.join(dir, '.crabshell/verification/run-verify.js'), '--json', ...args], {
    cwd: dir, env, encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  if (result.error) throw result.error;
  const match = result.stdout.match(/^\[\]$|^\[\r?\n[\s\S]*?\r?\n\]$/m);
  assert(match, result.stdout + result.stderr);
  return { ...result, results: JSON.parse(match[0]) };
}
const count = (dir, id) => {
  try { return fs.readFileSync(path.join(dir, `node_modules/${id}`), 'utf8').length; }
  catch (_) { return 0; }
};
function check(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-file-assertions-'));
  try {
    for (const id of ['A', 'B']) write(dir, `scripts/_test-${id}.js`, [
      "const fs = require('fs');",
      "fs.mkdirSync('node_modules', { recursive: true });",
      `fs.appendFileSync('node_modules/${id}', 'x');`,
      `console.log('common observation\\n${id} observation');`,
      "console.error('stderr-only observation');",
    ].join('\n'));
    write(dir, '.crabshell/verification/run-verify.js', fs.readFileSync(source));
    fn(dir);
    report.check(name, true);
  } catch (error) { report.check(name, false, error.stack); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

check('stdoutMatches matches stdout with optional flags and reports the missing regex exactly', dir => {
  const entry = explicit('A');
  entry.contract.assertions = [observation('^A observation$', 'm'), observation('a OBSERVATION', 'i')];
  assert.equal(run(dir, [entry]).status, 0);
  for (const pattern of ['missing observation', 'stderr-only observation']) {
    entry.contract.assertions = [observation(pattern)];
    const result = run(dir, [entry]);
    assert.equal(result.status, 1);
    assert.equal(result.results[0].observation.exitCode, 0);
    // The runner appends the command's stderr after the assertion message.
    assert.equal(String(result.results[0].error).split('; stderr: ')[0], `stdout: expected /${pattern}/`);
  }
});

check('fileAssertions appends only to its file and accepts either slash style', dir => {
  const entry = discover({ fileAssertions: {
    'scripts\\_test-A.js': [observation('A observation')],
    'scripts/_test-B.js': [observation('B observation')],
  } });
  const expanded = api.expandEntries({ entries: [entry] }, dir);
  assert.deepEqual(expanded.map(item => item.contract.assertions.map(item => item.pattern)), [
    ['common observation', 'A observation'], ['common observation', 'B observation'],
  ]);
  assert.deepEqual(entry.contract.assertions, [observation('common observation')], 'template is not mutated');
  assert.equal(run(dir, [entry]).status, 0);
  entry.fileAssertions['scripts\\_test-A.js'] = [observation('missing A observation')];
  const result = run(dir, [entry]);
  assert.equal(result.status, 1);
  assert.deepEqual(result.results.map(item => [item.id, item.status]), [
    ['D:scripts/_test-A.js', 'FAIL'], ['D:scripts/_test-B.js', 'PASS'],
  ]);
  assert.equal(count(dir, 'A'), 2);
  // B's own assertions did not change, so its earlier pass is reused (keys are per file).
  assert.equal(result.results[1].reused, true);
  assert.equal(count(dir, 'B'), 1);
});

check('slash aliases of one file append both assertion lists without dropping a check', dir => {
  const result = run(dir, [discover({ fileAssertions: {
    'scripts/_test-A.js': [observation('A observation')],
    'scripts\\_test-A.js': [observation('missing second observation')],
  } })]);
  assert.equal(result.status, 1);
  assert.equal(result.results[0].observation.assertions.length, 3);
  assert.equal(String(result.results[0].error).split('; stderr: ')[0], 'stdout: expected /missing second observation/');
});

for (const [name, change, file] of [
  ['unknown', () => {}, 'scripts/_test-missing.js'],
  ['excluded', entry => { entry.discover.exclude = [{ file: 'scripts/_test-A.js', reason: 'fixture' }]; }, 'scripts/_test-A.js'],
  ['explicitly owned', () => {}, 'scripts/_test-A.js'],
]) check(`fileAssertions rejects ${name} file before any command runs`, dir => {
  const entry = discover({ fileAssertions: { [file]: [observation('observation')] } });
  change(entry);
  const entries = name === 'explicitly owned' ? [explicit('A'), entry] : [explicit('VALID'), entry];
  // A preceding valid command must not run before the later discovery error.
  entries[0].command.args = ['-e', "require('fs').writeFileSync('ran-first', 'yes')"];
  if (name === 'explicitly owned') entries[0] = explicit('A');
  const result = run(dir, entries);
  assert.equal(result.status, 1);
  assert.equal(result.results[0].id, 'RUNNER_DISCOVERY');
  assert(result.results[0].error.includes('D'));
  assert(result.results[0].error.includes(file));
  assert.equal(count(dir, 'A'), 0); assert.equal(count(dir, 'B'), 0);
  assert(!fs.existsSync(path.join(dir, 'ran-first')));
});

for (const assertion of [observation('['), observation('ok', 'invalid'), observation(3), observation('ok', null)]) {
  for (const perFile of [false, true]) check(`invalid stdoutMatches ${JSON.stringify(assertion)} in ${perFile ? 'fileAssertions' : 'contract'} is rejected before commands`, dir => {
    const entry = perFile ? discover({ fileAssertions: { 'scripts/_test-B.js': [assertion] } }) : explicit('B');
    if (!perFile) entry.contract.assertions = [assertion];
    const entries = [explicit('A'), entry];
    // Selecting only a preceding valid entry still validates all patterns.
    const result = run(dir, entries, ['A']);
    assert.equal(result.status, 1);
    assert.equal(result.results[0].id, 'RUNNER_DISCOVERY');
    assert.match(result.results[0].error, /stdoutMatches/);
    assert.equal(count(dir, 'A'), 0); assert.equal(count(dir, 'B'), 0);
  });
}

for (const fileAssertions of [null, [], { 'scripts/_test-A.js': 'not an array' }]) {
  check(`fileAssertions shape ${JSON.stringify(fileAssertions)} cannot silently discard assertions`, dir => {
    const result = run(dir, [discover({ fileAssertions })]);
    assert.equal(result.status, 1);
    assert.equal(result.results[0].id, 'RUNNER_DISCOVERY');
    assert.match(result.results[0].error, /fileAssertions/);
    assert.equal(count(dir, 'A'), 0); assert.equal(count(dir, 'B'), 0);
  });
}

check('coveredBy rejects per-file assertions before executing the covering command', dir => {
  const entry = discover({ contract: { exitCode: 0 }, coveredBy: { 'scripts/_test-A.js': 'B' },
    fileAssertions: { 'scripts/_test-A.js': [observation('A observation')] } });
  const result = run(dir, [explicit('B'), entry]);
  assert.equal(result.status, 1);
  assert.equal(result.results[0].id, 'RUNNER_DISCOVERY');
  assert.match(result.results[0].error, /D:scripts\/_test-A.js: coveredBy B.*contract.assertions/);
  assert.equal(count(dir, 'A'), 0); assert.equal(count(dir, 'B'), 0);
});
report.finish();
