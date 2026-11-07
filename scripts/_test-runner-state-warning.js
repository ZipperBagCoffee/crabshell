'use strict';
// D143_T017: a traced check that reads a file of the project's own Crabshell state (its
// storage folder outside the verification folder) reruns whenever that state changes.
// The runner names it at the end of the run, once per check, and keeps the file as an
// input. A same-named folder deeper in the project, a file inside the verification
// folder and a reused pass get no notice.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const RUNNER = path.join(__dirname, '..', 'skills', 'verifying', 'scripts', 'run-verify.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-state-warning-'));
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const reader = rel => `require('fs').readFileSync(require('path').join(process.env.PROJECT_ROOT, ${JSON.stringify(rel)}), 'utf8');\n`;
const entry = id => ({ id, type: 'structural', command: { file: 'node', args: [`checks/${id}.js`] }, contract: { exitCode: 0 } });

const root = path.join(base, 'project');
write(root, '.crabshell/memory/state.json', '{"turn":1}\n');
write(root, 'sub/.crabshell/memory/copy.json', '{}\n');
write(root, '.crabshell/verification/fixture.json', '{}\n');
write(root, 'src/a.txt', 'a\n');
write(root, 'checks/STATE.js', reader('.crabshell/memory/state.json') + reader('src/a.txt'));
write(root, 'checks/NESTED.js', reader('sub/.crabshell/memory/copy.json'));
write(root, 'checks/VERIFY.js', reader('.crabshell/verification/fixture.json'));
// Reads a state file and writes it again while it runs: its pass cannot be vouched for.
write(root, '.crabshell/memory/counter.json', '0\n');
write(root, 'checks/WRITER.js', reader('.crabshell/memory/counter.json')
  + "require('fs').writeFileSync(require('path').join(process.env.PROJECT_ROOT, '.crabshell/memory/counter.json'), String(Date.now()));\n");
write(root, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries: ['STATE', 'NESTED', 'VERIFY', 'WRITER'].map(entry) }, null, 2));
copyRunner(RUNNER, path.join(root, '.crabshell', 'verification'));

function run(args = []) {
  const env = { ...process.env, CRABSHELL_VERIFY_JSON: '' };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  return spawnSync(process.execPath, [path.join(root, '.crabshell', 'verification', 'run-verify.js'), ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 120000 });
}
const stateLines = output => output.split(/\r?\n/).filter(line => /read Crabshell state/.test(line));

const first = run();
test('a check that read the project\'s Crabshell state is named once, with the file', () => {
  assert.strictEqual(first.status, 0, first.stdout + first.stderr);
  const line = stateLines(first.stdout + first.stderr).find(text => /\bSTATE\b/.test(text));
  assert.ok(line && line.includes('.crabshell/memory/state.json'), first.stdout.slice(-400));
  assert.strictEqual(stateLines(first.stdout + first.stderr).filter(text => /\bSTATE\b/.test(text)).length, 1);
});

test('a same-named folder deeper in the project and a file in the verification folder are not named', () => {
  const lines = stateLines(first.stdout + first.stderr);
  assert.ok(!lines.some(line => /NESTED|VERIFY/.test(line)), lines.join(' | '));
});

test('the state file stays one of the check\'s inputs', () => {
  const map = JSON.parse(fs.readFileSync(path.join(root, '.crabshell', 'verification', 'test-map.json'), 'utf8'));
  assert.ok((map.entries.STATE.files || []).includes('.crabshell/memory/state.json'), JSON.stringify(map.entries.STATE.files));
});

// A file outside the snapshot has no earlier look; it counts as written during the run
// only when it was written after the run began.
const second = run(['--changed', '--dry-run']);
test('an unchanged state file does not keep its reader from being reused', () => {
  const plan = JSON.parse(second.stdout);
  assert.ok(!plan.selected.includes('STATE'), JSON.stringify(plan.reasons));
});

test('a check that wrote a state file it reads while it ran is not reused', () => {
  const plan = JSON.parse(second.stdout);
  assert.ok(plan.selected.includes('WRITER'), JSON.stringify(plan.reasons));
});

test('a reused pass is not named again', () => {
  const third = run(['--changed']);
  assert.strictEqual(third.status, 0, third.stdout + third.stderr);
  assert.ok(!stateLines(third.stdout + third.stderr).some(line => /\bSTATE\b/.test(line)), third.stdout.slice(-400));
});

try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
