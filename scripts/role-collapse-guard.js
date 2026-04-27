'use strict';

const fs = require('fs');
const path = require('path');
const { readStdin } = require('./transcript-utils');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { isRegressingActive, isLightWorkflowActive, getWaCount } = require('./regressing-loop-guard');
const { getProjectDir } = require('./utils');

/**
 * Determine whether a file path is a source file that an Orchestrator should not write.
 * Source files = .js, .json, .sh, .ts files NOT in .crabshell/, NOT test files (_test-*), NOT docs (.md/.txt).
 * Fail-open: if filePath is empty, returns false.
 */
function isSourceFile(filePath) {
  if (!filePath) return false;
  const p = filePath.replace(/\\/g, '/');
  if (/\.crabshell\//.test(p)) return false;    // D/P/T/I docs and state files
  if (/\/_test-/.test(p)) return false;          // test files
  if (/\.(md|txt)$/.test(p)) return false;       // documentation
  return /\.(js|json|sh|ts)$/.test(p);           // source extensions
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) process.exit(0);

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') process.exit(0);

  const filePath = (hookData.tool_input?.file_path || hookData.tool_input?.path || '').replace(/\\/g, '/');
  if (!isSourceFile(filePath)) process.exit(0);

  const workflowActive = isRegressingActive() || isLightWorkflowActive();
  if (!workflowActive) process.exit(0);

  const waCount = getWaCount();
  if (waCount > 0) process.exit(0);

  // P132_T003 AC-8 dispatch path fix:
  // When the ticketing skill is active and the WA was sub-agent-dispatched
  // directly by the harness (parent's Task call did not propagate through
  // the project's PreToolUse hook chain — wa-count-pretool.js could not
  // pre-increment), waCount stays at 0 even though a legitimate WA is
  // running. Treat ticketing-active + sub-agent-launched as a non-collapse.
  try {
    const skillActivePath = path.join(getProjectDir(), '.crabshell', 'memory', 'skill-active.json');
    if (fs.existsSync(skillActivePath)) {
      const sa = JSON.parse(fs.readFileSync(skillActivePath, 'utf8'));
      const ttl = (sa && sa.ttl) || 15 * 60 * 1000;
      const fresh = sa && sa.activatedAt && (Date.now() - new Date(sa.activatedAt).getTime() < ttl);
      const isTicketing = fresh && sa && sa.skill === 'ticketing';
      if (isTicketing) {
        // Ticketing skill is the dispatcher; first source-file Write/Edit by a
        // dispatched WA is expected. Allow.
        process.stderr.write('[ROLE_COLLAPSE_GUARD] Allowing: ticketing skill-active dispatch path (waCount=0 expected)\n');
        process.exit(0);
      }
    }
  } catch (_) { /* fail-open: continue to standard block */ }

  const shortPath = filePath.split('/').slice(-2).join('/');
  const output = {
    decision: 'block',
    reason: `Role-collapse detected: Orchestrator is writing to source file '${shortPath}' before launching Work Agents (waCount=0). Orchestrator role = planning/coordination only. Launch Work Agents (WA) for implementation tasks. If this is a standalone fix (no workflow active), confirm by running /status.`
  };
  process.stderr.write(`[ROLE_COLLAPSE_GUARD] Blocked: source file write '${shortPath}' with workflow active + waCount=0\n`);
  console.log(JSON.stringify(output));
  process.exit(2);
}

if (require.main === module) {
  main().catch(() => process.exit(0)); // fail-open on any error
} else {
  module.exports = { isSourceFile };
}
