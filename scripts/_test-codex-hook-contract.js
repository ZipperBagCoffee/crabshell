'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateCodexHookConfig } = require('./adapters/codex/hook-contract');

const repoRoot = path.resolve(__dirname, '..');
const adapter = path.join(__dirname, 'adapters', 'codex', 'pre-tool-use.js');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'codex', 'pre-tool-use.json'), 'utf8'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell codex hook '));
const projectRoot = path.join(tempRoot, 'project with spaces');
fs.mkdirSync(path.join(projectRoot, '.crabshell', 'memory'), { recursive: true });

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function run(payload) {
  return spawnSync(process.execPath, [adapter], {
    cwd: projectRoot,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 5000,
  });
}

try {
  test('native PreToolUse violation returns deny with exit 0', () => {
    const payload = {
      ...fixture,
      cwd: projectRoot,
      tool_input: { command: `cat "${path.join(tempRoot, 'other project', '.crabshell', 'memory', 'logbook.md')}"` },
    };
    const result = run(payload);
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /Wrong \.crabshell\/ path/);
    assert.strictEqual(output.decision, undefined);
  });

  test('native PreToolUse permits the active project path', () => {
    const payload = {
      ...fixture,
      cwd: projectRoot,
      tool_input: { command: `cat "${path.join(projectRoot, '.crabshell', 'memory', 'logbook.md')}"` },
    };
    const result = run(payload);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
  });

  test('malformed and unrelated events fail open', () => {
    const malformed = run({ hook_event_name: 'PreToolUse', cwd: projectRoot });
    const unrelated = run({ ...fixture, cwd: projectRoot, hook_event_name: 'Stop' });
    assert.strictEqual(malformed.status, 0);
    assert.strictEqual(malformed.stdout, '');
    assert.strictEqual(unrelated.status, 0);
    assert.strictEqual(unrelated.stdout, '');
  });

  test('Codex manifest explicitly selects the Codex-only hook file', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(manifest.hooks, './hooks/codex-hooks.json');
    assert.ok(Array.isArray(manifest.interface.defaultPrompt));
    assert.ok(manifest.interface.defaultPrompt.length <= 3);
  });

  test('Codex hooks contain only synchronous command PreToolUse', () => {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'codex-hooks.json'), 'utf8'));
    assert.strictEqual(validateCodexHookConfig(config), true);
    assert.deepStrictEqual(Object.keys(config.hooks), ['PreToolUse']);
    const handlers = config.hooks.PreToolUse.flatMap(group => group.hooks);
    assert.ok(handlers.length > 0);
    assert.ok(handlers.every(handler => handler.type === 'command' && handler.async !== true));
    const serialized = JSON.stringify(config);
    for (const forbidden of ['Stop', 'SessionStart', 'pressure-guard', 'sycophancy-guard', 'behavior-verifier']) {
      assert.ok(!serialized.includes(forbidden), `unexpected Codex hook content: ${forbidden}`);
    }
  });

  test('forbidden event, async, handler-type, and hardcoded-command mutations fail', () => {
    const original = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'codex-hooks.json'), 'utf8'));
    const mutate = fn => {
      const copy = JSON.parse(JSON.stringify(original));
      fn(copy);
      return copy;
    };
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.Stop = config.hooks.PreToolUse; })), /only PreToolUse/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PreToolUse[0].hooks[0].async = true; })), /Async/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PreToolUse[0].hooks[0].type = 'prompt'; })), /handler type/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PreToolUse[0].hooks[0].command = 'node /absolute/plugin/hook.js'; })), /PLUGIN_ROOT/);
  });

  test('a PASS-only stdout fixture cannot satisfy the native deny contract', () => {
    assert.throws(() => JSON.parse('PASS'), SyntaxError);
    const fakeJson = { result: 'PASS' };
    assert.notStrictEqual(fakeJson.hookSpecificOutput?.permissionDecision, 'deny');
  });

  test('repo marketplace resolves the plugin from a portable relative path', () => {
    const marketplace = JSON.parse(fs.readFileSync(path.join(repoRoot, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
    assert.strictEqual(marketplace.name, 'crabshell-repo');
    assert.strictEqual(marketplace.plugins.length, 1);
    assert.deepStrictEqual(marketplace.plugins[0].source, { source: 'local', path: './' });
    assert.ok(!path.isAbsolute(marketplace.plugins[0].source.path));
  });

  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
