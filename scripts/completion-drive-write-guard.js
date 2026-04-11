'use strict';

const fs = require('fs');
const path = require('path');
const { readStdin, normalizePath } = require('./transcript-utils');
const { STORAGE_ROOT, SKILL_ACTIVE_FILE, REGRESSING_STATE_FILE } = require('./constants');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

// TTL for skill-active flag (15 minutes, matches docs-guard.js)
const SKILL_ACTIVE_TTL_MS = 15 * 60 * 1000;

/**
 * Check if the file path targets .crabshell/ and should be skipped.
 * Returns true if the path is under .crabshell/ (forward or back slashes).
 */
function shouldSkipPath(filePath) {
  if (!filePath) return false;
  const normalized = normalizePath(filePath);
  return normalized.includes('.crabshell/');
}

/**
 * Check if regressing workflow is currently active.
 * Returns true if regressing-state.json exists and has active: true.
 * Fail-open: returns false on any error.
 */
function isRegressingActive() {
  try {
    const statePath = path.join(getProjectDir(), STORAGE_ROOT, 'memory', REGRESSING_STATE_FILE);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return state && state.active === true;
  } catch {
    return false; // No state file or parse error = not active
  }
}

/**
 * Check if light-workflow skill is currently active via skill-active.json.
 * Returns true if skill-active.json exists, skill === "light-workflow", and TTL not expired.
 * Fail-open: returns false on any error.
 */
function isLightWorkflowActive() {
  try {
    const flagPath = path.join(getProjectDir(), STORAGE_ROOT, 'memory', SKILL_ACTIVE_FILE);
    if (!fs.existsSync(flagPath)) return false;
    const data = JSON.parse(fs.readFileSync(flagPath, 'utf8'));
    if (!data || data.skill !== 'light-workflow' || !data.activatedAt) return false;

    // Check TTL
    const ttl = data.ttl || SKILL_ACTIVE_TTL_MS;
    const elapsed = Date.now() - new Date(data.activatedAt).getTime();
    if (elapsed > ttl) {
      // Expired — clean up
      try { fs.unlinkSync(flagPath); } catch {}
      return false;
    }

    return true;
  } catch {
    return false; // Fail-open
  }
}

/**
 * Build the block message for the given file path.
 * Returns a decision:block object with a self-check message.
 */
function buildBlockMessage(filePath) {
  return {
    decision: 'block',
    reason: `Completion drive self-check (Write/Edit: ${filePath}): Is this write completion drive? State why this write is needed and what workflow step or user instruction it serves. If you cannot cite a specific reason, STOP and confirm with the user.`
  };
}

async function main() {
  try {
    const hookData = await readStdin();
    if (!hookData || !hookData.tool_name) { process.exit(0); return; }

    const toolName = hookData.tool_name;
    if (toolName !== 'Write' && toolName !== 'Edit') { process.exit(0); return; }

    const input = hookData.tool_input;
    if (!input) { process.exit(0); return; }

    const filePath = input.file_path || input.path || '';
    if (!filePath) { process.exit(0); return; }

    // AC2: Skip .crabshell/ paths
    if (shouldSkipPath(filePath)) { process.exit(0); return; }

    // AC3: Skip if regressing is active
    if (isRegressingActive()) { process.exit(0); return; }

    // AC4: Skip if light-workflow is active
    if (isLightWorkflowActive()) { process.exit(0); return; }

    // AC1, AC5: Block with self-check message
    const output = buildBlockMessage(normalizePath(filePath));
    process.stderr.write(`[COMPLETION_DRIVE_WRITE_GUARD] Blocked ${toolName}: ${normalizePath(filePath)}\n`);
    console.log(JSON.stringify(output));
    process.exit(2);
  } catch {
    process.exit(0); // AC10: fail-open on any error
  }
}

if (require.main === module) {
  main();
} else {
  // Export for unit testing
  module.exports = { shouldSkipPath, isRegressingActive, isLightWorkflowActive, buildBlockMessage };
}
