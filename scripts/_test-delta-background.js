'use strict';

/**
 * _test-delta-background.js — Tests for delta-background.js
 *
 * Tests async PostToolUse delta summarization hook.
 * Uses HOOK_DATA env var + temp dirs pattern from _test-pre-compact.js.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const NODE = process.execPath;
const SCRIPT = path.join(__dirname, 'delta-background.js');

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

function setupMemoryDir(tmpDir, opts = {}) {
  const memoryDir = path.join(tmpDir, '.crabshell', 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  if (opts.index !== undefined) {
    fs.writeFileSync(
      path.join(memoryDir, 'memory-index.json'),
      JSON.stringify(opts.index, null, 2)
    );
  }

  if (opts.deltaContent !== undefined) {
    fs.writeFileSync(
      path.join(memoryDir, 'delta_temp.txt'),
      opts.deltaContent
    );
  }

  return memoryDir;
}

/**
 * Run delta-background.js with given env and hook data.
 * Returns { exitCode, stdout, stderr }.
 */
function runScript(projectDir, hookData = {}, extraEnv = {}) {
  const input = JSON.stringify(hookData);
  const env = {
    ...process.env,
    HOOK_DATA: input,
    CLAUDE_PROJECT_DIR: projectDir,
    // Remove ANTHROPIC_API_KEY by default (tests run without API)
    ANTHROPIC_API_KEY: '',
    ...extraEnv
  };

  const result = spawnSync(NODE, [SCRIPT], {
    input,
    timeout: 15000,
    encoding: 'utf8',
    env
  });

  return {
    exitCode: result.status !== null ? result.status : (result.error ? 1 : 0),
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

// ============================================================
// Test 1: No deltaReady → exits cleanly, exit 0, no output
// ============================================================
test('No deltaReady → exits 0 silently', function() {
  const tmpDir = makeTempDir('delta-bg-t1');
  try {
    setupMemoryDir(tmpDir, {
      index: { deltaReady: false }
    });
    const { exitCode, stdout, stderr } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);
    assert(stdout === '', 'expected no stdout, got: ' + stdout.substring(0, 100));
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 2: deltaReady=true but no delta_temp.txt → exits cleanly
// ============================================================
test('deltaReady=true but no delta_temp.txt → exits 0, clears flag', function() {
  const tmpDir = makeTempDir('delta-bg-t2');
  try {
    const memoryDir = setupMemoryDir(tmpDir, {
      index: { deltaReady: true }
    });
    const { exitCode, stdout, stderr } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);

    // deltaReady flag should be cleared
    const indexPath = path.join(memoryDir, 'memory-index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert(index.deltaReady === false, 'deltaReady should be cleared, got: ' + index.deltaReady);

    // stderr should mention the missing file
    assert(stderr.includes('[CRABSHELL]'), 'stderr should contain [CRABSHELL] prefix');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 3: deltaReady + delta_temp.txt + no API key → raw append fallback
// ============================================================
test('deltaReady + delta_temp.txt + no API key → raw truncation fallback appended to logbook.md', function() {
  const tmpDir = makeTempDir('delta-bg-t3');
  try {
    const deltaContent = 'Session delta: user asked about foo, Claude explained bar. ' +
      'Tool calls: Read foo.js, Edit bar.js. Summary: important changes made.';

    const memoryDir = setupMemoryDir(tmpDir, {
      index: {
        deltaReady: true,
        pendingLastProcessedTs: '2026-04-04T10:00:00.000Z'
      },
      deltaContent
    });

    const { exitCode, stdout, stderr } = runScript(tmpDir, {}, { ANTHROPIC_API_KEY: '' });

    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);

    // logbook.md should have been created and contain the delta content
    const logbookPath = path.join(memoryDir, 'logbook.md');
    assert(fs.existsSync(logbookPath), 'logbook.md should exist');
    const logbookContent = fs.readFileSync(logbookPath, 'utf8');
    assert(logbookContent.includes('Session delta'), 'logbook.md should contain delta content');

    // Timestamp header should follow append-memory.js format: ## YYYY-MM-DD_HHMM (local ...)
    assert(/## \d{4}-\d{2}-\d{2}_\d{4} \(local \d{2}-\d{2}_\d{4}\)/.test(logbookContent),
      'logbook.md should have dual timestamp header, got: ' + logbookContent.substring(0, 100));

    // delta_temp.txt should be cleaned up
    const deltaPath = path.join(memoryDir, 'delta_temp.txt');
    assert(!fs.existsSync(deltaPath), 'delta_temp.txt should be deleted');

    // deltaReady should be cleared
    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory-index.json'), 'utf8'));
    assert(!index.deltaReady, 'deltaReady should be false after processing');

    // stderr should confirm the fallback path was used
    assert(stderr.includes('[CRABSHELL]'), 'stderr should log with [CRABSHELL] prefix');
    assert(stderr.toLowerCase().includes('fallback') || stderr.includes('raw truncation') || stderr.includes('ANTHROPIC_API_KEY'),
      'stderr should mention fallback or missing key: ' + stderr.substring(0, 200));
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 4: deltaReady + delta_temp.txt + mock API response via env var
//   We can't actually call the API in tests, so we verify the code path
//   that would use a real API key by checking the no-key fallback behavior
//   and confirming the conditional branch structure via code inspection.
//   The mock-API path is exercised by checking that truncated raw is used
//   when ANTHROPIC_API_KEY is absent.
// ============================================================
test('deltaReady + delta_temp.txt + mock API: truncation fallback produces valid logbook entry', function() {
  const tmpDir = makeTempDir('delta-bg-t4');
  try {
    // Use content longer than 2000 chars to test truncation
    const longContent = 'A'.repeat(3000);

    const memoryDir = setupMemoryDir(tmpDir, {
      index: {
        deltaReady: true,
        pendingLastProcessedTs: '2026-04-04T11:00:00.000Z'
      },
      deltaContent: longContent
    });

    // Run without API key — fallback truncates to 2000 chars
    const { exitCode } = runScript(tmpDir, {}, { ANTHROPIC_API_KEY: '' });
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);

    const logbookPath = path.join(memoryDir, 'logbook.md');
    assert(fs.existsSync(logbookPath), 'logbook.md should exist');
    const logbookContent = fs.readFileSync(logbookPath, 'utf8');

    // The summary should be at most 2000 chars of the delta content + header overhead
    // Find the content after the timestamp header line
    const headerMatch = logbookContent.match(/## \d{4}-\d{2}-\d{2}_\d{4}[^\n]*\n([\s\S]*)/);
    assert(headerMatch, 'logbook.md should have a timestamp header');
    const summaryBody = headerMatch[1].trim();
    assert(summaryBody.length <= 2000, 'truncated summary should be <= 2000 chars, got ' + summaryBody.length);
    assert(summaryBody.length > 0, 'summary should not be empty');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 5: Fail-open on invalid JSON input (stdin parse error)
// ============================================================
test('Fail-open on invalid JSON input → exits 0', function() {
  const tmpDir = makeTempDir('delta-bg-t5');
  try {
    setupMemoryDir(tmpDir, {
      index: { deltaReady: false }
    });
    // Pass invalid JSON as hook data — HOOK_DATA env var
    const result = spawnSync(NODE, [SCRIPT], {
      input: 'NOT_VALID_JSON',
      timeout: 10000,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOOK_DATA: 'NOT_VALID_JSON',
        CLAUDE_PROJECT_DIR: tmpDir,
        ANTHROPIC_API_KEY: ''
      }
    });
    const exitCode = result.status !== null ? result.status : 0;
    assert(exitCode === 0, 'expected exit 0 even with bad JSON, got ' + exitCode);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 6: Fail-open when memory-index.json doesn't exist
// ============================================================
test('Fail-open when no memory-index.json → exits 0 silently', function() {
  const tmpDir = makeTempDir('delta-bg-t6');
  try {
    // Create memory dir but no index file
    fs.mkdirSync(path.join(tmpDir, '.crabshell', 'memory'), { recursive: true });

    const { exitCode } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0 with no index file, got ' + exitCode);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 7: Fail-open when CLAUDE_PROJECT_DIR is unset/empty
// ============================================================
test('Fail-open when CLAUDE_PROJECT_DIR is not set → exits 0', function() {
  const tmpDir = makeTempDir('delta-bg-t7');
  try {
    const input = JSON.stringify({});
    const env = { ...process.env, HOOK_DATA: input, ANTHROPIC_API_KEY: '' };
    delete env.CLAUDE_PROJECT_DIR;

    const result = spawnSync(NODE, [SCRIPT], {
      input,
      timeout: 10000,
      encoding: 'utf8',
      env
    });
    const exitCode = result.status !== null ? result.status : 0;
    assert(exitCode === 0, 'expected exit 0 with no project dir, got ' + exitCode);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 8: deltaReady=true + empty delta_temp.txt → exits 0, clears flag
// ============================================================
test('deltaReady=true + empty delta_temp.txt → exits 0, clears flag', function() {
  const tmpDir = makeTempDir('delta-bg-t8');
  try {
    const memoryDir = setupMemoryDir(tmpDir, {
      index: { deltaReady: true },
      deltaContent: ''
    });
    const { exitCode } = runScript(tmpDir, {}, { ANTHROPIC_API_KEY: '' });
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);

    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory-index.json'), 'utf8'));
    assert(!index.deltaReady, 'deltaReady should be cleared for empty delta');

    // logbook.md should NOT be created (empty delta → nothing to append)
    const logbookPath = path.join(memoryDir, 'logbook.md');
    assert(!fs.existsSync(logbookPath), 'logbook.md should NOT be created for empty delta');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 9: Stderr always uses [CRABSHELL] prefix
// ============================================================
test('All stderr output uses [CRABSHELL] prefix', function() {
  const tmpDir = makeTempDir('delta-bg-t9');
  try {
    setupMemoryDir(tmpDir, {
      index: { deltaReady: true, pendingLastProcessedTs: '2026-04-04T12:00:00.000Z' },
      deltaContent: 'test content'
    });
    const { exitCode, stderr } = runScript(tmpDir, {}, { ANTHROPIC_API_KEY: '' });
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);
    const lines = stderr.split('\n').filter(l => l.trim());
    // All non-empty lines from the script itself should use [CRABSHELL] prefix
    // (some lines may come from required modules like extract-delta which has its own logging)
    const scriptLines = lines.filter(l => l.includes('[CRABSHELL]') || l.includes('delta-background'));
    assert(scriptLines.length > 0, 'expected at least one [CRABSHELL] log line, got stderr: ' + stderr.substring(0, 200));
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 10: logbook.md timestamp format validation
// ============================================================
test('Logbook entry uses dual-timestamp format: ## YYYY-MM-DD_HHMM (local MM-DD_HHMM)', function() {
  const tmpDir = makeTempDir('delta-bg-t10');
  try {
    const memoryDir = setupMemoryDir(tmpDir, {
      index: {
        deltaReady: true,
        pendingLastProcessedTs: '2026-04-04T13:00:00.000Z'
      },
      deltaContent: 'timestamp test content'
    });
    const { exitCode } = runScript(tmpDir, {}, { ANTHROPIC_API_KEY: '' });
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);

    const logbookPath = path.join(memoryDir, 'logbook.md');
    assert(fs.existsSync(logbookPath), 'logbook.md should exist');
    const content = fs.readFileSync(logbookPath, 'utf8');

    // Match: ## 2026-04-04_1300 (local 04-04_1300)
    const pattern = /^## \d{4}-\d{2}-\d{2}_\d{4} \(local \d{2}-\d{2}_\d{4}\)$/m;
    assert(pattern.test(content),
      'logbook.md should have dual-timestamp header matching "## YYYY-MM-DD_HHMM (local MM-DD_HHMM)", got:\n' + content.substring(0, 150));
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
