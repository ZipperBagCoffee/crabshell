'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { readStdin, normalizePath } = require('./transcript-utils');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir, ticketDocPattern } = require('./utils');

// Ticket file pattern: <STORAGE_ROOT>/ticket/<D### or P###>_T###*
const TICKET_FILE_PATTERN = new RegExp(ticketDocPattern());

// The runner prints its results as a pretty JSON array whose brackets open and close
// at line start; the summary lines after it (a --changed run's reason) may hold "]".
const RESULTS_ARRAY = /^\[\]$|^\[\r?\n[\s\S]*?\r?\n\]$/m;

// The hook's own run gets a minute; a selection estimated above the budget is not run.
const GUARD_TIMEOUT_MS = 60000;
const GUARD_BUDGET_SECONDS = 40;

// The runner's --changed selection without running any check, or null when it cannot
// be read (an old runner, a git error, a timeout) — the caller then runs as before.
function changedPlan(runVerifyPath, projectDir) {
  try {
    // Same selection flags as the real run below, so covered and reused checks count alike.
    const out = execFileSync(process.execPath, [runVerifyPath, '--changed', '--no-fail-before', '--dry-run'], {
      timeout: 15000,
      encoding: 'utf8',
      env: { ...process.env, PROJECT_ROOT: projectDir },
      cwd: projectDir,
      windowsHide: true,
    });
    const start = out.indexOf('{');
    return start >= 0 ? JSON.parse(out.slice(start)) : null;
  } catch (_) {
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

  // A selection that cannot finish within this hook's time limit used to be killed at
  // the limit and then allowed (fail-open), after spending the whole minute and, on
  // Windows, leaving its test processes running. Ask the runner first; when its estimate
  // is over the budget, leave the check to the commit gate's own --changed run. The
  // budget sits well under the limit because estimates leave out process start-up.
  // Older runner copies print no estimate: run them as before.
  const plan = changedPlan(runVerifyPath, projectDir);
  if (plan && Number.isFinite(plan.estimatedSeconds) && plan.estimatedSeconds > GUARD_BUDGET_SECONDS) {
    const count = Array.isArray(plan.selected) ? plan.selected.length : 0;
    const scope = plan.full ? `, all — ${plan.reason}` : '';
    const estimate = `about ${plan.estimatedSeconds}s (${count} checks${scope}), over this hook's ${GUARD_TIMEOUT_MS / 1000}s limit`;
    // The model must see that no check ran here, or it may treat the write as verified.
    return {
      context: `[CRABSHELL] This Final Verification was written without running the changed-file check: the runner estimates ${estimate}. The check still runs at the commit gate (\`node .crabshell/verification/run-verify.js --changed\`); cite that run's result as the verification, not this write.`,
      log: `[VERIFY_GUARD] Allowed: ${filePath} — the changed-file check would take ${estimate}; the commit gate's --changed run checks it`,
    };
  }

  // Execute run-verify.js on the changed files only and check results. The HEAD
  // comparison of changed tests (fail-before) is left to the commit gate's own run:
  // it runs each changed test twice more and could pass this hook's time limit.
  let stdout;
  try {
    stdout = execFileSync(process.execPath, [runVerifyPath, '--changed', '--no-fail-before'], {
      timeout: GUARD_TIMEOUT_MS,
      encoding: 'utf8',
      // The guard's project, not a root inherited from whoever started this process.
      env: { ...process.env, CRABSHELL_VERIFY_JSON: '1', PROJECT_ROOT: projectDir },
      cwd: projectDir
    });
  } catch (execErr) {
    // Non-zero exit means FAILs exist — parse stdout from the error
    const jsonMatch = execErr.stdout && execErr.stdout.match(RESULTS_ARRAY);
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
  const jsonMatch = stdout.match(RESULTS_ARRAY);
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
