'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { readStdin, normalizePath } = require('./transcript-utils');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

// Ticket file pattern: .crabshell/ticket/P###_T###*
const TICKET_FILE_PATTERN = /\.crabshell\/ticket\/P\d{3}_T\d{3}/;

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

  // Hybrid fix: Write to NEW file (creation) → allow without verification
  // Write to EXISTING file → proceed to verification (prevents bypass)
  if (toolName === 'Write') {
    const projectDir = getProjectDir();
    const absPath = path.resolve(projectDir, filePath);
    if (!fs.existsSync(absPath)) {
      process.exit(0);
      return;
    }
  }

  // Only trigger when writing Final Verification section
  if (!containsFinalVerification(hookData)) { process.exit(0); return; }

  // Allow "Verification tool N/A:" exception
  if (hasVerificationToolNA(hookData)) {
    process.stderr.write(`[VERIFY_GUARD] Allowed: ${filePath} — Verification tool N/A exception\n`);
    process.exit(0);
    return;
  }

  const projectDir = getProjectDir();

  // Deterministic verification: execute run-verify.js directly
  const { STORAGE_ROOT } = require('./constants');
  const runVerifyPath = path.join(projectDir, STORAGE_ROOT, 'verification', 'run-verify.js');
  if (!fs.existsSync(runVerifyPath)) {
    const output = {
      decision: "block",
      reason: 'Final Verification section blocked. No verification tool found at .crabshell/verification/run-verify.js. You MUST run /verifying to create the verification manifest first, then /verifying run. Invoke: Skill tool with skill="verifying".'
    };
    process.stderr.write(`[VERIFY_GUARD] Blocked ${toolName} to ${filePath} — no verification tool found\n`);
    console.log(JSON.stringify(output));
    process.exit(2);
    return;
  }

  // Execute run-verify.js and check results
  try {
    const stdout = execSync(`node "${runVerifyPath}"`, {
      timeout: 30000,
      encoding: 'utf8',
      cwd: projectDir
    });

    // Parse JSON results (first JSON array in stdout)
    const jsonMatch = stdout.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      process.stderr.write(`[VERIFY_GUARD] Allowed: ${filePath} — run-verify.js produced no parseable results\n`);
      process.exit(0);
      return;
    }

    const results = JSON.parse(jsonMatch[0]);
    const failures = results.filter(r => r.status === 'FAIL');
    if (failures.length > 0) {
      const failDetails = failures.map(f => `${f.id}: ${f.error || f.output || 'FAIL'}`).join('; ');
      const output = {
        decision: "block",
        reason: `Final Verification section blocked. Verification tool found failures: ${failDetails}. Fix failures before writing Final Verification.`
      };
      process.stderr.write(`[VERIFY_GUARD] Blocked ${toolName} to ${filePath} — verification failures: ${failDetails}\n`);
      console.log(JSON.stringify(output));
      process.exit(2);
      return;
    }

    // --- Behavioral AC enforcement: at least 1 "direct" type required ---
    const manifestPath = path.join(projectDir, STORAGE_ROOT, 'verification', 'manifest.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const entries = manifest.entries || [];
      const hasDirectType = entries.some(e => e.type === 'direct');
      if (!hasDirectType) {
        const output = {
          decision: "block",
          reason: `Final Verification blocked. Manifest has ${entries.length} entries but none with type "direct" (behavioral). At least 1 behavioral AC is required. Update manifest at ${manifestPath}.`
        };
        process.stderr.write(`[VERIFY_GUARD] Blocked: no behavioral (direct) AC in manifest\n`);
        console.log(JSON.stringify(output));
        process.exit(2);
        return;
      }
    } catch (manifestErr) {
      process.stderr.write(`[VERIFY_GUARD] Warning: could not read manifest for behavioral AC check: ${manifestErr.message}\n`);
    }

    // All PASS
    process.stderr.write(`[VERIFY_GUARD] Allowed: ${filePath} — all ${results.length} verification entries passed\n`);
    process.exit(0);
  } catch (execErr) {
    // Non-zero exit means FAILs exist — parse stdout from the error
    if (execErr.stdout) {
      const jsonMatch = execErr.stdout.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          const results = JSON.parse(jsonMatch[0]);
          const failures = results.filter(r => r.status === 'FAIL');
          const failDetails = failures.map(f => `${f.id}: ${f.error || f.output || 'FAIL'}`).join('; ');
          const output = {
            decision: "block",
            reason: `Final Verification section blocked. Verification tool found failures: ${failDetails}. Fix failures before writing Final Verification.`
          };
          process.stderr.write(`[VERIFY_GUARD] Blocked ${toolName} to ${filePath} — verification failures: ${failDetails}\n`);
          console.log(JSON.stringify(output));
          process.exit(2);
          return;
        } catch {}
      }
    }

    // Could not parse — fail open with warning
    process.stderr.write(`[VERIFY_GUARD] Warning: run-verify.js execution error: ${execErr.message}. Allowing write (fail-open).\n`);
    process.exit(0);
  }
}

main().catch(e => {
  console.error(`[VERIFY GUARD ERROR] ${e.message}`);
  process.exit(0); // fail-open
});
