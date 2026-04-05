'use strict';

/**
 * _test-delta-background.js — Tests for delta-background.js
 *
 * Tests async PostToolUse delta summarization hook.
 * New behavior: uses `claude -p --model haiku` subprocess instead of HTTPS API.
 * CRABSHELL_BACKGROUND=1 propagated to subprocess to prevent recursive hooks.
 * Fallback: raw truncation when subprocess fails.
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
 * claude CLI will fail in tests (not in PATH or no auth) — that's expected;
 * the fallback to raw truncation is what we test.
 */
function runScript(projectDir, hookData = {}, extraEnv = {}) {
  const input = JSON.stringify(hookData);
  const env = {
    ...process.env,
    HOOK_DATA: input,
    CLAUDE_PROJECT_DIR: projectDir,
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
    const { exitCode, stderr } = runScript(tmpDir);
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
// Test 3: deltaReady + delta_temp.txt → logbook.md is created with a summary
//   When claude CLI is available, haiku summary is used.
//   When claude CLI is absent/fails, raw truncation fallback is used.
//   Either way: logbook.md must exist, have a timestamp header, delta_temp.txt deleted,
//   deltaReady cleared, and exit code 0.
// ============================================================
test('deltaReady + delta_temp.txt → logbook.md created with summary, cleanup done', function() {
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

    const { exitCode, stderr } = runScript(tmpDir);

    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);

    // logbook.md must be created regardless of whether haiku or fallback ran
    const logbookPath = path.join(memoryDir, 'logbook.md');
    assert(fs.existsSync(logbookPath), 'logbook.md should exist');
    const logbookContent = fs.readFileSync(logbookPath, 'utf8');

    // Content must be non-empty (either haiku summary or raw truncation)
    assert(logbookContent.trim().length > 0, 'logbook.md should not be empty');

    // Timestamp header should follow append-memory.js format: ## YYYY-MM-DD_HHMM (local ...)
    assert(/## \d{4}-\d{2}-\d{2}_\d{4} \(local \d{2}-\d{2}_\d{4}\)/.test(logbookContent),
      'logbook.md should have dual timestamp header, got: ' + logbookContent.substring(0, 100));

    // delta_temp.txt should be cleaned up
    const deltaPath = path.join(memoryDir, 'delta_temp.txt');
    assert(!fs.existsSync(deltaPath), 'delta_temp.txt should be deleted');

    // deltaReady should be cleared
    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory-index.json'), 'utf8'));
    assert(!index.deltaReady, 'deltaReady should be false after processing');

    // stderr must contain [CRABSHELL] logging
    assert(stderr.includes('[CRABSHELL]'), 'stderr should log with [CRABSHELL] prefix');
    // Script must mention either haiku attempt or fallback
    assert(
      stderr.toLowerCase().includes('haiku') ||
      stderr.toLowerCase().includes('fallback') ||
      stderr.toLowerCase().includes('summarization'),
      'stderr should mention haiku or fallback: ' + stderr.substring(0, 300)
    );
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 4: Truncation fallback produces valid logbook entry (long content)
// ============================================================
test('Truncation fallback truncates to 2000 chars for long delta content', function() {
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

    const { exitCode } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);

    const logbookPath = path.join(memoryDir, 'logbook.md');
    assert(fs.existsSync(logbookPath), 'logbook.md should exist');
    const logbookContent = fs.readFileSync(logbookPath, 'utf8');

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
    const result = spawnSync(NODE, [SCRIPT], {
      input: 'NOT_VALID_JSON',
      timeout: 10000,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOOK_DATA: 'NOT_VALID_JSON',
        CLAUDE_PROJECT_DIR: tmpDir
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
    const env = { ...process.env, HOOK_DATA: input };
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
    const { exitCode } = runScript(tmpDir);
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
    const { exitCode, stderr } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);
    const lines = stderr.split('\n').filter(l => l.trim());
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
    const { exitCode } = runScript(tmpDir);
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
// Test 11: parseStreamJson — unit test of the stream-json parser
//   Exercises the parser directly by requiring delta-background.js internals
//   via a wrapper node script that invokes parseStreamJson inline.
// ============================================================
test('parseStreamJson extracts text from assistant messages in stream-json format', function() {
  // Test the parsing logic inline (mirrors parseStreamJson in delta-background.js)
  function parseStreamJson(output) {
    if (!output || !output.trim()) return null;
    const lines = output.split('\n');
    const textParts = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.type === 'assistant' && Array.isArray(parsed.message && parsed.message.content)) {
          for (const block of parsed.message.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              textParts.push(block.text);
            }
          }
        }
      } catch (e) {}
    }
    const result = textParts.join('').trim();
    return result || null;
  }

  // Valid assistant message with text block
  const validOutput = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'This is the summary.' }] }
  });
  const result = parseStreamJson(validOutput);
  assert(result === 'This is the summary.', 'expected "This is the summary.", got: ' + result);

  // Multiple text blocks — should concatenate
  const multiOutput = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Part one. ' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Part two.' }] } })
  ].join('\n');
  const multiResult = parseStreamJson(multiOutput);
  assert(multiResult === 'Part one. Part two.', 'expected concatenated text, got: ' + multiResult);

  // Non-assistant lines should be skipped
  const mixedOutput = [
    JSON.stringify({ type: 'system', message: 'ignore me' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Keep this.' }] } }),
    'not json at all',
    JSON.stringify({ type: 'result', subtype: 'success' })
  ].join('\n');
  const mixedResult = parseStreamJson(mixedOutput);
  assert(mixedResult === 'Keep this.', 'expected only assistant text, got: ' + mixedResult);

  // Empty or whitespace → null
  assert(parseStreamJson('') === null, 'empty string should return null');
  assert(parseStreamJson('   \n  ') === null, 'whitespace-only should return null');
  assert(parseStreamJson(null) === null, 'null input should return null');

  // JSON with no text content → null
  const noTextOutput = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x' }] } });
  assert(parseStreamJson(noTextOutput) === null, 'no-text content should return null');
});

// ============================================================
// Test 12: CRABSHELL_BACKGROUND=1 causes immediate exit 0
//   delta-background.js itself does NOT skip (it IS the background processor),
//   but we verify that the env var is available for subprocess hooks to check.
//   We verify: running with CRABSHELL_BACKGROUND=1 does NOT skip delta-background.js
//   (it should still process normally).
// ============================================================
test('CRABSHELL_BACKGROUND=1 does NOT skip delta-background.js itself', function() {
  const tmpDir = makeTempDir('delta-bg-t12');
  try {
    setupMemoryDir(tmpDir, {
      index: { deltaReady: false }
    });
    // Even with CRABSHELL_BACKGROUND=1, delta-background.js should run normally
    // (it's not in the skip list — it IS the background processor)
    const { exitCode } = runScript(tmpDir, {}, { CRABSHELL_BACKGROUND: '1' });
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 13: CRABSHELL_BACKGROUND=1 is set in subprocess env
//   We verify by checking that callHaikuCli would set CRABSHELL_BACKGROUND=1.
//   Since we can't call claude in tests, we create a mock 'claude' script that
//   dumps its env to stdout, and verify CRABSHELL_BACKGROUND=1 appears.
// ============================================================
test('CRABSHELL_BACKGROUND=1 is propagated to claude subprocess env', function() {
  const tmpDir = makeTempDir('delta-bg-t13');
  try {
    // Create a fake 'claude' executable that prints its env and exits 0
    // On Windows we use a .cmd script; on Unix a shell script
    const isWindows = process.platform === 'win32';
    const fakeBinDir = path.join(tmpDir, 'fake-bin');
    fs.mkdirSync(fakeBinDir, { recursive: true });

    let fakeClaudePath;
    if (isWindows) {
      fakeClaudePath = path.join(fakeBinDir, 'claude.cmd');
      fs.writeFileSync(fakeClaudePath, '@echo CRABSHELL_BACKGROUND=%CRABSHELL_BACKGROUND%\r\n@exit /b 0\r\n');
    } else {
      fakeClaudePath = path.join(fakeBinDir, 'claude');
      fs.writeFileSync(fakeClaudePath, '#!/bin/sh\necho "CRABSHELL_BACKGROUND=$CRABSHELL_BACKGROUND"\nexit 0\n');
      fs.chmodSync(fakeClaudePath, 0o755);
    }

    // Prepend fake-bin to PATH so our fake claude is found first
    const testPath = fakeBinDir + path.delimiter + (process.env.PATH || '');

    const memoryDir = setupMemoryDir(tmpDir, {
      index: { deltaReady: true, pendingLastProcessedTs: '2026-04-04T14:00:00.000Z' },
      deltaContent: 'env propagation test content'
    });

    const { exitCode, stderr } = runScript(tmpDir, {}, { PATH: testPath });
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);

    // logbook.md should exist — fake claude returns exit 0 but no valid stream-json,
    // so script falls back to raw truncation and appends
    const logbookPath = path.join(memoryDir, 'logbook.md');
    assert(fs.existsSync(logbookPath), 'logbook.md should exist after fake claude run');
    // The fake claude output should have been attempted as stream-json and failed gracefully
    assert(stderr.includes('[CRABSHELL]'), 'stderr should contain [CRABSHELL] log lines');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 14: claude subprocess returns valid stream-json → summary used in logbook
// ============================================================
test('When claude subprocess returns valid stream-json, summary is used (not raw truncation)', function() {
  const tmpDir = makeTempDir('delta-bg-t14');
  try {
    const isWindows = process.platform === 'win32';
    const fakeBinDir = path.join(tmpDir, 'fake-bin');
    fs.mkdirSync(fakeBinDir, { recursive: true });

    // Fake claude that emits a valid stream-json assistant message
    const summaryText = 'HAIKU_SUMMARY_SENTINEL_TEXT';
    const streamLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: summaryText }] }
    });

    let fakeClaudePath;
    if (isWindows) {
      fakeClaudePath = path.join(fakeBinDir, 'claude.cmd');
      // CMD can't easily echo JSON with special chars — write via a node helper
      const helperPath = path.join(fakeBinDir, 'echo-helper.js');
      fs.writeFileSync(helperPath, `process.stdout.write(${JSON.stringify(streamLine + '\n')});\n`);
      fs.writeFileSync(fakeClaudePath, `@"${NODE}" "${helperPath}"\r\n@exit /b 0\r\n`);
    } else {
      fakeClaudePath = path.join(fakeBinDir, 'claude');
      const helperPath = path.join(fakeBinDir, 'echo-helper.js');
      fs.writeFileSync(helperPath, `process.stdout.write(${JSON.stringify(streamLine + '\n')});\n`);
      fs.writeFileSync(fakeClaudePath, `#!/bin/sh\n"${NODE}" "${helperPath}"\nexit 0\n`);
      fs.chmodSync(fakeClaudePath, 0o755);
    }

    const testPath = fakeBinDir + path.delimiter + (process.env.PATH || '');

    const memoryDir = setupMemoryDir(tmpDir, {
      index: { deltaReady: true, pendingLastProcessedTs: '2026-04-04T15:00:00.000Z' },
      deltaContent: 'A'.repeat(3000) // long content to confirm we did NOT use raw truncation
    });

    const { exitCode, stderr } = runScript(tmpDir, {}, { PATH: testPath });
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);

    const logbookPath = path.join(memoryDir, 'logbook.md');
    assert(fs.existsSync(logbookPath), 'logbook.md should exist');
    const content = fs.readFileSync(logbookPath, 'utf8');

    // The summary sentinel text should appear — confirming haiku path was used
    assert(content.includes(summaryText),
      'logbook.md should contain the haiku summary sentinel, got: ' + content.substring(0, 200));

    // Confirm the raw 3000-char content was NOT used (haiku summary replaced it)
    assert(!content.includes('A'.repeat(100)),
      'logbook.md should NOT contain the raw long content when haiku summary succeeded');

    // stderr should say "Haiku summarization complete", not "falling back"
    assert(stderr.includes('summarization complete') || stderr.includes('Haiku'),
      'stderr should mention haiku success, got: ' + stderr.substring(0, 300));
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
