'use strict';
// _test-pressure-guard.js — Tests for pressure-guard.js
// Tests the L2/L3 blocking logic with .crabshell/.claude/ exceptions.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const scriptPath = path.join(__dirname, 'pressure-guard.js');
const nodePath = process.execPath;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
    passed++;
  } catch (e) {
    console.log('FAIL: ' + name + ' --- ' + e.message);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// Helper: create a temp project dir with memory-index.json at the given pressure level
function makeTempProject(level) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-pg-test-'));
  const memDir = path.join(dir, '.crabshell', 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  const index = {
    feedbackPressure: {
      level: level,
      consecutiveCount: level,
      lastDetectedAt: null,
      decayCounter: 0
    }
  };
  fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify(index), 'utf8');
  return dir;
}

function cleanupDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

// Run pressure-guard.js as subprocess, returns { exitCode, stdout, stderr }
function runGuard(projectDir, hookData) {
  const input = JSON.stringify(hookData);
  try {
    const stdout = execSync(
      `"${nodePath}" "${scriptPath}"`,
      {
        input: input,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
        timeout: 5000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );
    return { exitCode: 0, stdout: stdout || '' };
  } catch (e) {
    return { exitCode: e.status || 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

// ============================================================
// PG-1: level=0, Read tool → exit(0)
// ============================================================
test('PG-1: level=0, Read tool → exit(0) (allowed)', function() {
  const dir = makeTempProject(0);
  try {
    const result = runGuard(dir, {
      tool_name: 'Read',
      tool_input: { file_path: '/some/regular/file.js' }
    });
    assert(result.exitCode === 0, 'expected exit(0), got ' + result.exitCode);
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-2: level=1, Bash tool → exit(0)
// ============================================================
test('PG-2: level=1, Bash tool → exit(0) (allowed)', function() {
  const dir = makeTempProject(1);
  try {
    const result = runGuard(dir, {
      tool_name: 'Bash',
      tool_input: { command: 'ls /tmp' }
    });
    assert(result.exitCode === 0, 'expected exit(0), got ' + result.exitCode);
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-3: level=2, Read tool, normal path → exit(2) blocked
// ============================================================
test('PG-3: level=2, Read tool, normal path → exit(2) (blocked)', function() {
  const dir = makeTempProject(2);
  try {
    const result = runGuard(dir, {
      tool_name: 'Read',
      tool_input: { file_path: '/some/project/src/main.js' }
    });
    assert(result.exitCode === 2, 'expected exit(2), got ' + result.exitCode);
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-4: level=2, TaskCreate tool → exit(0) allowed
// ============================================================
test('PG-4: level=2, TaskCreate tool → exit(0) (allowed, not in BLOCKED_TOOLS)', function() {
  const dir = makeTempProject(2);
  try {
    const result = runGuard(dir, {
      tool_name: 'TaskCreate',
      tool_input: { description: 'do something' }
    });
    assert(result.exitCode === 0, 'expected exit(0), got ' + result.exitCode);
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-5: level=2, Read tool, .crabshell/ path → exit(0) allowed
// ============================================================
test('PG-5: level=2, Read tool, .crabshell/ path → exit(0) (exception)', function() {
  const dir = makeTempProject(2);
  try {
    const result = runGuard(dir, {
      tool_name: 'Read',
      tool_input: { file_path: dir.replace(/\\/g, '/') + '/.crabshell/memory/logbook.md' }
    });
    assert(result.exitCode === 0, 'expected exit(0) for .crabshell/ path, got ' + result.exitCode);
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-6: level=2 block message contains "problem analysis" or "Complete"
// ============================================================
test('PG-6: level=2 block message contains "problem analysis" or "Complete"', function() {
  const dir = makeTempProject(2);
  try {
    const result = runGuard(dir, {
      tool_name: 'Bash',
      tool_input: { command: 'cat /some/file.txt' }
    });
    assert(result.exitCode === 2, 'expected exit(2), got ' + result.exitCode);
    const outputStr = result.stdout || '';
    let parsed;
    try { parsed = JSON.parse(outputStr); } catch(e) { throw new Error('stdout is not valid JSON: ' + outputStr); }
    const reason = parsed.reason || '';
    assert(
      reason.toLowerCase().includes('problem analysis') || reason.toLowerCase().includes('complete'),
      'L2 message should contain "problem analysis" or "Complete", got: ' + reason
    );
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-7: level=3, TaskCreate tool → exit(2) blocked
// ============================================================
test('PG-7: level=3, TaskCreate tool → exit(2) (L3 blocks all tools)', function() {
  const dir = makeTempProject(3);
  try {
    const result = runGuard(dir, {
      tool_name: 'TaskCreate',
      tool_input: { description: 'delegate task' }
    });
    assert(result.exitCode === 2, 'expected exit(2) at L3, got ' + result.exitCode);
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-8: level=3, Read tool → exit(2) blocked
// ============================================================
test('PG-8: level=3, Read tool → exit(2) (blocked)', function() {
  const dir = makeTempProject(3);
  try {
    const result = runGuard(dir, {
      tool_name: 'Read',
      tool_input: { file_path: '/some/file.js' }
    });
    assert(result.exitCode === 2, 'expected exit(2), got ' + result.exitCode);
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-9: level=3, Edit tool, .crabshell/ path → exit(0) allowed
// ============================================================
test('PG-9: level=3, Edit tool, .crabshell/ path → exit(0) (exception)', function() {
  const dir = makeTempProject(3);
  try {
    const result = runGuard(dir, {
      tool_name: 'Edit',
      tool_input: {
        file_path: dir.replace(/\\/g, '/') + '/.crabshell/memory/logbook.md',
        old_string: 'old',
        new_string: 'new'
      }
    });
    assert(result.exitCode === 0, 'expected exit(0) for .crabshell/ path at L3, got ' + result.exitCode);
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-10: level=3 block message does NOT contain "TaskCreate" as escape
// ============================================================
test('PG-10: level=3 block message does NOT contain "TaskCreate" as escape route', function() {
  const dir = makeTempProject(3);
  try {
    const result = runGuard(dir, {
      tool_name: 'Bash',
      tool_input: { command: 'ls /tmp' }
    });
    assert(result.exitCode === 2, 'expected exit(2), got ' + result.exitCode);
    const outputStr = result.stdout || '';
    let parsed;
    try { parsed = JSON.parse(outputStr); } catch(e) { throw new Error('stdout is not valid JSON: ' + outputStr); }
    const reason = parsed.reason || '';
    // Should not suggest TaskCreate resets pressure or unblocks
    const escapeSuggestion = /TaskCreate resets|TaskCreate.*unblocks|Use TaskCreate/i;
    assert(
      !escapeSuggestion.test(reason),
      'L3 message should not suggest TaskCreate as escape, got: ' + reason
    );
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-11: level=3 block message contains "structured self-diagnosis" or "All tools locked"
// ============================================================
test('PG-11: level=3 block message contains "structured self-diagnosis" or "All tools locked"', function() {
  const dir = makeTempProject(3);
  try {
    const result = runGuard(dir, {
      tool_name: 'Write',
      tool_input: { file_path: '/some/file.txt', content: 'hello' }
    });
    assert(result.exitCode === 2, 'expected exit(2), got ' + result.exitCode);
    const outputStr = result.stdout || '';
    let parsed;
    try { parsed = JSON.parse(outputStr); } catch(e) { throw new Error('stdout is not valid JSON: ' + outputStr); }
    const reason = (parsed.reason || '').toLowerCase();
    assert(
      reason.includes('structured self-diagnosis') || reason.includes('all tools locked'),
      'L3 message should contain "structured self-diagnosis" or "All tools locked", got: ' + parsed.reason
    );
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-13: level=2 block message contains "bailout" or "user-only"
// ============================================================
test('PG-13: level=2 block message contains "bailout" or "user-only" (case-insensitive)', function() {
  const dir = makeTempProject(2);
  try {
    const result = runGuard(dir, {
      tool_name: 'Bash',
      tool_input: { command: 'cat /some/file.txt' }
    });
    assert(result.exitCode === 2, 'expected exit(2), got ' + result.exitCode);
    const outputStr = result.stdout || '';
    let parsed;
    try { parsed = JSON.parse(outputStr); } catch(e) { throw new Error('stdout is not valid JSON: ' + outputStr); }
    const reason = (parsed.reason || '').toLowerCase();
    assert(
      reason.includes('bailout') || reason.includes('user-only'),
      'L2 message should contain "bailout" or "user-only", got: ' + parsed.reason
    );
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-14: level=3 block message contains "bailout" or "user-only"
// ============================================================
test('PG-14: level=3 block message contains "bailout" or "user-only" (case-insensitive)', function() {
  const dir = makeTempProject(3);
  try {
    const result = runGuard(dir, {
      tool_name: 'Write',
      tool_input: { file_path: '/some/file.txt', content: 'hello' }
    });
    assert(result.exitCode === 2, 'expected exit(2), got ' + result.exitCode);
    const outputStr = result.stdout || '';
    let parsed;
    try { parsed = JSON.parse(outputStr); } catch(e) { throw new Error('stdout is not valid JSON: ' + outputStr); }
    const reason = (parsed.reason || '').toLowerCase();
    assert(
      reason.includes('bailout') || reason.includes('user-only'),
      'L3 message should contain "bailout" or "user-only", got: ' + parsed.reason
    );
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// PG-12: no index file → exit(0) fail-open
// ============================================================
test('PG-12: no index file → exit(0) (fail-open)', function() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-pg-noindex-'));
  // No .crabshell/memory/ directory or memory-index.json created
  try {
    const result = runGuard(dir, {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /important/data' }
    });
    assert(result.exitCode === 0, 'expected exit(0) fail-open when no index, got ' + result.exitCode);
  } finally {
    cleanupDir(dir);
  }
});

// ============================================================
// Summary
// ============================================================
console.log('\n========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
console.log('========================================');
if (failed > 0) {
  process.exit(1);
}
