'use strict';
// D143_T009: a check runs only when its inputs changed since it last passed, it failed
// last time, it is new, or it says reuse:false (the Bazel rule) — with or without git,
// whatever language the check is written in. Inputs are the files a Node check was
// traced reading, the files a check declares, or (when neither is known) every project
// file. Only the runner modules that decide results count as runner changes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const REPO = path.resolve(__dirname, '..');
const RUNNER = process.env.CRABSHELL_TEST_RUNNER || path.join(REPO, 'skills', 'verifying', 'scripts', 'run-verify.js');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-fingerprint-'));
const counters = path.join(base, 'counters');
fs.mkdirSync(counters);
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.log(`FAIL: ${name}${detail ? ` -- ${detail}` : ''}`); }
};
const attempt = (name, fn) => { try { fn(); } catch (error) { check(name, false, error.stack.split('\n').slice(0, 2).join(' ')); } };

const hasPython = spawnSync(PYTHON, ['--version'], { cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true }).status === 0;
const git = (dir, ...args) => spawnSync('git', ['-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', ...args], { cwd: dir, encoding: 'utf8', windowsHide: true });
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };

// Every check appends its id to a counter file outside the project, then reads its input.
const nodeCheck = (id, input, extra = '') => [
  "const fs = require('fs'); const path = require('path');",
  `fs.appendFileSync(path.join(process.env.FP_COUNTERS, process.env.FP_NAME + '.txt'), '${id}\\n');`,
  `const text = fs.readFileSync(path.join(process.env.PROJECT_ROOT, '${input}'), 'utf8');`,
  extra,
  "process.exit(text.includes('ok') ? 0 : 1);",
].join('\n') + '\n';
const pythonCheck = (id, input) => [
  'import os, sys',
  `open(os.path.join(os.environ["FP_COUNTERS"], os.environ["FP_NAME"] + ".txt"), "a").write("${id}\\n")`,
  `sys.exit(0 if "ok" in open("${input}").read() else 1)`,
].join('\n') + '\n';

function project(name, { withGit = false, entries }) {
  const dir = path.join(base, name);
  write(dir, 'src/a.txt', 'ok a\n');
  write(dir, 'src/b.txt', 'ok b\n');
  write(dir, 'src/c.txt', 'ok c\n');
  write(dir, 'docs/notes.md', 'notes\n');
  write(dir, 'scripts/_test-na.js', nodeCheck('NA', 'src/a.txt'));
  write(dir, 'scripts/_test-nb.js', nodeCheck('NB', 'src/b.txt'));
  write(dir, 'tools/check_py.py', pythonCheck('PY', 'src/c.txt'));
  write(dir, 'tools/check_uk.py', pythonCheck('UK', 'src/b.txt'));
  write(dir, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries }, null, 2));
  copyRunner(RUNNER, path.join(dir, '.crabshell', 'verification'));
  if (withGit) {
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'add', '-f', '.crabshell/verification');
    git(dir, 'commit', '-q', '-m', 'fixture');
  }
  return dir;
}
const NA = { id: 'NA', type: 'structural', command: { file: 'node', args: ['scripts/_test-na.js'] }, contract: { exitCode: 0 } };
const NB = { id: 'NB', type: 'structural', command: { file: 'node', args: ['scripts/_test-nb.js'] }, contract: { exitCode: 0 } };
const PY = { id: 'PY', type: 'structural', command: { file: PYTHON, args: ['-B', 'tools/check_py.py'] }, contract: { exitCode: 0 }, inputs: ['src/c.txt', 'tools/check_py.py'] };
const UK = { id: 'UK', type: 'structural', command: { file: PYTHON, args: ['-B', 'tools/check_uk.py'] }, contract: { exitCode: 0 } };

function run(dir, name, args = []) {
  fs.rmSync(path.join(counters, `${name}.txt`), { force: true });
  const env = { ...process.env, FP_COUNTERS: counters, FP_NAME: name, CRABSHELL_VERIFY_JSON: '' };
  for (const key of ['PROJECT_ROOT', 'CLAUDE_PROJECT_DIR', 'CRABSHELL_VERIFY_RUNNING']) delete env[key];
  const result = spawnSync(process.execPath, [path.join(dir, '.crabshell', 'verification', 'run-verify.js'), ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, env, timeout: 120000 });
  let ran = [];
  try { ran = fs.readFileSync(path.join(counters, `${name}.txt`), 'utf8').split(/\r?\n/).filter(Boolean).sort(); } catch (_) {}
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', ran };
}
const show = r => `status=${r.status} ran=[${r.ran}] ${r.stdout.slice(-240).replace(/\s+/g, ' ')}`;

try {
  for (const withGit of [false, true]) {
    const label = withGit ? 'git' : 'no git';
    attempt(`F1 ${label}: one changed input line runs only the checks that read it`, () => {
      const entries = hasPython ? [NA, NB, PY] : [NA, NB];
      const name = `f1-${withGit ? 'git' : 'nogit'}`;
      const dir = project(name, { withGit, entries });
      const first = run(dir, name);
      const quiet = run(dir, name, ['--changed']);
      write(dir, 'src/a.txt', 'ok a  # one line changed\n');
      const node = run(dir, name, ['--changed']);
      let python = { ran: ['PY'] };
      if (hasPython) { write(dir, 'src/c.txt', 'ok c  # one line changed\n'); python = run(dir, name, ['--changed']); }
      write(dir, 'docs/notes.md', 'notes changed\n');
      const unread = run(dir, name, ['--changed']);
      // A file nobody reads or declares runs the declared check once (D143_T010), never a
      // traced one.
      check(`F1 ${label}: one changed input line runs only the checks that read it`,
        first.status === 0 && first.ran.length === entries.length && quiet.ran.length === 0
        && node.ran.join(',') === 'NA' && python.ran.join(',') === 'PY' && unread.ran.join(',') === (hasPython ? 'PY' : ''),
        `first=${first.ran} quiet=${quiet.ran} node=${node.ran} python=${python.ran} unread=${unread.ran} ${show(node)}`);
    });
  }

  attempt('F2 an output-module edit reruns nothing; a deciding-module edit reruns everything', () => {
    const dir = project('f2', { entries: [NA, NB] });
    run(dir, 'f2');
    const runnerDir = path.join(dir, '.crabshell', 'verification', 'runner');
    fs.appendFileSync(path.join(runnerDir, 'output.js'), '\n// output wording changed\n');
    const afterOutput = run(dir, 'f2', ['--changed']);
    fs.appendFileSync(path.join(runnerDir, 'execute.js'), '\nmodule.exports.judgingMarker = 1;\n'); // D143_T020: a code line — comment lines do not count
    const afterExecute = run(dir, 'f2', ['--changed']);
    check('F2 an output-module edit reruns nothing; a deciding-module edit reruns everything',
      afterOutput.ran.length === 0 && afterExecute.ran.join(',') === 'NA,NB', `output=${show(afterOutput)} execute=${show(afterExecute)}`);
  });

  if (hasPython) attempt('F3 a check with unknown inputs runs when any project file changes and is named', () => {
    const dir = project('f3', { entries: [NA, UK] });
    run(dir, 'f3');
    const quiet = run(dir, 'f3', ['--changed']);
    write(dir, 'docs/notes.md', 'notes changed\n');
    const changed = run(dir, 'f3', ['--changed']);
    check('F3 a check with unknown inputs runs when any project file changes and is named',
      quiet.ran.length === 0 && changed.ran.join(',') === 'UK'
      && /Unknown inputs \(whole project used\): UK — declare "inputs" in the manifest/.test(changed.stdout), `quiet=${quiet.ran} ${show(changed)}`);
  });

  attempt('F4 content changed and changed back (A→B→A) is reused from the pass history', () => {
    const dir = project('f4', { entries: [NA] });
    run(dir, 'f4');
    write(dir, 'src/a.txt', 'ok a version two\n');
    const second = run(dir, 'f4', ['--changed']);
    write(dir, 'src/a.txt', 'ok a\n');
    const back = run(dir, 'f4', ['--changed']);
    check('F4 content changed and changed back (A→B→A) is reused from the pass history',
      second.ran.join(',') === 'NA' && back.ran.length === 0, `second=${second.ran} back=${show(back)}`);
  });

  attempt('F5 a pass whose input changed while it ran is not recorded, so it runs again', () => {
    const writer = { ...NB, command: { file: 'node', args: ['scripts/_test-writer.js'] } };
    const dir = project('f5', { entries: [NA, writer] });
    write(dir, 'scripts/_test-writer.js', nodeCheck('NB', 'src/b.txt', "fs.appendFileSync(path.join(process.env.PROJECT_ROOT, 'src/b.txt'), 'ok more\\n');"));
    run(dir, 'f5');
    const again = run(dir, 'f5', ['--changed']);
    check('F5 a pass whose input changed while it ran is not recorded, so it runs again', again.ran.join(',') === 'NB', show(again));
  });

  attempt('F6 a load map from an older runner reruns every check once, then follows the inputs', () => {
    const dir = project('f6', { entries: [NA, NB] });
    write(dir, '.crabshell/verification/test-map.json', JSON.stringify({ version: 2, createdAt: new Date().toISOString(), fileTimes: {}, fileHashes: {}, entries: {
      NA: { test: 'scripts/_test-na.js', files: ['src/a.txt'], passKey: 'old', passedAt: new Date().toISOString() },
      NB: { test: 'scripts/_test-nb.js', files: ['src/b.txt'], passKey: 'old', passedAt: new Date().toISOString() } } }));
    const once = run(dir, 'f6', ['--changed']);
    const then = run(dir, 'f6', ['--changed']);
    check('F6 a load map from an older runner reruns every check once, then follows the inputs',
      once.ran.join(',') === 'NA,NB' && then.ran.length === 0, `once=${show(once)} then=${then.ran}`);
  });

  attempt('F7 --dry-run keeps the fields installed guards read and names unknown inputs', () => {
    const dir = project('f7', { entries: [NA] });
    run(dir, 'f7');
    const result = run(dir, 'f7', ['--changed', '--dry-run']);
    const plan = JSON.parse(result.stdout);
    const fields = ['mode', 'full', 'reason', 'selected', 'total', 'reasons', 'wouldReuse', 'wouldCover', 'estimatedSeconds', 'failBeforeTargets', 'unknownInputs'];
    check('F7 --dry-run keeps the fields installed guards read and names unknown inputs',
      fields.every(field => Object.hasOwn(plan, field)) && Array.isArray(plan.unknownInputs), Object.keys(plan).join(','));
  });
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

if (!hasPython) console.log(`NOTE: ${PYTHON} is not available; the declared and unknown-input cases ran without their Python checks`);
console.log(`runner-fingerprint: ${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed ? 1 : 0);
