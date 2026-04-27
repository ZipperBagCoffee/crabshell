'use strict';

/**
 * post-compact.js — PostCompact hook
 * PostCompact does NOT support additionalContext output.
 * Side-effects only: log compaction event to stderr.
 * Outputs empty JSON {} (or nothing) — Claude Code ignores stdout for PostCompact.
 *
 * Fail-open: process.exit(0) on any error.
 */

const fs = require('fs');
const path = require('path');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { readStdin } = require('./transcript-utils');
const { getProjectDir, getStorageRoot, readJsonOrDefault, writeJson, acquireIndexLock, releaseIndexLock } = require('./utils');
const { REGRESSING_STATE_FILE } = require('./constants');

async function main() {
  let stdinData = {};
  try {
    stdinData = await readStdin(2000);
  } catch (e) { /* fail-open */ }

  let projectDir;
  try {
    projectDir = getProjectDir();
  } catch (e) {
    process.stdout.write('{}');
    process.exit(0);
  }

  // Verify regressing-state.json is still intact
  try {
    const regressingStatePath = path.join(getStorageRoot(projectDir), 'memory', REGRESSING_STATE_FILE);
    const state = readJsonOrDefault(regressingStatePath, null);
    if (state && state.active === true) {
      process.stderr.write(
        `[CRABSHELL] PostCompact: regressing state preserved — phase=${state.phase}, cycle=${state.cycle}/${state.totalCycles}\n`
      );
    } else {
      process.stderr.write('[CRABSHELL] PostCompact: no active regressing state\n');
    }
  } catch (e) {
    process.stderr.write('[CRABSHELL] PostCompact: could not read regressing state: ' + (e.message || e) + '\n');
  }

  // Reset pressure lastShownLevel on compaction (context was cleared, full text must re-inject)
  // Outer try/catch preserves PostCompact fail-open (runs during auto-compaction — throw would
  // kill the compaction flow). Lock acquisition inside; lock failure logs and silently continues.
  try {
    const memoryDir = path.join(getStorageRoot(projectDir), 'memory');
    const indexPath = path.join(memoryDir, 'memory-index.json');

    const locked = acquireIndexLock(memoryDir);
    if (!locked) {
      process.stderr.write('[CRABSHELL] PostCompact: index lock busy, skipping lastShownLevel reset (fail-open)\n');
    } else {
      try {
        const idx = readJsonOrDefault(indexPath, null);
        if (idx && idx.feedbackPressure && typeof idx.feedbackPressure.lastShownLevel === 'number') {
          idx.feedbackPressure.lastShownLevel = 0;
          writeJson(indexPath, idx);
          process.stderr.write('[CRABSHELL] PostCompact: feedbackPressure.lastShownLevel reset to 0\n');
        }
      } catch (innerErr) {
        // Inner throw is caught here too — but outer try/catch is our backstop.
        process.stderr.write('[CRABSHELL] PostCompact: lastShownLevel write failed: ' + (innerErr.message || innerErr) + '\n');
      } finally {
        // releaseIndexLock is silent-on-error per utils.js — safe inside finally.
        releaseIndexLock(memoryDir);
      }
    }
  } catch (e) {
    // Outer catch — absolutely must not propagate during auto-compaction.
    process.stderr.write('[CRABSHELL] PostCompact: lastShownLevel reset failed: ' + (e.message || e) + '\n');
  }

  // Log compaction event timestamp
  try {
    const logsDir = path.join(getStorageRoot(projectDir), 'memory', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, 'compaction.log');
    const entry = new Date().toISOString() + ' | PostCompact hook fired\n';
    fs.appendFileSync(logPath, entry);
    process.stderr.write('[CRABSHELL] PostCompact: logged to ' + logPath + '\n');
  } catch (e) {
    process.stderr.write('[CRABSHELL] PostCompact: log write failed: ' + (e.message || e) + '\n');
  }

  // PostCompact does not support additionalContext — output empty object
  process.stdout.write('{}');
  process.exit(0);
}

main().catch(e => {
  process.stderr.write('[CRABSHELL] PostCompact error: ' + (e.message || e) + '\n');
  process.stdout.write('{}');
  process.exit(0); // fail-open
});
