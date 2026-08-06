'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateSessionStartOutput } = require('./core/memory-context');

const sourceRoot = path.resolve(__dirname, '..');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell claude install '));
const fixtureRoot = path.join(testRoot, 'marketplace source with spaces');
const claudeConfigDir = path.join(testRoot, 'claude config with spaces');
const projectRoot = path.join(testRoot, 'consumer project with spaces');
const debugPath = path.join(testRoot, 'claude-hooks.log');
const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigDir };
const claudeBin = process.env.CLAUDE_BIN || (process.platform === 'win32' ? 'claude.exe' : 'claude');
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function runClaude(args, cwd = projectRoot, timeout = 30000, requireSuccess = true) {
  const result = spawnSync(claudeBin, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
  if (requireSuccess) assert.strictEqual(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return result;
}

function treeSnapshot(root) {
  const snapshot = {};
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = path.join(relative, entry.name);
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        snapshot[childRelative] = '<directory>';
        visit(child, childRelative);
      } else {
        snapshot[childRelative] = crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex');
      }
    }
  }
  visit(root);
  return snapshot;
}

function parseJsonLines(text) {
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function requirePromptLifecycle(result) {
  if (result.status === 0) return;
  const output = String(result.stdout || '');
  const allowedAuthFailure = /UserPromptSubmit/.test(output)
    && /authentication_failed|OAuth session expired/.test(output);
  assert.strictEqual(allowedAuthFailure, true, result.stderr || result.error?.message || output);
  console.log('OBSERVATION: MODEL_AUTH_DEGRADED_AFTER_NATIVE_HOOKS');
}

try {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  for (const relativePath of ['.claude-plugin', 'agents', 'commands', 'hooks', 'prompts', 'scripts', 'skills']) {
    fs.cpSync(path.join(sourceRoot, relativePath), path.join(fixtureRoot, relativePath), { recursive: true });
  }
  fs.mkdirSync(claudeConfigDir, { recursive: true });
  if (process.env.CRABSHELL_CLAUDE_CREDENTIALS) {
    fs.copyFileSync(process.env.CRABSHELL_CLAUDE_CREDENTIALS, path.join(claudeConfigDir, '.credentials.json'));
  }
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.crabshell', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.gitignore'), '.crabshell/\n');
  fs.writeFileSync(path.join(projectRoot, '.crabshell', 'memory', 'index.json'), '{"entries":[]}\n');

  runClaude(['plugin', 'marketplace', 'add', fixtureRoot]);
  runClaude(['plugin', 'install', 'crabshell@crabshell-marketplace']);
  const installed = JSON.parse(runClaude(['plugin', 'list', '--json']).stdout)
    .find(plugin => plugin.id === 'crabshell@crabshell-marketplace');

  test('Claude installs Crabshell from the local marketplace into an isolated profile', () => {
    assert.ok(installed);
    assert.strictEqual(installed.enabled, true);
    assert.ok(installed.installPath.includes(' '));
    assert.ok(fs.existsSync(path.join(installed.installPath, 'hooks', 'hooks.json')));
  });

  const before = treeSnapshot(projectRoot);
  const installedSessionStart = spawnSync(process.execPath, [path.join(installed.installPath, 'scripts', 'load-memory.js')], {
    cwd: projectRoot,
    env: { ...env, CLAUDE_PROJECT_DIR: projectRoot },
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: projectRoot }),
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });

  test('installed Claude SessionStart emits native memory context without a project write', () => {
    assert.strictEqual(installedSessionStart.status, 0, installedSessionStart.stderr || installedSessionStart.stdout);
    assert.strictEqual(validateSessionStartOutput(JSON.parse(installedSessionStart.stdout.trim())), true);
    assert.deepStrictEqual(treeSnapshot(projectRoot), before);
  });

  const run = runClaude([
    '--print',
    '--verbose',
    '--include-hook-events',
    '--output-format', 'stream-json',
    '--no-session-persistence',
    '--tools', '',
    '--max-budget-usd', '0.03',
    '--debug', 'hooks',
    '--debug-file', debugPath,
    'What does applying this change mean? Reply only OK.',
  ], projectRoot, 120000, false);
  requirePromptLifecycle(run);
  const events = parseJsonLines(run.stdout);
  const serialized = JSON.stringify(events);

  test('installed Claude plugin emits its native UserPromptSubmit hook event', () => {
    assert.match(serialized, /UserPromptSubmit/);
    assert.match(serialized, /Crabshell Turn Contract/);
    assert.match(serialized, /Rules Quick-Check/);
    assert.match(serialized, /audit each claim against a tool result/i);
    // Retired in v21.113.0 (I083 R2/R8): per-response 3-field block and its contract text
    assert.doesNotMatch(serialized, /Mandatory Response Ending/);
    assert.doesNotMatch(serialized, /\[의도\]:/);
  });

  test('installed Claude question-only process leaves the consumer project unchanged', () => {
    assert.deepStrictEqual(treeSnapshot(projectRoot), before);
  });

  const memoryDir = path.join(projectRoot, '.crabshell', 'memory');
  fs.writeFileSync(path.join(memoryDir, 'memory-index.json'), JSON.stringify({
    deltaReady: false,
    rulesInjectionFrequency: 1,
    feedbackPressure: { level: 0, consecutiveCount: 0, decayCounter: 0, oscillationCount: 5, lastShownLevel: 0 },
    tooGoodSkepticism: { retryCount: 6 },
    rotatedFiles: [],
  }, null, 2));
  fs.writeFileSync(path.join(memoryDir, 'delta_temp.txt'), 'STALE_EXECUTION_DELTA_MARKER\n');
  fs.writeFileSync(path.join(memoryDir, 'skill-active.json'), '{"skill":"STALE_EXECUTION_SKILL_MARKER"}\n');

  const executionRun = runClaude([
    '--print',
    '--verbose',
    '--include-hook-events',
    '--output-format', 'stream-json',
    '--no-session-persistence',
    '--tools', '',
    '--max-budget-usd', '0.03',
    'Implement the requested fixture change. Reply only OK.',
  ], projectRoot, 120000, false);
  requirePromptLifecycle(executionRun);
  const executionEvents = parseJsonLines(executionRun.stdout);

  test('installed Claude CLI executes the native lifecycle on an execution prompt', () => {
    assert.match(JSON.stringify(executionEvents), /UserPromptSubmit/);
    const deltaPath = path.join(memoryDir, 'delta_temp.txt');
    const deltaContent = fs.existsSync(deltaPath) ? fs.readFileSync(deltaPath, 'utf8') : '';
    assert.doesNotMatch(deltaContent, /STALE_EXECUTION_DELTA_MARKER/);
    const skillPath = path.join(memoryDir, 'skill-active.json');
    const skillContent = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf8') : '';
    assert.doesNotMatch(skillContent, /STALE_EXECUTION_SKILL_MARKER/);
    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory-index.json'), 'utf8'));
    assert.strictEqual(index.feedbackPressure.oscillationCount, 0);
    assert.strictEqual(index.tooGoodSkepticism.retryCount, 0);
    assert.match(fs.readFileSync(path.join(projectRoot, 'CLAUDE.md'), 'utf8'), /CRITICAL RULES/);
  });

  test('installed Claude execution preserves the built-in/plugin memory distinction warning', () => {
    const sanitized = projectRoot.replace(/[^a-zA-Z0-9-]/g, '-');
    const memoryPath = path.join(claudeConfigDir, 'projects', sanitized, 'memory', 'MEMORY.md');
    assert.match(fs.readFileSync(memoryPath, 'utf8'), /These are SEPARATE systems/);
  });

  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
