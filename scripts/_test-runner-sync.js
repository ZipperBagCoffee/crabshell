'use strict';
// D143_T016: SessionStart keeps a project's runner copy current. A project with a manifest
// gets the plugin's runner/ modules when they differ (modules the plugin dropped are
// removed), and its launcher when the launcher is missing or is one Crabshell released
// (any past version, either line end). A launcher the user edited stays, and the session
// start context says so in one line. The plugin's own source project is skipped. Two
// session starts at once leave whole files. The released list comes from git history and
// holds the current launcher.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { copyRunner } = require('../skills/verifying/scripts/runner/install');

const scripts = __dirname;
const REPO = path.join(scripts, '..');
const LAUNCHER = path.join(REPO, 'skills', 'verifying', 'scripts', 'run-verify.js');
const MODULES = path.join(path.dirname(LAUNCHER), 'runner');
const LAUNCHER_REL = path.relative(REPO, LAUNCHER).replace(/\\/g, '/');
const OLD_RELEASES = ['420201b', '6adcb42']; // the single-file launcher (v21.106.0) and the last one before the split
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-runner-sync-'));
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}
const write = (dir, rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
const lfHash = text => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
const gitShow = commit => execFileSync('git', ['show', `${commit}:${LAUNCHER_REL}`], { cwd: REPO, encoding: 'utf8' });

function project(name, { manifest = true, runner = false } = {}) {
  const root = path.join(base, name);
  write(root, '.crabshell/memory/.keep', '');
  if (manifest) write(root, '.crabshell/verification/manifest.json', JSON.stringify({ schemaVersion: 2, entries: [] }));
  if (runner) copyRunner(LAUNCHER, path.join(root, '.crabshell', 'verification'));
  return root;
}
const verification = root => path.join(root, '.crabshell', 'verification');
const launcherOf = root => path.join(verification(root), 'run-verify.js');

function hookArgs(host, root) {
  const file = host === 'codex' ? path.join(scripts, 'adapters', 'codex', 'session-start.js') : path.join(scripts, 'load-memory.js');
  const env = { ...process.env, CLAUDE_PROJECT_DIR: host === 'codex' ? '' : root, CRABSHELL_BACKGROUND: '' };
  const input = JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: `sync-${host}`, cwd: root });
  return { file, env, input };
}
function sessionStart(host, root) {
  const { file, env, input } = hookArgs(host, root);
  const result = spawnSync(process.execPath, [file], { cwd: root, env, input, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.strictEqual(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim().split('\n').pop());
  return output.hookSpecificOutput.additionalContext;
}
function sessionStartAsync(host, root) {
  const { file, env, input } = hookArgs(host, root);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { cwd: root, env, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(`exit ${code}: ${stderr}`))));
    child.stdin.end(input);
  });
}

// The project's runner/ equals the plugin's: same .js names, same bytes, nothing else.
function assertModulesCurrent(root) {
  const plugin = fs.readdirSync(MODULES).filter(name => name.endsWith('.js')).sort();
  const copy = fs.readdirSync(path.join(verification(root), 'runner')).sort();
  assert.deepStrictEqual(copy, plugin, `runner/ holds ${copy.join(',')}`);
  for (const name of plugin) {
    assert.ok(fs.readFileSync(path.join(verification(root), 'runner', name)).equals(fs.readFileSync(path.join(MODULES, name))), `runner/${name} differs from the plugin's`);
  }
}
const assertLauncherCurrent = root => assert.strictEqual(lfHash(fs.readFileSync(launcherOf(root), 'utf8')), lfHash(fs.readFileSync(LAUNCHER, 'utf8')), 'the launcher is not the plugin\'s');

(async () => {
  await test('old modules: a changed module is replaced and a module the plugin dropped is removed', () => {
    const root = project('old-modules', { runner: true });
    write(verification(root), 'runner/select.js', '// an older select.js\n');
    write(verification(root), 'runner/gone.js', '// a module the plugin no longer has\n');
    sessionStart('claude', root);
    assertModulesCurrent(root);
    assertLauncherCurrent(root);
  });

  await test('a current copy is not written', () => {
    const root = project('current', { runner: true });
    const past = new Date(Date.now() - 3600 * 1000);
    const files = [launcherOf(root), ...fs.readdirSync(path.join(verification(root), 'runner')).map(name => path.join(verification(root), 'runner', name))];
    for (const file of files) fs.utimesSync(file, past, past);
    sessionStart('claude', root);
    for (const file of files) assert.strictEqual(fs.statSync(file).mtimeMs, past.getTime(), `${path.basename(file)} was written`);
  });

  await test('a project without a manifest gets nothing', () => {
    const root = project('no-manifest', { manifest: false });
    sessionStart('claude', root);
    assert.ok(!fs.existsSync(verification(root)), 'a verification folder was created');
  });

  await test('a missing launcher is written beside the modules', () => {
    const root = project('no-launcher');
    sessionStart('codex', root);
    assertLauncherCurrent(root);
    assertModulesCurrent(root);
  });

  await test('released launchers (the single-file one, the last before the split, either line end) are replaced', () => {
    for (const commit of OLD_RELEASES) {
      for (const [ending, host] of [['lf', 'claude'], ['crlf', 'codex']]) {
        const root = project(`release-${commit}-${ending}`);
        const text = gitShow(commit).replace(/\r\n/g, '\n');
        write(verification(root), 'run-verify.js', ending === 'crlf' ? text.replace(/\n/g, '\r\n') : text);
        sessionStart(host, root);
        assertLauncherCurrent(root);
        assertModulesCurrent(root);
      }
    }
  });

  await test('an edited launcher is kept and the session start context ends with one line saying so', () => {
    for (const host of ['claude', 'codex']) {
      const root = project(`edited-${host}`, { runner: true });
      const edited = fs.readFileSync(launcherOf(root), 'utf8') + '// a line the user added\n';
      fs.writeFileSync(launcherOf(root), edited);
      write(verification(root), 'runner/select.js', '// an older select.js\n');
      const context = sessionStart(host, root);
      assert.strictEqual(fs.readFileSync(launcherOf(root), 'utf8'), edited, `${host}: the edited launcher was replaced`);
      assertModulesCurrent(root);
      const last = context.trim().split('\n').pop();
      assert.ok(/differs from every launcher Crabshell released/.test(last), `${host}: last line is "${last}"`);
    }
  });

  await test('the same edited launcher is named once; a further edit is named again', () => {
    const root = project('edited-once', { runner: true });
    const named = context => /differs from every launcher Crabshell released/.test(context);
    fs.writeFileSync(launcherOf(root), fs.readFileSync(launcherOf(root), 'utf8') + '// edit one\n');
    assert.ok(named(sessionStart('claude', root)), 'the first session start did not name it');
    assert.ok(!named(sessionStart('codex', root)), 'the same launcher was named again');
    fs.writeFileSync(launcherOf(root), fs.readFileSync(launcherOf(root), 'utf8') + '// edit two\n');
    assert.ok(named(sessionStart('claude', root)), 'a further edit was not named');
  });

  await test('a project holding the runner source (the plugin itself) is skipped', () => {
    const root = project('source', { runner: true });
    write(root, LAUNCHER_REL, '// the runner source under development\n');
    write(verification(root), 'runner/select.js', '// a copy this project manages itself\n');
    sessionStart('claude', root);
    assert.strictEqual(fs.readFileSync(path.join(verification(root), 'runner', 'select.js'), 'utf8'), '// a copy this project manages itself\n');
  });

  await test('two session starts at once, then one more, leave the plugin\'s files whole and no temporary files', async () => {
    const root = project('concurrent', { runner: true });
    write(verification(root), 'runner/select.js', '// an older select.js\n');
    write(verification(root), 'runner/gone.js', '// dropped\n');
    write(verification(root), 'run-verify.js', gitShow(OLD_RELEASES[1]));
    await Promise.all([sessionStartAsync('claude', root), sessionStartAsync('codex', root)]);
    assertModulesCurrent(root);
    assertLauncherCurrent(root);
    sessionStart('claude', root);
    assertModulesCurrent(root);
    const leftovers = fs.readdirSync(verification(root)).filter(name => /tmp/i.test(name));
    assert.deepStrictEqual(leftovers, [], `temporary files left: ${leftovers.join(', ')}`);
  });

  await test('the released list is built from git history and holds the old releases and the current launcher', () => {
    const out = path.join(base, 'released.json');
    const built = spawnSync(process.execPath, [path.join(scripts, 'build-released-launchers.js'), '--out', out], { cwd: REPO, encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.strictEqual(built.status, 0, built.stderr);
    const hashes = JSON.parse(fs.readFileSync(out, 'utf8')).launchers.map(item => item.sha256);
    for (const commit of OLD_RELEASES) assert.ok(hashes.includes(lfHash(gitShow(commit))), `${commit} missing`);
    // The checked-in list must be rebuilt whenever the launcher changes (release checklist).
    const shipped = JSON.parse(fs.readFileSync(path.join(path.dirname(LAUNCHER), 'released-launchers.json'), 'utf8')).launchers.map(item => item.sha256);
    assert.ok(shipped.includes(lfHash(fs.readFileSync(LAUNCHER, 'utf8'))), 'released-launchers.json lacks the current launcher: run node scripts/build-released-launchers.js');
    for (const commit of OLD_RELEASES) assert.ok(shipped.includes(lfHash(gitShow(commit))), `released-launchers.json lacks ${commit}`);
  });

  try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
