'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { readStdin, normalizePath } = require('./transcript-utils');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir } = require('./utils');

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

function failureDetails(failures) {
  let classify = null;
  try { classify = require('./verify-classify').classify; } catch (_) {}
  return failures.map(f => {
    try {
      const cls = f.failureClass || (classify ? classify(f.error, f.output) : null);
      const prefix = cls ? `[${cls}] ` : '';
      return `${prefix}${f.id}: ${f.error || f.output || 'FAIL'}`;
    } catch (_) {
      return `${f.id}: ${f.error || f.output || 'FAIL'}`;
    }
  }).join('; ');
}

function failureBlock(toolName, filePath, failures) {
  const details = failureDetails(failures);
  return {
    reason: `Final Verification section blocked. Verification tool found failures: ${details}. Fix failures before writing Final Verification.`,
    log: `[VERIFY_GUARD] Blocked ${toolName} to ${filePath} — verification failures: ${details}`,
  };
}

// Returns { reason, log } to block, { log } for a diagnostic only, or null.
function evaluateVerifyGuard(hookData, projectDir) {
  if (!hookData || !hookData.tool_name) return null;

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') return null;

  const input = hookData.tool_input;
  if (!input) return null;

  const filePath = normalizePath(input.file_path || input.path || '');
  if (!filePath) return null;

  // Only guard ticket files
  if (!TICKET_FILE_PATTERN.test(filePath)) return null;

  // Hybrid fix: Write to NEW file (creation) → allow without verification
  // Write to EXISTING file → proceed to verification (prevents bypass)
  if (toolName === 'Write' && !fs.existsSync(path.resolve(projectDir, filePath))) return null;

  // Only trigger when writing Final Verification section
  if (!containsFinalVerification(hookData)) return null;

  // Allow "Verification tool N/A:" exception
  if (hasVerificationToolNA(hookData)) {
    return { log: `[VERIFY_GUARD] Allowed: ${filePath} — Verification tool N/A exception` };
  }

  // Deterministic verification: execute run-verify.js directly
  const { STORAGE_ROOT } = require('./constants');
  const runVerifyPath = path.join(projectDir, STORAGE_ROOT, 'verification', 'run-verify.js');
  if (!fs.existsSync(runVerifyPath)) {
    return {
      reason: 'Final Verification section blocked. No verification tool found at .crabshell/verification/run-verify.js. You MUST run /verifying to create the verification manifest first, then /verifying run. Invoke: Skill tool with skill="verifying".',
      log: `[VERIFY_GUARD] Blocked ${toolName} to ${filePath} — no verification tool found`,
    };
  }

  // Execute run-verify.js and check results
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [runVerifyPath], {
      timeout: 60000,
      encoding: 'utf8',
      cwd: projectDir
    });
  } catch (execErr) {
    // Non-zero exit means FAILs exist — parse stdout from the error
    const jsonMatch = execErr.stdout && execErr.stdout.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const results = JSON.parse(jsonMatch[0]);
        return failureBlock(toolName, filePath, results.filter(r => r.status === 'FAIL'));
      } catch {}
    }
    // Could not parse — fail open with warning
    return { log: `[VERIFY_GUARD] Warning: run-verify.js execution error: ${execErr.message}. Allowing write (fail-open).` };
  }

  // Parse JSON results (first JSON array in stdout)
  const jsonMatch = stdout.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return { log: `[VERIFY_GUARD] Allowed: ${filePath} — run-verify.js produced no parseable results` };
  }

  const results = JSON.parse(jsonMatch[0]);
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) return failureBlock(toolName, filePath, failures);

  // Behavioral AC enforcement: a label alone is not evidence. Require a
  // schema-v2 behavioral entry with an independent assertion or protected
  // before/after snapshot.
  const manifestPath = path.join(projectDir, STORAGE_ROOT, 'verification', 'manifest.json');
  let manifestWarning = null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entries = manifest.entries || [];
    const hasBehavioralContract = manifest.schemaVersion === 2 && entries.some(entry => {
      if (!entry || entry.type !== 'behavioral' || !entry.contract) return false;
      const assertions = Array.isArray(entry.contract.assertions) ? entry.contract.assertions : [];
      const forbidden = Array.isArray(entry.contract.forbiddenChanges) ? entry.contract.forbiddenChanges : [];
      return Number.isInteger(entry.contract.exitCode) && (assertions.length > 0 || forbidden.length > 0);
    });
    if (!hasBehavioralContract) {
      return {
        reason: `Final Verification blocked. Manifest has ${entries.length} entries but no schema-v2 behavioral entry with an independent assertion or forbidden-change snapshot. Update ${manifestPath}.`,
        log: '[VERIFY_GUARD] Blocked: no structured behavioral contract in manifest',
      };
    }
  } catch (manifestErr) {
    manifestWarning = `[VERIFY_GUARD] Warning: could not read manifest for behavioral AC check: ${manifestErr.message}`;
  }

  // All PASS
  return { log: [manifestWarning, `[VERIFY_GUARD] Allowed: ${filePath} — all ${results.length} verification entries passed`].filter(Boolean).join('\n') };
}

async function main() {
  const hookData = await readStdin();
  const result = evaluateVerifyGuard(hookData, getProjectDir());
  if (!result) { process.exit(0); return; }
  if (result.log) process.stderr.write(result.log + '\n');
  if (!result.reason) { process.exit(0); return; }
  console.log(JSON.stringify({ decision: 'block', reason: result.reason }));
  process.exit(2);
}

if (require.main === module) {
  main().catch(e => {
    console.error(`[VERIFY GUARD ERROR] ${e.message}`);
    process.exit(0); // fail-open
  });
}

module.exports = { evaluateVerifyGuard };
