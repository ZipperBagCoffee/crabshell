'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { runCodex } = require('./core/codex-app-server');

const repoRoot = path.resolve(__dirname, '..');

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    timeout: options.timeout || 300000,
    windowsHide: true,
  });
  return {
    exitCode: result.status,
    signal: result.signal,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
    error: result.error?.message || null,
  };
}

function observe(name, result, required) {
  const missing = required.filter(pattern => !pattern.test(result.stdout)).map(pattern => pattern.source);
  return {
    name,
    exitCode: result.exitCode,
    signal: result.signal,
    missing,
    passed: result.exitCode === 0 && !result.signal && missing.length === 0,
    degraded: /MODEL_AUTH_DEGRADED_AFTER_NATIVE_HOOKS/.test(result.stdout) ? ['model-auth'] : [],
    stdoutTail: result.stdout.trim().split(/\r?\n/).slice(-4),
    stderrTail: result.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-4),
    error: result.error,
  };
}

function wslPath(windowsPath) {
  const portableWindowsPath = windowsPath.replace(/\\/g, '/');
  const result = execute('wsl.exe', ['wslpath', '-a', portableWindowsPath], { timeout: 30000 });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.error || 'wslpath failed');
  return result.stdout.trim();
}

function currentCodexVersion() {
  const result = runCodex(['--version'], { cwd: repoRoot, timeout: 30000 });
  const match = String(result.stdout || '').match(/(\d+\.\d+\.\d+)/);
  if (result.status !== 0 || !match) throw new Error(result.stderr || result.error?.message || 'Cannot determine current Codex CLI version.');
  return match[1];
}

function currentClaudeVersion() {
  const result = execute('claude.exe', ['--version'], { timeout: 30000 });
  const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
  if (result.exitCode !== 0 || !match) throw new Error(result.stderr || result.error || 'Cannot determine current Claude Code version.');
  return match[1];
}

function runMatrix() {
  if (process.platform !== 'win32') throw new Error('Run the cross-platform matrix from Windows with WSL available.');
  const results = [];

  results.push(observe(
    'windows-claude-cli',
    execute(process.execPath, [path.join(__dirname, '_test-claude-native-install.js')]),
    [/installed Claude CLI executes the native lifecycle/, /question-only process leaves the consumer project unchanged/]
  ));
  results.push(observe(
    'windows-codex-cli',
    execute(process.execPath, [path.join(__dirname, '_test-codex-native-install.js')]),
    [/plugin installs into the isolated Codex profile/, /native trusted hook hash/, /installed memory skill wrappers/]
  ));

  const linuxScript = wslPath(path.join(__dirname, '_test-linux-native-hosts.sh'));
  const linuxRepo = wslPath(repoRoot);
  results.push(observe(
    'linux-claude-and-codex-cli',
    execute('wsl.exe', ['bash', linuxScript, linuxRepo, currentCodexVersion(), currentClaudeVersion()], { timeout: 600000 }),
    [
      /installed Claude CLI executes the native lifecycle/,
      /plugin installs into the isolated Codex profile/,
      /native trusted hook hash/,
      /LINUX_NATIVE_HOSTS_COMPLETE/,
    ]
  ));

  return {
    passed: results.every(result => result.passed),
    hosts: results,
    codexApp: 'not-directly-exercised',
  };
}

if (require.main === module) {
  try {
    const report = runMatrix();
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report)}\n`);
    else {
      for (const host of report.hosts) process.stdout.write(`${host.passed ? 'OK' : 'FAIL'} ${host.name}\n`);
      process.stdout.write(`Codex app: ${report.codexApp}\n`);
    }
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    const report = { passed: false, error: error.message, codexApp: 'not-directly-exercised' };
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report)}\n`);
    else process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { currentClaudeVersion, currentCodexVersion, observe, runMatrix, wslPath };
