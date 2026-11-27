'use strict';
// A temporary project with the verification runner installed, for runner tests: fixture
// files, a manifest, and helpers that run the project's own copy of the runner.
// Moved out of _test-runner-reuse.js (D187) so tests of one concern can live in their own file.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./hook-harness');
const source = process.env.CRABSHELL_TEST_RUNNER || path.join(__dirname, '..', '..', 'skills', 'verifying', 'scripts', 'run-verify.js');
const { copyRunner } = require('../../skills/verifying/scripts/runner/install');

// git in a fixture project, with a fixed author and no hooks or signing.
const git = (dir, ...args) => {
  const result = spawnSync('git', ['-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=',
    '-c', 'user.name=runner fixture', '-c', 'user.email=fixture@example.com', ...args], {
    cwd: dir, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, GIT_AUTHOR_NAME: 'runner fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'runner fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com' },
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout;
};
// The manifest's path inside a fixture project.
const manifestRelative = '.crabshell/verification/manifest.json';

// title: the work-root and report name of the test file that asks.
function createRunnerProject(title) {
  const root = h.makeWorkRoot(title);
  const report = h.createReporter(title);
  const check = (name, fn) => {
    try { fn(); report.check(name, true); }
    catch (error) { report.check(name, false, error.message); }
  };
  const write = (dir, file, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  };
  const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } };
  const entry = (id, extra = {}) => ({ id, type: 'structural', command: { file: 'node', args: [`scripts/_test-${id}.js`] }, contract: { exitCode: 0 }, timeout: 3000, ...extra });
  function fixture(name, entries = [entry('A')]) {
    const dir = path.join(root, name);
    write(dir, '.gitignore', '.crabshell/\ncounter*\n');
    write(dir, 'input.data', 'a');
    write(dir, 'optional.data', 'present');
    write(dir, 'notes/first', 'one');
    fs.mkdirSync(path.join(dir, 'node_modules', 'counters'), { recursive: true });
    for (const item of entries) write(dir, `scripts/_test-${item.id}.js`, [
      "const fs = require('fs');",
      // Execution counters are outputs, not inputs; keep them outside the tracer.
      "fs.mkdirSync('node_modules/counters', { recursive: true });",
      `fs.appendFileSync('node_modules/counters/${item.id}', 'x');`,
      "fs.readFileSync('input.data');",
      `if (process.env.FIXTURE_MUTATE === '${item.id}') fs.appendFileSync('input.data', 'changed during check');`,
      "fs.readdirSync('notes');",
      "fs.existsSync('optional.data');",
      "if (process.env.FIXTURE_HANG === '1') setInterval(() => {}, 1000);",
      "if (process.env.FIXTURE_FAIL === '1') { console.log('noise'); console.log('FAIL deliberate fixture failure'); console.log('FAIL later failure'); for (let i=1;i<=7;i++) console.error('detail '+i); process.exit(1); }",
      "console.log('PASS fixture');",
    ].join('\n'));
    write(dir, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries }));
    copyRunner(source, path.join(dir, '.crabshell/verification'));
    return dir;
  }
  const mapFile = dir => path.join(dir, '.crabshell/verification/test-map.json');
  const resultFile = dir => path.join(dir, '.crabshell/verification/last-run.json');
  const manifestFile = dir => path.join(dir, '.crabshell/verification/manifest.json');
  const counter = (dir, id = 'A') => { try { return fs.readFileSync(path.join(dir, 'node_modules', 'counters', id), 'utf8').length; } catch (_) { return 0; } };
  function run(dir, args = [], extraEnv = {}) {
    const env = { ...process.env, PROJECT_ROOT: dir, CRABSHELL_VERIFY_JSON: '', ...extraEnv };
    delete env.CLAUDE_PROJECT_DIR;
    delete env.CRABSHELL_VERIFY_RUNNING;
    const result = spawnSync(process.execPath, [path.join(dir, '.crabshell/verification/run-verify.js'), ...args], {
      cwd: dir, env, encoding: 'utf8', windowsHide: true, timeout: 30000,
    });
    if (result.error) throw result.error;
    // Reading old stdout too lets every assertion run against the HEAD runner.
    const match = (result.stdout || '').match(/^\[\]$|^\[\r?\n[\s\S]*?\r?\n\]$/m);
    return { ...result, results: match ? JSON.parse(match[0])
      : result.stdout.startsWith('No checks selected') ? [] : readJson(resultFile(dir)) || [] };
  }
  // D143_T009: checks are chosen by the content of their inputs, so a change is a real
  // edit. Each listed file (comma-separated) gets one more line, or is created when it
  // does not exist, for the dry run; afterwards its bytes are put back (or it is removed).
  const dry = (dir, files = null, args = []) => {
    const undo = [];
    for (const rel of (files ? files.split(',') : []).filter(Boolean)) {
      const file = path.join(dir, rel);
      if (fs.existsSync(file)) { undo.push([file, fs.readFileSync(file)]); fs.appendFileSync(file, '\n'); }
      else { undo.push([file, null]); write(dir, rel, 'new\n'); }
    }
    try {
      const result = run(dir, ['--changed', '--dry-run', ...args]);
      return JSON.parse(result.stdout);
    } finally {
      for (const [file, bytes] of undo) { if (bytes) fs.writeFileSync(file, bytes); else fs.rmSync(file, { force: true }); }
    }
  };
  const updateManifest = (dir, update) => {
    const manifest = readJson(manifestFile(dir));
    update(manifest);
    fs.writeFileSync(manifestFile(dir), JSON.stringify(manifest));
  };
  return { source, root, report, check, write, readJson, entry, fixture, mapFile, resultFile, manifestFile, counter, run, dry, updateManifest, git, manifestRelative };
}

module.exports = { createRunnerProject };
