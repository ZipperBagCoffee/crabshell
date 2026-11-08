'use strict';
// D143_T020: the runner's decision code enters every fingerprint, but a release that only
// changes comment lines, blank lines or trailing spaces in those modules must not rerun
// every check in every project. Any change to a code line (a string, an end-of-line
// comment, code after a block comment) still counts. When the decision code did change,
// the reason says so, and --explain explains it once. D152 P6: the decision code is whole
// modules (DECISION_MODULES) and parts of others hashed by source text (DECISION_PARTS);
// P27 and P34 in _test-runner-policy.js run it through the runner.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { codeText, DECISION_MODULES, DECISION_PARTS, partSource } = require('../skills/verifying/scripts/runner/layout');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const RUNNER = path.join(__dirname, '..', 'skills', 'verifying', 'scripts', 'run-verify.js');
const MODULES = path.join(path.dirname(RUNNER), 'runner');
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}

const BASE = [
  "'use strict';",
  '// What the module decides.',
  '',
  "const a = 'x // not a comment';   ",
  '/* a block',
  '   still the block */',
  'function f() { return a; } // tail',
  'const t = `line one',
  '// inside a template literal',
  '`;',
].join('\n');

test('comment lines, blank lines and trailing spaces do not change the code text', () => {
  const edited = BASE.replace('// What the module decides.', '// What the module decides, said better.\n\n// Another note.')
    .replace('/* a block\n   still the block */', '/* a longer block\n   of explanation\n */').replace("';   ", "';") + '\n\n';
  assert.strictEqual(codeText(edited), codeText(BASE));
});

test('a changed string, end-of-line comment, template line or code after a block comment changes it', () => {
  for (const edited of [
    BASE.replace("'x // not a comment'", "'y // not a comment'"),
    BASE.replace('// tail', '// tail changed'),
    BASE.replace('// inside a template literal', '// inside a template literal, changed'),
    BASE.replace('   still the block */', '   still the block */ const extra = 1;'),
  ]) assert.notStrictEqual(codeText(edited), codeText(BASE), edited);
});

test('the decision modules give the same code text twice, and it differs from their bytes only by dropped lines', () => {
  assert.ok(DECISION_MODULES.length >= 2, DECISION_MODULES.join(','));
  for (const name of DECISION_MODULES) {
    const text = fs.readFileSync(path.join(MODULES, name), 'utf8');
    assert.strictEqual(codeText(text), codeText(text), name);
    for (const line of codeText(text).split('\n')) assert.ok(text.includes(line), `${name}: a kept line is not in the file: ${line}`);
  }
});

test('every decision part names an export of its module, and a function part is that module\'s own source text', () => {
  assert.ok(DECISION_PARTS.length > 0);
  for (const [module, name] of DECISION_PARTS) {
    const source = partSource(MODULES, module, name);
    assert.ok(typeof source === 'string' && source.length > 0, `${module} ${name}`);
    if (typeof require(path.join(MODULES, module))[name] === 'function') {
      assert.ok(fs.readFileSync(path.join(MODULES, module), 'utf8').includes(source), `${module} ${name}: not its source text`);
    }
  }
});

// Through the runner: a copy whose decision module gains only a comment reuses every
// pass; one whose code changes reruns with the decision-code reason.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-decision-code-'));
const write = (rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
write('src/a.js', 'module.exports = 1;\n');
write('checks/a.js', "require('assert').ok(require('../src/a.js'));\n");
write('.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries: [{ id: 'A', type: 'structural', command: { file: 'node', args: ['checks/a.js'] }, contract: { exitCode: 0 } }] }));
copyRunner(RUNNER, path.join(root, '.crabshell', 'verification'));
const run = args => {
  const env = { ...process.env, CRABSHELL_VERIFY_JSON: '' };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  return spawnSync(process.execPath, [path.join(root, '.crabshell', 'verification', 'run-verify.js'), ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
};
const copiedModule = path.join(root, '.crabshell', 'verification', 'runner', DECISION_MODULES[0]);
assert.strictEqual(run([]).status, 0);

test('a comment-only change to a decision module reuses every pass', () => {
  fs.appendFileSync(copiedModule, '\n// A note added by a release.\n');
  assert.deepStrictEqual(JSON.parse(run(['--changed', '--dry-run']).stdout).selected, []);
});

test('a code change to a decision module reruns with the decision-code reason, explained once', () => {
  fs.appendFileSync(copiedModule, 'module.exports.releaseMarker = 1;\n');
  const plan = JSON.parse(run(['--changed', '--dry-run']).stdout);
  assert.deepStrictEqual(plan.selected, ['A']);
  assert.ok(/decision code changed/.test(plan.reasons.A), plan.reasons.A);
  const explained = run(['--explain']).stdout;
  assert.strictEqual((explained.match(/every non-slow check runs once/g) || []).length, 1, explained);
});

try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
