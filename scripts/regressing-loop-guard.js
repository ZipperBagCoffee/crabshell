'use strict';

const fs = require('fs');
const path = require('path');
const { readStdin } = require('./transcript-utils');
const { STORAGE_ROOT } = require('./constants');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

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

async function main() {
  const hookData = await readStdin();
  if (!hookData || Object.keys(hookData).length === 0) process.exit(0); // fail-open: no data

  // Prevent infinite loop: exit if this is a continuation from a previous stop hook block
  if (hookData.stop_hook_active) process.exit(0);

  // Block if regressing workflow is active: force autonomous continuation
  if (isRegressingActive()) {
    const output = {
      decision: 'block',
      reason: 'Regressing active — do not stop. Save any questions to the active T document\'s Open Questions section, make a reasonable assumption, and continue autonomous execution. Do not wait for user input.'
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
  module.exports = { isRegressingActive };
}
