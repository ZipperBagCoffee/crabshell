'use strict';

const fs = require('fs');
const path = require('path');
const { readStdin } = require('./transcript-utils');
const { STORAGE_ROOT, MEMORY_DIR, SKILL_ACTIVE_FILE } = require('./constants');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { buildRegressingReminder } = require('./regressing-state');
const { getProjectDir } = require('./utils');

/**
 * Check if regressing workflow is currently active.
 * Returns true if regressing-state.json exists and has active: true.
 * Fail-open: returns false on any error.
 */
function isRegressingActive() {
  try {
    const statePath = path.join(getProjectDir(), STORAGE_ROOT, 'memory', 'regressing-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return state && state.active === true;
  } catch {
    return false; // No state file or parse error = not active
  }
}

// Default TTL for skill-active flag (15 minutes)
const SKILL_ACTIVE_TTL_MS = 15 * 60 * 1000;

/**
 * Check if light-workflow is currently active.
 * Returns true if skill-active.json exists, has skill: 'light-workflow',
 * and has not exceeded its TTL.
 * Fail-open: returns false on any error.
 */
function isLightWorkflowActive() {
  try {
    const skillActivePath = path.join(getProjectDir(), STORAGE_ROOT, MEMORY_DIR, SKILL_ACTIVE_FILE);
    const state = JSON.parse(fs.readFileSync(skillActivePath, 'utf8'));
    if (!state || !state.skill || !state.activatedAt) return false;

    // TTL check — applies to any skill, per IA-4
    const ttl = state.ttl || SKILL_ACTIVE_TTL_MS;
    const elapsed = Date.now() - new Date(state.activatedAt).getTime();
    if (elapsed > ttl) {
      // Expired — clean up file
      try { fs.unlinkSync(skillActivePath); } catch {}
      return false;
    }

    return state.skill === 'light-workflow';
  } catch {
    return false; // No file or parse error = not active
  }
}

/**
 * Build phase-specific context for block reasons.
 * Fail-open: returns empty string on any error.
 */
function getPhaseContext() {
  try {
    const reminder = buildRegressingReminder(getProjectDir());
    return reminder ? '\n\n' + reminder.trim() : '';
  } catch {
    return '';
  }
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || Object.keys(hookData).length === 0) process.exit(0); // fail-open: no data

  // Prevent infinite loop: exit if this is a continuation from a previous stop hook block
  if (hookData.stop_hook_active) process.exit(0);

  // Block if regressing workflow is active: force autonomous continuation
  if (isRegressingActive()) {
    const phaseContext = getPhaseContext();
    const output = {
      decision: 'block',
      reason: 'Regressing active — do not stop. Save any questions to the active T document\'s Open Questions section, make a reasonable assumption, and continue autonomous execution. Do not wait for user input.' + phaseContext
    };
    process.stderr.write('[REGRESSING_LOOP_GUARD] Blocked: regressing active — forcing continuation\n');
    console.log(JSON.stringify(output));
    process.exit(2);
  }

  process.exit(0);
}

if (require.main === module) {
  main().catch(() => process.exit(0)); // fail-open on any error
} else {
  module.exports = { isRegressingActive, isLightWorkflowActive, getPhaseContext };
}
