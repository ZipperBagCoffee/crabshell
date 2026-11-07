'use strict';
// D143_T019: a changed file that now requires a new file. The check that read the changed
// file is selected; after it runs, its record holds the new file too, so a later change to
// the new file alone selects it.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const RUNNER = path.join(__dirname, '..', 'skills', 'verifying', 'scripts', 'run-verify.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-new-file-input-'));
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}
const write = (rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
function run(args) {
  const env = { ...process.env, CRABSHELL_VERIFY_JSON: '' };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  const result = spawnSync(process.execPath, [path.join(root, '.crabshell', 'verification', 'run-verify.js'), ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  return result;
}
const selected = () => JSON.parse(run(['--changed', '--dry-run']).stdout).selected;
const record = id => JSON.parse(fs.readFileSync(path.join(root, '.crabshell', 'verification', 'test-map.json'), 'utf8')).entries[id];

write('lib/x.js', 'module.exports = 1;\n');
write('lib/other.js', 'module.exports = 2;\n');
write('checks/a.js', "require('assert').ok(require('../lib/x.js'));\n");
write('checks/b.js', "require('assert').ok(require('../lib/other.js'));\n");
write('.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries: ['a', 'b'].map(name => ({
  id: name.toUpperCase(), type: 'structural', command: { file: 'node', args: [`checks/${name}.js`] }, contract: { exitCode: 0 } })) }, null, 2));
copyRunner(RUNNER, path.join(root, '.crabshell', 'verification'));
assert.strictEqual(run([]).status, 0);

write('lib/y.js', 'module.exports = 3;\n');
write('lib/x.js', "module.exports = require('./y.js');\n");
test('the check that read the changed file is selected, and only it', () => {
  assert.deepStrictEqual(selected(), ['A']);
});

test('after it runs, its record holds the new file', () => {
  assert.strictEqual(run(['--changed']).status, 0);
  assert.ok(record('A').files.includes('lib/y.js'), JSON.stringify(record('A').files));
});

test('a change to the new file alone selects that check', () => {
  write('lib/y.js', 'module.exports = 4;\n');
  assert.deepStrictEqual(selected(), ['A']);
});

try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
