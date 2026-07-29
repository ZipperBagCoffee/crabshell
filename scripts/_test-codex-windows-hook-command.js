'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateContextOutput } = require('./core/first-turn-context');
const { validateSessionStartOutput } = require('./core/memory-context');
const { validateCompactionOutput } = require('./core/compaction-context');
const { validateSubagentOutput } = require('./core/subagent-context');

const repoRoot = path.resolve(__dirname, '..');
const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'codex-hooks.json'), 'utf8')).hooks;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell windows hook '));
const projectRoot = path.join(tempRoot, 'project with spaces');
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function handler(eventName) {
  return hooks[eventName][0].hooks[0];
}

function payload(eventName) {
  const common = {
    session_id: 'windows-hook-fixture',
    transcript_path: null,
    cwd: projectRoot,
    hook_event_name: eventName,
    model: 'fixture-model',
    turn_id: 'fixture-turn',
    permission_mode: 'default',
  };
  if (eventName === 'PreToolUse') {
    return { ...common, tool_name: 'Bash', tool_input: { command: 'rg --version' }, tool_use_id: 'fixture-tool' };
  }
  if (eventName === 'PostToolUse') {
    return { ...common, tool_name: 'Bash', tool_input: { command: 'node scripts/_test-fixture.js' }, tool_response: { exitCode: 0 } };
  }
  if (eventName === 'SessionStart') return { ...common, source: 'startup' };
  if (eventName === 'PreCompact' || eventName === 'PostCompact') return { ...common, trigger: 'auto' };
  if (eventName === 'SubagentStart') return { ...common, agent_type: 'worker' };
  if (eventName === 'SubagentStop') return { ...common, agent_type: 'worker', last_assistant_message: 'Done.' };
  if (eventName === 'Stop') return { ...common, last_assistant_message: 'Done.', stop_hook_active: false };
  return { ...common, prompt: 'What does applying this change mean?' };
}

function run(eventName, command = handler(eventName).commandWindows, pluginRoot = repoRoot) {
  return spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    cwd: projectRoot,
    env: { ...process.env, PLUGIN_ROOT: pluginRoot },
    input: JSON.stringify(payload(eventName)),
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
}

try {
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.crabshell', 'memory'), { recursive: true });

  test('Windows hook commands use shell-independent Node env lookup', () => {
    for (const eventName of ['PostCompact', 'PostToolUse', 'PreCompact', 'PreToolUse', 'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'UserPromptSubmit']) {
      const command = handler(eventName).commandWindows;
      assert.match(command, /process\.env\.PLUGIN_ROOT/);
      assert.doesNotMatch(command, /%PLUGIN_ROOT%|\$\{PLUGIN_ROOT\}|\$env:PLUGIN_ROOT/i);
    }
  });

  test('PowerShell executes PreToolUse commandWindows without hook failure', () => {
    const result = run('PreToolUse');
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(result.stdout, '');
  });

  test('PowerShell executes UserPromptSubmit commandWindows with native output', () => {
    const result = run('UserPromptSubmit');
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(validateContextOutput(JSON.parse(result.stdout.trim())), true);
  });

  test('PowerShell executes SessionStart commandWindows with native output', () => {
    const result = run('SessionStart');
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(validateSessionStartOutput(JSON.parse(result.stdout.trim())), true);
  });

  test('PowerShell executes PreCompact commandWindows with native output', () => {
    const result = run('PreCompact');
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(validateCompactionOutput(JSON.parse(result.stdout.trim()), 'PreCompact'), true);
  });

  test('PowerShell executes PostCompact commandWindows with native output', () => {
    const result = run('PostCompact');
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(validateCompactionOutput(JSON.parse(result.stdout.trim()), 'PostCompact'), true);
  });

  test('PowerShell executes SubagentStart commandWindows with native output', () => {
    const result = run('SubagentStart');
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(validateSubagentOutput(JSON.parse(result.stdout.trim())), true);
  });

  for (const eventName of ['PostToolUse', 'SubagentStop', 'Stop']) {
    test(`PowerShell executes ${eventName} commandWindows without hook failure`, () => {
      const result = run(eventName);
      assert.strictEqual(result.status, 0, result.stderr || result.stdout);
      assert.doesNotMatch(result.stdout, /"decision":"block"/);
    });
  }

  test('the retired percent-expansion command reproduces the PowerShell exit-1 failure', () => {
    const oldCommand = 'node "%PLUGIN_ROOT%/scripts/adapters/codex/pre-tool-use.js"';
    const result = run('PreToolUse', oldCommand);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Cannot find module|MODULE_NOT_FOUND/);
  });

  test('the configured wrapper fails open when the adapter cannot be loaded', () => {
    const result = run('PreToolUse', undefined, path.join(tempRoot, 'missing plugin root'));
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(result.stdout, '');
  });

  test('the configured wrapper fails open when adapter main rejects', () => {
    const rejectingRoot = path.join(tempRoot, 'rejecting plugin');
    const rejectingAdapterDir = path.join(rejectingRoot, 'scripts', 'adapters', 'codex');
    fs.mkdirSync(rejectingAdapterDir, { recursive: true });
    fs.writeFileSync(
      path.join(rejectingAdapterDir, 'pre-tool-use.js'),
      "'use strict';\nmodule.exports = { main: async () => { throw new Error('fixture rejection'); } };\n",
    );
    const result = run('PreToolUse', undefined, rejectingRoot);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(result.stdout, '');
  });

  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
