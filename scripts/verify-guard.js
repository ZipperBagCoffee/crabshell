'use strict';

const path = require('path');
const fs = require('fs');
const { VERIFYING_CALLED_FILE } = require('./constants');

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

function readStdin(timeoutMs = 500) {
  // hook-runner.js v2 stores parsed stdin in HOOK_DATA env var
  if (process.env.HOOK_DATA) {
    try { return Promise.resolve(JSON.parse(process.env.HOOK_DATA)); }
    catch { return Promise.resolve({}); }
  }

  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (result) => { if (!resolved) { resolved = true; resolve(result); } };
    const timer = setTimeout(() => {
      done(data.trim() ? (() => { try { return JSON.parse(data.trim()); } catch { return {}; } })() : {});
    }, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      if (data.trim()) { try { done(JSON.parse(data.trim())); } catch { done({}); } }
      else { done({}); }
    });
    process.stdin.on('error', () => { clearTimeout(timer); done({}); });
    process.stdin.resume();
  });
}

// Ticket file pattern: docs/ticket/P###_T###*
const TICKET_FILE_PATTERN = /docs\/ticket\/P\d{3}_T\d{3}/;

// TTL for verifying-called flag (5 minutes)
const VERIFYING_TTL_MS = 5 * 60 * 1000;

/**
 * Normalize a file path for consistent matching.
 */
function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Check if verifying-called flag is valid (exists, not expired).
 * Returns the flag data if valid, null otherwise.
 */
function getVerifyingFlag(projectDir) {
  const flagPath = path.join(projectDir, '.claude', 'memory', VERIFYING_CALLED_FILE);
  try {
    if (!fs.existsSync(flagPath)) return null;
    const data = JSON.parse(fs.readFileSync(flagPath, 'utf8'));
    if (!data || !data.calledAt || data.mode !== 'run') return null;

    // Check TTL
    const ttl = data.ttl || VERIFYING_TTL_MS;
    const elapsed = Date.now() - new Date(data.calledAt).getTime();
    if (elapsed > ttl) {
      // Expired — clean up
      try { fs.unlinkSync(flagPath); } catch {}
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * Check if the content being written contains Final Verification section.
 * For Write: check content field.
 * For Edit: check new_string field.
 */
function containsFinalVerification(hookData) {
  const input = hookData.tool_input;
  if (!input) return false;

  const toolName = hookData.tool_name;
  if (toolName === 'Write') {
    const content = input.content || '';
    return /## Final Verification/i.test(content);
  }
  if (toolName === 'Edit') {
    const newString = input.new_string || '';
    return /## Final Verification/i.test(newString);
  }
  return false;
}

/**
 * Check if content contains "Verification tool N/A" exception marker.
 * This allows bypass for projects where verification tools are impractical.
 */
function hasVerificationToolNA(hookData) {
  const input = hookData.tool_input;
  if (!input) return false;

  const toolName = hookData.tool_name;
  let content = '';
  if (toolName === 'Write') {
    content = input.content || '';
  } else if (toolName === 'Edit') {
    content = input.new_string || '';
  }

  return /Verification tool N\/A:/i.test(content);
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') { process.exit(0); return; }

  const input = hookData.tool_input;
  if (!input) { process.exit(0); return; }

  const filePath = normalizePath(input.file_path || input.path || '');
  if (!filePath) { process.exit(0); return; }

  // Only guard ticket files
  if (!TICKET_FILE_PATTERN.test(filePath)) { process.exit(0); return; }

  // Only trigger when writing Final Verification section
  if (!containsFinalVerification(hookData)) { process.exit(0); return; }

  // Allow "Verification tool N/A:" exception
  if (hasVerificationToolNA(hookData)) {
    process.stderr.write(`[VERIFY_GUARD] Allowed: ${filePath} — Verification tool N/A exception\n`);
    process.exit(0);
    return;
  }

  const projectDir = getProjectDir();

  // Check if /verifying run was called
  const verifyingFlag = getVerifyingFlag(projectDir);
  if (verifyingFlag) {
    // Flag exists and valid — allow the write
    process.stderr.write(`[VERIFY_GUARD] Allowed: ${filePath} — verifying run called at ${verifyingFlag.calledAt}\n`);
    process.exit(0);
    return;
  }

  // No valid flag — block the write
  const output = {
    decision: "block",
    reason: 'Final Verification section blocked. You MUST run /verifying run before writing Final Verification. Invoke: Skill tool with skill="verifying", args="run". This ensures verification uses the project-specific verification tool, not just reading code.'
  };

  process.stderr.write(`[VERIFY_GUARD] Blocked ${toolName} to ${filePath} — verifying run not called\n`);
  console.log(JSON.stringify(output));
  process.exit(2);
}

main().catch(e => {
  console.error(`[VERIFY GUARD ERROR] ${e.message}`);
  process.exit(0); // fail-open
});
