// Integration tests for verify-guard.js hybrid fix
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptPath = path.join(__dirname, 'verify-guard.js');
const nodePath = 'C:/Program Files/nodejs/node.exe';
const projectDir = 'C:\\Users\\chulg\\Documents\\memory-keeper-plugin';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label || ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- Integration test helper ---

function runScript(hookData, env) {
  const json = JSON.stringify(hookData);
  try {
    const result = execSync(
      `"${nodePath}" "${scriptPath}"`,
      {
        input: json,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...(env || {}) },
        timeout: 5000,
        encoding: 'utf8'
      }
    );
    return { exitCode: 0, stdout: result };
  } catch (e) {
    return { exitCode: e.status, stdout: e.stdout || '' };
  }
}

// --- Temp file helpers ---

const tmpTicketDir = path.join(projectDir, '.crabshell', 'ticket');
const tmpTestFile = path.join(tmpTicketDir, 'P999_T001-verify-guard-test.md');

function createTempTicketFile(content) {
  fs.mkdirSync(tmpTicketDir, { recursive: true });
  fs.writeFileSync(tmpTestFile, content, 'utf8');
}

function cleanupTempTicketFile() {
  try { fs.unlinkSync(tmpTestFile); } catch {}
}

// ============================================================
// TEST 1: Write to NEW ticket file with FV template → ALLOW
// (file does not exist — new file creation)
// ============================================================

test('Write to new ticket file with FV template → ALLOW (new file, exits early)', () => {
  // Ensure file does NOT exist
  cleanupTempTicketFile();

  const hookData = {
    tool_name: 'Write',
    tool_input: {
      file_path: '.crabshell/ticket/P999_T001-verify-guard-test.md',
      content: '# P999_T001 - Test\n\n## Final Verification\n\nSome FV content here.'
    }
  };

  const result = runScript(hookData);
  // New file → exits early at hybrid check → exit 0 (allow), no verification attempted
  assertEqual(result.exitCode, 0, 'exit code');
});

// ============================================================
// TEST 2: Edit to ticket adding FV results, no verification tool → BLOCK
// ============================================================

test('Edit to ticket adding FV results, no verification tool → BLOCK', () => {
  // We need a project dir that has no run-verify.js
  // Use a temp dir that definitely won't have one
  const tmpDir = path.join(require('os').tmpdir(), 'verify-guard-test-' + process.pid);
  fs.mkdirSync(tmpDir, { recursive: true });

  const hookData = {
    tool_name: 'Edit',
    tool_input: {
      file_path: '.crabshell/ticket/P001_T001-some-ticket.md',
      old_string: '<!-- placeholder -->',
      new_string: '## Final Verification\n\nAll results pass.'
    }
  };

  const result = runScript(hookData, { CLAUDE_PROJECT_DIR: tmpDir });
  // No run-verify.js → blocked
  assertEqual(result.exitCode, 2, 'exit code should be 2 (block)');
  assert(result.stdout.includes('"decision":"block"') || result.stdout.includes('"decision": "block"'), 'stdout should contain block decision');

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
});

// ============================================================
// TEST 3: Write to non-ticket file → ALLOW
// ============================================================

test('Write to non-ticket file → ALLOW (path does not match ticket pattern)', () => {
  const hookData = {
    tool_name: 'Write',
    tool_input: {
      file_path: 'README.md',
      content: '## Final Verification\n\nThis is not a ticket file.'
    }
  };

  const result = runScript(hookData);
  // Non-ticket path → exits early at TICKET_FILE_PATTERN check → exit 0
  assertEqual(result.exitCode, 0, 'exit code');
});

// ============================================================
// TEST 4: Edit to ticket without FV content → ALLOW
// ============================================================

test('Edit to ticket without FV content → ALLOW (no FV section in new_string)', () => {
  const hookData = {
    tool_name: 'Edit',
    tool_input: {
      file_path: '.crabshell/ticket/P001_T001-some-ticket.md',
      old_string: 'old content',
      new_string: 'Updated content without final verification section.'
    }
  };

  const result = runScript(hookData);
  // No FV in new_string → exits at containsFinalVerification check → exit 0
  assertEqual(result.exitCode, 0, 'exit code');
});

// ============================================================
// TEST 5: Edit to ticket with FV + "Verification tool N/A:" marker → ALLOW
// ============================================================

test('Edit to ticket with FV + "Verification tool N/A:" marker → ALLOW', () => {
  const hookData = {
    tool_name: 'Edit',
    tool_input: {
      file_path: '.crabshell/ticket/P001_T001-some-ticket.md',
      old_string: '<!-- placeholder -->',
      new_string: '## Final Verification\n\nVerification tool N/A: This project has no automated tests.\n\nAll work verified manually.'
    }
  };

  const result = runScript(hookData);
  // N/A exception → exits with 0 (allow)
  assertEqual(result.exitCode, 0, 'exit code');
});

// ============================================================
// TEST 6: Non-Write/Edit tool → ALLOW (bail early)
// ============================================================

test('Non-Write/Edit tool → ALLOW (exits early on tool name check)', () => {
  const hookData = {
    tool_name: 'Bash',
    tool_input: {
      command: 'echo "hello"'
    }
  };

  const result = runScript(hookData);
  // Bash is not Write/Edit → exits early → exit 0
  assertEqual(result.exitCode, 0, 'exit code');
});

// ============================================================
// TEST 7: Write to EXISTING ticket file with FV → proceeds to verification
// (file exists — hybrid check does NOT allow early exit)
// ============================================================

test('Write to existing ticket file with FV → proceeds to verification (blocked — no run-verify.js)', () => {
  // Use a temp dir that won't have run-verify.js, but create the ticket file in it
  const tmpDir = path.join(require('os').tmpdir(), 'verify-guard-existing-' + process.pid);
  const tmpTicket = path.join(tmpDir, '.crabshell', 'ticket');
  fs.mkdirSync(tmpTicket, { recursive: true });

  // Create the file so it EXISTS
  const existingFilePath = path.join(tmpTicket, 'P999_T001-existing-ticket.md');
  fs.writeFileSync(existingFilePath, '# Existing ticket\n\n## Some section\n\nContent here.', 'utf8');

  const hookData = {
    tool_name: 'Write',
    tool_input: {
      file_path: '.crabshell/ticket/P999_T001-existing-ticket.md',
      content: '# Existing ticket\n\n## Final Verification\n\nResults here.'
    }
  };

  const result = runScript(hookData, { CLAUDE_PROJECT_DIR: tmpDir });
  // File EXISTS → hybrid check does NOT allow early exit → proceeds to FV check
  // FV present → proceeds to verification → no run-verify.js → BLOCK (exit 2)
  assertEqual(result.exitCode, 2, 'exit code should be 2 (block) — existing file proceeds to verification');
  assert(result.stdout.includes('"decision":"block"') || result.stdout.includes('"decision": "block"'), 'stdout should contain block decision');

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
});

// ============================================================
// SUMMARY
// ============================================================

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
