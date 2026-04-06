// _test-append-memory.js — Tests for append-memory.js (subprocess only — no module.exports)
// append-memory.js has no module.exports; all tests invoke it as a child process.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');

const scriptPath = path.join(__dirname, 'append-memory.js');
const nodePath = process.execPath.replace(/\\/g, '/');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { console.log('FAIL: ' + name + ' --- ' + e.message); failed++; }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error((label || '') + ' expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function assertIncludes(text, substr, label) {
  if (typeof text !== 'string' || !text.includes(substr)) {
    throw new Error((label || '') + ' expected to include ' + JSON.stringify(substr) + ' in ' + JSON.stringify(String(text).substring(0, 300)));
  }
}

function makeTempDir() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const dir = path.join(os.tmpdir(), 'test-append-memory-' + suffix);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function cleanupDir(dirPath) {
  try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch (e) {}
}

// Run append-memory.js as subprocess, returns { status, stdout, stderr }
function runAppendMemory(tmpDir) {
  const result = spawnSync(
    nodePath,
    [scriptPath, '--project-dir=' + tmpDir],
    { encoding: 'utf8', timeout: 10000 }
  );
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

// Setup: create memory dir structure
function setupMemoryDir(tmpDir) {
  const memDir = path.join(tmpDir, '.crabshell', 'memory');
  ensureDir(memDir);
  return memDir;
}

// ============================================================
// 1. Missing summary file → exit 1
// ============================================================
test('missing delta_summary_temp.txt → exit 1', function() {
  const tmpDir = makeTempDir();
  try {
    setupMemoryDir(tmpDir);
    const r = runAppendMemory(tmpDir);
    assertEqual(r.status, 1, 'exit code');
    assertIncludes(r.stderr + r.stdout, 'not found', 'error message includes not found');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 2. Empty summary file → exit 1
// ============================================================
test('empty delta_summary_temp.txt → exit 1', function() {
  const tmpDir = makeTempDir();
  try {
    const memDir = setupMemoryDir(tmpDir);
    fs.writeFileSync(path.join(memDir, 'delta_summary_temp.txt'), '   \n  ');
    const r = runAppendMemory(tmpDir);
    assertEqual(r.status, 1, 'exit code');
    assertIncludes(r.stderr + r.stdout, 'empty', 'error message mentions empty');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 3. Valid summary → exit 0, logbook.md contains entry with timestamp header
// ============================================================
test('valid summary → exit 0, logbook.md has timestamp entry', function() {
  const tmpDir = makeTempDir();
  try {
    const memDir = setupMemoryDir(tmpDir);
    fs.writeFileSync(path.join(memDir, 'delta_summary_temp.txt'), 'Session summary: fixed bugs, updated docs.');
    const r = runAppendMemory(tmpDir);
    assertEqual(r.status, 0, 'exit code: ' + r.stderr);
    const logbook = fs.readFileSync(path.join(memDir, 'logbook.md'), 'utf8');
    // Timestamp header format: ## YYYY-MM-DD_HHMM (local MM-DD_HHMM)
    assert(/^## \d{4}-\d{2}-\d{2}_\d{4}/m.test(logbook), 'logbook has UTC timestamp header');
    assertIncludes(logbook, 'Session summary: fixed bugs, updated docs.', 'summary content in logbook');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 4. Logbook created if absent
// ============================================================
test('logbook.md created when absent', function() {
  const tmpDir = makeTempDir();
  try {
    const memDir = setupMemoryDir(tmpDir);
    fs.writeFileSync(path.join(memDir, 'delta_summary_temp.txt'), 'Brand new summary.');
    const logbookPath = path.join(memDir, 'logbook.md');
    assert(!fs.existsSync(logbookPath), 'logbook absent before run');
    const r = runAppendMemory(tmpDir);
    assertEqual(r.status, 0, 'exit code: ' + r.stderr);
    assert(fs.existsSync(logbookPath), 'logbook.md created');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 5. Logbook accumulates — pre-existing content preserved
// ============================================================
test('logbook.md accumulates — pre-existing content preserved', function() {
  const tmpDir = makeTempDir();
  try {
    const memDir = setupMemoryDir(tmpDir);
    const logbookPath = path.join(memDir, 'logbook.md');

    // Pre-populate with existing content
    fs.writeFileSync(logbookPath, '## 20260101_0000 (local 01-01_0000)\nOld session notes.\n');
    fs.writeFileSync(path.join(memDir, 'delta_summary_temp.txt'), 'New session summary.');

    const r = runAppendMemory(tmpDir);
    assertEqual(r.status, 0, 'exit code: ' + r.stderr);
    const content = fs.readFileSync(logbookPath, 'utf8');
    assertIncludes(content, 'Old session notes.', 'old content preserved');
    assertIncludes(content, 'New session summary.', 'new content appended');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 6. Temp file deleted after success
// ============================================================
test('delta_summary_temp.txt deleted after successful append', function() {
  const tmpDir = makeTempDir();
  try {
    const memDir = setupMemoryDir(tmpDir);
    const summaryPath = path.join(memDir, 'delta_summary_temp.txt');
    fs.writeFileSync(summaryPath, 'Summary to be cleaned up.');
    const r = runAppendMemory(tmpDir);
    assertEqual(r.status, 0, 'exit code: ' + r.stderr);
    assert(!fs.existsSync(summaryPath), 'delta_summary_temp.txt deleted after success');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 7. Local timestamp also present in header
// ============================================================
test('logbook entry header contains local timestamp in parentheses', function() {
  const tmpDir = makeTempDir();
  try {
    const memDir = setupMemoryDir(tmpDir);
    fs.writeFileSync(path.join(memDir, 'delta_summary_temp.txt'), 'Summary with local ts check.');
    const r = runAppendMemory(tmpDir);
    assertEqual(r.status, 0, 'exit code: ' + r.stderr);
    const content = fs.readFileSync(path.join(memDir, 'logbook.md'), 'utf8');
    // Header format: ## YYYYMMDD_HHMM (local MM-DD_HHMM)
    assert(/\(local \d{2}-\d{2}_\d{4}\)/.test(content), 'local timestamp in parentheses');
  } finally {
    cleanupDir(tmpDir);
  }
});

// Final results
console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total ===');
process.exit(failed > 0 ? 1 : 0);
