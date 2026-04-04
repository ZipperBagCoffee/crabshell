'use strict';

/**
 * _test-post-compact.js — Tests for post-compact.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const NODE = process.execPath;
const SCRIPT = path.join(__dirname, 'post-compact.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { console.log('FAIL: ' + name + ' --- ' + e.message); failed++; }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}

function cleanupDir(dirPath) {
  try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch (e) {}
}

function setupProject(tmpDir, opts = {}) {
  const crabshellDir = path.join(tmpDir, '.crabshell');
  const memoryDir = path.join(crabshellDir, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  if (opts.regressingState) {
    fs.writeFileSync(path.join(memoryDir, 'regressing-state.json'), JSON.stringify(opts.regressingState, null, 2));
  }
}

function runScript(projectDir, hookData = {}) {
  const input = JSON.stringify(hookData);
  try {
    const result = execSync(`"${NODE}" "${SCRIPT}"`, {
      input,
      timeout: 10000,
      encoding: 'utf8',
      env: { ...process.env, HOOK_DATA: input, CLAUDE_PROJECT_DIR: projectDir },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { exitCode: 0, stdout: result, stderr: '' };
  } catch (e) {
    return { exitCode: e.status || 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

// ============================================================
// Test 1: Exits 0 (fail-open)
// ============================================================
test('Exits 0 always (fail-open)', function() {
  const tmpDir = makeTempDir('post-compact-test');
  try {
    const { exitCode } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 2: Outputs empty JSON {}
// ============================================================
test('Outputs empty JSON {} on stdout', function() {
  const tmpDir = makeTempDir('post-compact-test');
  try {
    const { exitCode, stdout } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0');
    const parsed = JSON.parse(stdout.trim());
    assert(typeof parsed === 'object', 'output should be JSON object');
    assert(Object.keys(parsed).length === 0, 'output should be empty object {}, got ' + JSON.stringify(parsed));
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 3: Logs to stderr with [CRABSHELL] PostCompact prefix
// ============================================================
test('Logs PostCompact to stderr', function() {
  const tmpDir = makeTempDir('post-compact-test');
  try {
    const input = JSON.stringify({});
    const { spawnSync } = require('child_process');
    const result = spawnSync(NODE, [SCRIPT], {
      input,
      timeout: 10000,
      encoding: 'utf8',
      env: { ...process.env, HOOK_DATA: input, CLAUDE_PROJECT_DIR: tmpDir }
    });
    const stderrOut = result.stderr || '';
    assert(stderrOut.includes('[CRABSHELL] PostCompact'), 'stderr should contain [CRABSHELL] PostCompact, got: ' + stderrOut);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 4: Writes compaction log file
// ============================================================
test('Writes compaction.log to .crabshell/memory/logs/', function() {
  const tmpDir = makeTempDir('post-compact-test');
  try {
    setupProject(tmpDir, {});
    runScript(tmpDir);
    const logPath = path.join(tmpDir, '.crabshell', 'memory', 'logs', 'compaction.log');
    assert(fs.existsSync(logPath), 'compaction.log should exist at ' + logPath);
    const content = fs.readFileSync(logPath, 'utf8');
    assert(content.includes('PostCompact hook fired'), 'log should contain event entry');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 5: Logs active regressing state presence
// ============================================================
test('Logs active regressing state to stderr', function() {
  const tmpDir = makeTempDir('post-compact-test');
  try {
    setupProject(tmpDir, {
      regressingState: {
        active: true,
        phase: 'execution',
        cycle: 1,
        totalCycles: 3
      }
    });
    const input = JSON.stringify({});
    const { spawnSync } = require('child_process');
    const result = spawnSync(NODE, [SCRIPT], {
      input,
      timeout: 10000,
      encoding: 'utf8',
      env: { ...process.env, HOOK_DATA: input, CLAUDE_PROJECT_DIR: tmpDir }
    });
    const stderrOut = result.stderr || '';
    assert(stderrOut.includes('regressing state preserved'), 'should log regressing state preserved, got: ' + stderrOut);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 6: Does NOT output additionalContext (PostCompact limitation)
// ============================================================
test('Does NOT output additionalContext (PostCompact has no additionalContext support)', function() {
  const tmpDir = makeTempDir('post-compact-test');
  try {
    const { stdout } = runScript(tmpDir);
    assert(!stdout.includes('additionalContext'), 'should NOT contain additionalContext');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
