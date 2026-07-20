'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { CodexAppServer, runCodex } = require('./core/codex-app-server');

const sourceRoot = path.resolve(__dirname, '..');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell native install '));
const fixtureRoot = path.join(testRoot, 'marketplace source with spaces');
const codexHome = path.join(testRoot, 'codex home with spaces');
const env = { ...process.env, CODEX_HOME: codexHome };
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function copy(relativePath) {
  fs.cpSync(path.join(sourceRoot, relativePath), path.join(fixtureRoot, relativePath), { recursive: true });
}

function runCli(args, timeout = 30000) {
  const result = runCodex(args, { cwd: fixtureRoot, env, timeout });
  assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
  return result;
}

function runDoctor(scriptPath = path.join(fixtureRoot, 'scripts', 'codex-doctor.js'), projectDir = fixtureRoot) {
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--json',
    `--project-dir=${projectDir}`,
    `--codex-home=${codexHome}`,
  ], { cwd: projectDir, env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function getCheck(report, id) {
  const item = report.checks.find(candidate => candidate.id === id);
  assert.ok(item, `missing doctor check: ${id}`);
  return item;
}

async function trustInstalledHooks() {
  const server = await new CodexAppServer({ cwd: fixtureRoot, env }).start();
  try {
    const response = await server.request('hooks/list', { cwds: [fixtureRoot] });
    const hooks = response.data.flatMap(entry => entry.hooks)
      .filter(hook => hook.pluginId === 'crabshell@crabshell-repo');
    assert.ok(hooks.length > 0, 'installed plugin hooks were not discovered');
    const states = Object.fromEntries(hooks.map(hook => [hook.key, { trusted_hash: hook.currentHash }]));
    await server.request('config/batchWrite', {
      edits: [{ keyPath: 'hooks.state', value: states, mergeStrategy: 'upsert' }],
      filePath: null,
      expectedVersion: null,
      reloadUserConfig: false,
    });
  } finally {
    server.close();
  }
}

async function main() {
  try {
    fs.mkdirSync(fixtureRoot, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    for (const relativePath of ['.codex-plugin', '.agents', 'codex-skills', 'hooks', 'scripts']) copy(relativePath);

    const sentinelPath = path.join(testRoot, 'claude-hook-sentinel.txt');
    fs.writeFileSync(path.join(fixtureRoot, 'hooks', 'hooks.json'), JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: `node -e "require('fs').writeFileSync(${JSON.stringify(sentinelPath)}, 'ran')"` }] }],
      },
    }, null, 2));

    const marketplaceAdd = runCli(['plugin', 'marketplace', 'add', fixtureRoot, '--json']);
    test('marketplace registers from a path containing spaces', () => {
      const output = JSON.parse(marketplaceAdd.stdout);
      assert.strictEqual(output.marketplaceName, 'crabshell-repo');
    });

    const pluginAdd = runCli(['plugin', 'add', 'crabshell@crabshell-repo', '--json']);
    test('plugin installs into the isolated Codex profile', () => {
      const output = JSON.parse(pluginAdd.stdout);
      assert.strictEqual(output.pluginId, 'crabshell@crabshell-repo');
    });

    const first = runDoctor();
    test('fresh app-server session resolves source, cache, skills, and Codex-only hooks', () => {
      assert.strictEqual(first.summary.error, 0);
      assert.strictEqual(getCheck(first, 'plugin-source').status, 'ok');
      assert.strictEqual(getCheck(first, 'plugin-cache').status, 'ok');
      assert.strictEqual(getCheck(first, 'skills').status, 'ok');
      assert.strictEqual(getCheck(first, 'hook-source').status, 'ok');
      assert.strictEqual(getCheck(first, 'hook-trust').status, 'warn');
      assert.ok(getCheck(first, 'hook-source').details.hooks.every(hook => path.basename(hook.sourcePath) === 'codex-hooks.json'));
      assert.ok(!fs.existsSync(sentinelPath), 'Claude-only hook sentinel unexpectedly ran');
    });

    test('doctor reports portable paths with spaces and a writable plugin data directory', () => {
      assert.ok(first.projectRoot.includes(' '));
      assert.ok(first.codexHome.includes(' '));
      assert.ok(getCheck(first, 'plugin-cache').details.path.includes(' '));
      assert.strictEqual(getCheck(first, 'plugin-data').status, 'ok');
      assert.strictEqual(getCheck(first, 'hook-probe').status, 'ok');
    });

    const cachePath = getCheck(first, 'plugin-cache').details.path;
    const consumerProject = path.join(testRoot, 'consumer project with spaces');
    const consumerStorage = path.join(consumerProject, '.crabshell');
    fs.mkdirSync(path.join(consumerStorage, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(consumerProject, '.gitignore'), '.crabshell/\n');
    fs.writeFileSync(path.join(consumerStorage, 'project.md'), 'INSTALLED_SKILL_PROJECT_MARKER\n');
    const saveWrapper = path.join(cachePath, 'codex-skills', 'save-memory', 'scripts', 'codex-memory.js');
    const loadWrapper = path.join(cachePath, 'codex-skills', 'load-memory', 'scripts', 'codex-memory.js');
    const saveResult = spawnSync(process.execPath, [saveWrapper, 'save', '--message=INSTALLED_SKILL_NOTE', `--project-dir=${consumerProject}`], {
      cwd: consumerProject, env, encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    const loadResult = spawnSync(process.execPath, [loadWrapper, 'load', `--project-dir=${consumerProject}`], {
      cwd: consumerProject, env, encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
    test('installed memory skill wrappers operate on a different consumer project', () => {
      assert.strictEqual(saveResult.status, 0, saveResult.stderr);
      assert.strictEqual(loadResult.status, 0, loadResult.stderr);
      assert.match(loadResult.stdout, /INSTALLED_SKILL_PROJECT_MARKER/);
      assert.match(loadResult.stdout, /INSTALLED_SKILL_NOTE/);
    });

    const installedStatusWrapper = path.join(cachePath, 'codex-skills', 'status', 'scripts', 'codex-doctor.js');
    const consumerStatus = runDoctor(installedStatusWrapper, consumerProject);
    test('installed status wrapper separates plugin root from the consumer project', () => {
      assert.strictEqual(consumerStatus.summary.error, 0);
      assert.strictEqual(path.resolve(consumerStatus.pluginRoot), path.resolve(cachePath));
      assert.strictEqual(path.resolve(consumerStatus.projectRoot), path.resolve(consumerProject));
      assert.strictEqual(getCheck(consumerStatus, 'skills').status, 'ok');
    });

    await trustInstalledHooks();
    const trusted = runDoctor();
    test('a new app-server session observes the native trusted hook hash', () => {
      const hookTrust = getCheck(trusted, 'hook-trust');
      assert.strictEqual(hookTrust.status, 'ok');
      assert.ok(hookTrust.details.hooks.every(hook => hook.trustStatus === 'trusted'));
    });

    const cachedHooksPath = path.join(cachePath, 'hooks', 'codex-hooks.json');
    const cachedHooks = JSON.parse(fs.readFileSync(cachedHooksPath, 'utf8'));
    cachedHooks.hooks.PreToolUse[0].hooks[0].statusMessage = 'Changed by isolated drift fixture';
    fs.writeFileSync(cachedHooksPath, JSON.stringify(cachedHooks, null, 2) + '\n');
    const drifted = runDoctor();
    test('changing the isolated installed source changes the observed hash to modified', () => {
      const hookTrust = getCheck(drifted, 'hook-trust');
      assert.strictEqual(hookTrust.status, 'warn');
      assert.ok(hookTrust.details.hooks.every(hook => hook.trustStatus === 'modified'));
    });

    console.log(`RESULT: ${passed} passed, 0 failed`);
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
