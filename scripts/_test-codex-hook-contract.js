'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateCodexHookConfig } = require('./adapters/codex/hook-contract');
const { validateContextOutput } = require('./core/first-turn-context');
const { validateSessionStartOutput } = require('./core/memory-context');
const { validateCompactionOutput } = require('./core/compaction-context');

const repoRoot = path.resolve(__dirname, '..');
const adapter = path.join(__dirname, 'adapters', 'codex', 'pre-tool-use.js');
const promptAdapter = path.join(__dirname, 'adapters', 'codex', 'user-prompt-submit.js');
const sessionAdapter = path.join(__dirname, 'adapters', 'codex', 'session-start.js');
const preCompactAdapter = path.join(__dirname, 'adapters', 'codex', 'pre-compact.js');
const postCompactAdapter = path.join(__dirname, 'adapters', 'codex', 'post-compact.js');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'codex', 'pre-tool-use.json'), 'utf8'));
const promptFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'codex', 'user-prompt-submit.json'), 'utf8'));
const sessionFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'codex', 'session-start.json'), 'utf8'));
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

function runPrompt(payload) {
  return spawnSync(process.execPath, [promptAdapter], {
    cwd: projectRoot,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 5000,
  });
}

function runSession(payload) {
  return spawnSync(process.execPath, [sessionAdapter], {
    cwd: projectRoot,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 5000,
  });
}

function runCompaction(script, payload) {
  return spawnSync(process.execPath, [script], {
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

  test('native UserPromptSubmit returns the shared additional-context contract', () => {
    const result = runPrompt({ ...promptFixture, cwd: projectRoot });
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.strictEqual(validateContextOutput(output), true);
    assert.match(output.hookSpecificOutput.additionalContext, /question authorizes an answer/i);
  });

  test('native SessionStart returns read-only Crabshell memory context', () => {
    const result = runSession({ ...sessionFixture, cwd: projectRoot });
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.strictEqual(validateSessionStartOutput(output), true);
    assert.match(output.hookSpecificOutput.additionalContext, /No memory for project with spaces/);
  });

  test('native PreCompact and PostCompact return recovery context', () => {
    const common = { cwd: projectRoot, trigger: 'auto' };
    const pre = runCompaction(preCompactAdapter, { ...common, hook_event_name: 'PreCompact' });
    assert.strictEqual(pre.status, 0, pre.stderr);
    assert.strictEqual(validateCompactionOutput(JSON.parse(pre.stdout.trim()), 'PreCompact'), true);
    const post = runCompaction(postCompactAdapter, { ...common, hook_event_name: 'PostCompact' });
    assert.strictEqual(post.status, 0, post.stderr);
    assert.strictEqual(validateCompactionOutput(JSON.parse(post.stdout.trim()), 'PostCompact'), true);
  });

  test('Codex manifest explicitly selects the Codex-only hook file', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(manifest.hooks, './hooks/codex-hooks.json');
    assert.ok(Array.isArray(manifest.interface.defaultPrompt));
    assert.ok(manifest.interface.defaultPrompt.length <= 3);
  });

  test('Codex hooks contain the nine synchronous native lifecycle events', () => {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'codex-hooks.json'), 'utf8'));
    assert.strictEqual(validateCodexHookConfig(config), true);
    assert.deepStrictEqual(Object.keys(config.hooks).sort(), ['PostCompact', 'PostToolUse', 'PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit']);
    const handlers = Object.values(config.hooks).flatMap(groups => groups.flatMap(group => group.hooks));
    assert.ok(handlers.length > 0);
    assert.ok(handlers.every(handler => handler.type === 'command' && handler.async !== true));
    const serialized = JSON.stringify(config);
    for (const forbidden of ['pressure-guard', 'sycophancy-guard', 'behavior-verifier']) {
      assert.ok(!serialized.includes(forbidden), `unexpected Codex hook content: ${forbidden}`);
    }
  });

  test('missing/extra event, divergent adapter, async, handler-type, and hardcoded-command mutations fail', () => {
    const original = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'codex-hooks.json'), 'utf8'));
    const mutate = fn => {
      const copy = JSON.parse(JSON.stringify(original));
      fn(copy);
      return copy;
    };
    assert.throws(() => validateCodexHookConfig(mutate(config => { delete config.hooks.UserPromptSubmit; })), /exactly/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { delete config.hooks.SessionStart; })), /exactly/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { delete config.hooks.PreCompact; })), /exactly/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { delete config.hooks.PostCompact; })), /exactly/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { delete config.hooks.SubagentStart; })), /exactly/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { delete config.hooks.PostToolUse; })), /exactly/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { delete config.hooks.Stop; })), /exactly/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { delete config.hooks.SubagentStop; })), /exactly/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.UserPromptSubmit[0].hooks[0].command = 'node -e "require(process.env.PLUGIN_ROOT + \'/scripts/divergent.js\').main()"'; })), /shared Codex user-prompt adapter/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.SessionStart[0].hooks[0].command = 'node -e "require(process.env.PLUGIN_ROOT + \'/scripts/divergent.js\').main()"'; })), /shared Codex memory adapter/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PreCompact[0].hooks[0].command = 'node -e "require(process.env.PLUGIN_ROOT + \'/scripts/divergent.js\').main()"'; })), /pre-compact/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PostCompact[0].hooks[0].command = 'node -e "require(process.env.PLUGIN_ROOT + \'/scripts/divergent.js\').main()"'; })), /post-compact/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.SubagentStart[0].hooks[0].command = 'node -e "require(process.env.PLUGIN_ROOT + \'/scripts/divergent.js\').main()"'; })), /subagent adapter/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PostToolUse[0].hooks[0].command = 'node -e "require(process.env.PLUGIN_ROOT + \'/scripts/divergent.js\').main()"'; })), /parent-evidence adapter/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.Stop[0].hooks[0].command = 'node -e "require(process.env.PLUGIN_ROOT + \'/scripts/divergent.js\').main()"'; })), /completion adapter/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.SubagentStop[0].hooks.push({ ...config.hooks.SubagentStop[0].hooks[0] }); })), /one shared Codex completion adapter/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PreCompact[0].matcher = 'manual'; })), /manual\|auto/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PreToolUse[0].hooks[0].async = true; })), /Async/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PreToolUse[0].hooks[0].type = 'prompt'; })), /handler type/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PreToolUse[0].hooks[0].command = 'node /absolute/plugin/hook.js'; })), /PLUGIN_ROOT/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PreToolUse[0].hooks[0].commandWindows = 'node "%PLUGIN_ROOT%/scripts/adapters/codex/pre-tool-use.js"'; })), /resolve PLUGIN_ROOT/);
    assert.throws(() => validateCodexHookConfig(mutate(config => { config.hooks.PreToolUse[0].hooks[0].commandWindows = 'node -e "require(process.env.PLUGIN_ROOT + \'/%PLUGIN_ROOT%/pre-tool-use.js\').main()"'; })), /shell-specific/);
  });

  test('a PASS-only stdout fixture cannot satisfy the native deny contract', () => {
    assert.throws(() => JSON.parse('PASS'), SyntaxError);
    const fakeJson = { result: 'PASS' };
    assert.notStrictEqual(fakeJson.hookSpecificOutput?.permissionDecision, 'deny');
  });

  test('wrong-event and missing-context output mutations fail', () => {
    assert.throws(() => validateContextOutput({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: '## Crabshell Turn Contract' } }), /UserPromptSubmit/);
    assert.throws(() => validateContextOutput({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'PASS' } }), /shared Crabshell turn contract/);
    assert.throws(() => validateSessionStartOutput({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'Crabshell: memory' } }), /SessionStart/);
    assert.throws(() => validateSessionStartOutput({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'PASS' } }), /memory context/);
    assert.throws(() => validateCompactionOutput({ hookSpecificOutput: { hookEventName: 'PostCompact', additionalContext: '## Crabshell Compaction Recovery Context' } }, 'PreCompact'), /PreCompact/);
    assert.throws(() => validateCompactionOutput({ hookSpecificOutput: { hookEventName: 'PreCompact', additionalContext: 'PASS' } }, 'PreCompact'), /recovery context/);
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
