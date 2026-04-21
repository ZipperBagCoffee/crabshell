'use strict';

/**
 * PreToolUse hook: optimistic WA/RA count increment on subagent dispatch.
 *
 * Problem solved: PostToolUse(Agent) fires AFTER the subagent returns, but
 * role-collapse-guard reads wa-count.json at PreToolUse-Write time DURING the
 * subagent's execution. Post-side increment is temporally too late — the first
 * source-file write inside a just-dispatched subagent sees waCount=0.
 *
 * Fix: increment waCount/raCount at dispatch time (PreToolUse on Agent|Task|TaskCreate).
 *
 * Fail-open: any error → exit 0 (never break workflow).
 * Single-source-of-truth: Post-side WA/RA increment removed in counter.js to
 *                        prevent double-counting; Post retains backgroundAgentPending.
 *
 * Ticket: P131_T001
 */

const fs = require('fs');
const path = require('path');

// Skip during background memory summarization (fail-open early)
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir, getStorageRoot, readJsonOrDefault, writeJson, ensureDir, acquireIndexLock, releaseIndexLock } = require('./utils');
const { MEMORY_DIR, WA_COUNT_FILE } = require('./constants');
const { readStdin: readStdinShared } = require('./transcript-utils');
const { classifyAgent } = require('./counter');

async function main() {
  let hookData;
  try {
    hookData = await readStdinShared(1000);
  } catch (e) {
    // Fail-open on stdin read failure
    process.exit(0);
  }
  if (!hookData || typeof hookData !== 'object') process.exit(0);

  let agentType;
  try {
    agentType = classifyAgent(hookData);
  } catch (e) {
    process.exit(0);
  }
  if (agentType !== 'WA' && agentType !== 'RA') {
    // Not an Agent/Task/TaskCreate tool — no-op
    process.exit(0);
  }

  const projectDir = getProjectDir();
  const memoryDir = path.join(getStorageRoot(projectDir), MEMORY_DIR);
  try {
    ensureDir(memoryDir);
  } catch (e) {
    process.exit(0);
  }

  const locked = acquireIndexLock(memoryDir);
  if (!locked) {
    // Another process holds the lock — skip (fail-open, stderr warn)
    process.stderr.write('[WA_COUNT_PRETOOL] lock busy — skipping increment\n');
    process.exit(0);
  }

  try {
    const waPath = path.join(memoryDir, WA_COUNT_FILE);
    const waData = readJsonOrDefault(waPath, { waCount: 0, raCount: 0, totalTaskCalls: 0 });
    if (typeof waData.waCount !== 'number') waData.waCount = 0;
    if (typeof waData.raCount !== 'number') waData.raCount = 0;
    if (typeof waData.totalTaskCalls !== 'number') waData.totalTaskCalls = 0;

    waData.totalTaskCalls += 1;

    const input = hookData.tool_input || {};
    const isBackground = input.run_in_background === true;

    // Background agents are long-running side tasks, NOT WA/RA dispatches —
    // skip waCount/raCount increment for them, but track backgroundAgentPending
    // (stop-hook exemption relies on this). Matches pre-P131 semantics.
    if (!isBackground) {
      if (agentType === 'WA') {
        waData.waCount += 1;
      } else {
        waData.raCount += 1;
      }
    }

    if (isBackground) {
      const existingCount = (waData.backgroundAgentPending && typeof waData.backgroundAgentPending.count === 'number')
        ? waData.backgroundAgentPending.count
        : 0;
      waData.backgroundAgentPending = {
        count: existingCount + 1,
        launchedAt: new Date().toISOString()
      };
    }

    try {
      writeJson(waPath, waData);
    } catch (e) {
      // Last-resort fallback to direct write; fail-open on error
      try { fs.writeFileSync(waPath, JSON.stringify(waData, null, 2)); } catch {}
    }

    if (isBackground) {
      process.stderr.write(`[WA_COUNT_PRETOOL] ${agentType} (background) — waCount/raCount unchanged, backgroundAgentPending.count=${waData.backgroundAgentPending.count}\n`);
    } else {
      const newCount = agentType === 'WA' ? waData.waCount : waData.raCount;
      process.stderr.write(`[WA_COUNT_PRETOOL] ${agentType} +1 (${agentType === 'WA' ? 'waCount' : 'raCount'}=${newCount})\n`);
    }
  } catch (e) {
    process.stderr.write(`[WA_COUNT_PRETOOL] error: ${e.message}\n`);
  } finally {
    try { releaseIndexLock(memoryDir); } catch {}
  }

  process.exit(0);
}

if (require.main === module) {
  main().catch(() => process.exit(0)); // fail-open on any error
}
