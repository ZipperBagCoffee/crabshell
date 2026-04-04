'use strict';

/**
 * subagent-context.js — SubagentStart hook
 * Outputs JSON with hookSpecificOutput.additionalContext for SubagentStart.
 * Injects: project concept, COMPRESSED_CHECKLIST, regressing state, node path, project root anchor.
 * Total additionalContext kept under 2000 chars.
 *
 * Fail-open: process.exit(0) on any error.
 */

const fs = require('fs');
const path = require('path');
const { readStdin } = require('./transcript-utils');
const { getProjectDir, getStorageRoot, readJsonOrDefault } = require('./utils');
const { REGRESSING_STATE_FILE } = require('./constants');
const { COMPRESSED_CHECKLIST, readProjectConcept } = require('./shared-context');

const MAX_CONTEXT_CHARS = 2000;

async function main() {
  let stdinData = {};
  try {
    stdinData = await readStdin(2000);
  } catch (e) { /* fail-open */ }

  let projectDir;
  try {
    projectDir = getProjectDir();
  } catch (e) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: '' } }));
    process.exit(0);
  }

  const parts = [];

  // 1. Project root anchor (always first — most critical)
  const nodePathFwd = process.execPath.replace(/\\/g, '/');
  parts.push(
    `## Project Root Anchor\nProject root: \`${projectDir}\`\n` +
    `Node.js path: \`${nodePathFwd}\`\n` +
    `All file paths are relative to project root.`
  );

  // 2. Project concept
  try {
    const concept = readProjectConcept(projectDir, 20, 500);
    if (concept) {
      parts.push(`## Project Concept\n${concept}`);
    }
  } catch (e) { /* ignore */ }

  // 3. Active regressing state
  try {
    const regressingStatePath = path.join(getStorageRoot(projectDir), 'memory', REGRESSING_STATE_FILE);
    const state = readJsonOrDefault(regressingStatePath, null);
    if (state && state.active === true) {
      let regressingText = `## Regressing State\nPhase: ${state.phase}, Cycle: ${state.cycle}/${state.totalCycles}`;
      if (state.discussion) regressingText += `\nDiscussion: ${state.discussion}`;
      if (state.planId) regressingText += `\nPlan: ${state.planId}`;
      if (state.ticketIds && state.ticketIds.length > 0) {
        regressingText += `\nTickets: ${state.ticketIds.join(', ')}`;
      }
      parts.push(regressingText);
    }
  } catch (e) { /* ignore */ }

  // 4. Compressed checklist (last — trim if needed)
  parts.push(COMPRESSED_CHECKLIST.trim());

  // Assemble and enforce 2000 char limit
  let context = parts.join('\n\n');
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.substring(0, MAX_CONTEXT_CHARS - 3) + '...';
  }

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: context
    }
  };

  process.stdout.write(JSON.stringify(output));
  process.stderr.write(`[CRABSHELL] SubagentStart: additionalContext ${context.length} chars\n`);
  process.exit(0);
}

main().catch(e => {
  process.stderr.write('[CRABSHELL] SubagentStart error: ' + (e.message || e) + '\n');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: '' } }));
  process.exit(0); // fail-open
});
