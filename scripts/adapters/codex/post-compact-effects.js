'use strict';

const fs = require('fs');
const path = require('path');
const {
  acquireIndexLock,
  getStorageRoot,
  readJsonOrDefault,
  releaseIndexLock,
  writeJson,
} = require('../../utils');
const { INDEX_FILE, REGRESSING_STATE_FILE } = require('../../constants');

function runPostCompactEffects(projectDir, options = {}) {
  const storageRoot = getStorageRoot(projectDir);
  const memoryDir = path.join(storageRoot, 'memory');
  const diagnostics = [];
  const result = {
    activeRegressingState: false,
    pressureReset: false,
    compactionLogged: false,
    diagnostics,
  };

  try {
    const statePath = path.join(memoryDir, REGRESSING_STATE_FILE);
    const state = readJsonOrDefault(statePath, null);
    if (state && state.active === true) {
      result.activeRegressingState = true;
      diagnostics.push(`regressing state preserved — phase=${state.phase}, cycle=${state.cycle}/${state.totalCycles}`);
    } else {
      diagnostics.push('no active regressing state');
    }
  } catch (error) {
    diagnostics.push(`could not read regressing state: ${error.message}`);
  }

  let locked = false;
  try {
    const indexPath = path.join(memoryDir, INDEX_FILE);
    locked = acquireIndexLock(memoryDir);
    if (!locked) {
      diagnostics.push('index lock busy, skipping lastShownLevel reset (fail-open)');
    } else {
      const index = readJsonOrDefault(indexPath, null);
      if (index && index.feedbackPressure && typeof index.feedbackPressure.lastShownLevel === 'number') {
        index.feedbackPressure.lastShownLevel = 0;
        writeJson(indexPath, index);
        result.pressureReset = true;
        diagnostics.push('feedbackPressure.lastShownLevel reset to 0');
      }
    }
  } catch (error) {
    diagnostics.push(`lastShownLevel reset failed: ${error.message}`);
  } finally {
    if (locked) releaseIndexLock(memoryDir);
  }

  try {
    const logsDir = path.join(memoryDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, 'compaction.log');
    const now = options.now instanceof Date ? options.now : new Date();
    fs.appendFileSync(logPath, `${now.toISOString()} | PostCompact hook fired\n`);
    result.compactionLogged = true;
    result.logPath = logPath;
    diagnostics.push(`logged to ${logPath}`);
  } catch (error) {
    diagnostics.push(`log write failed: ${error.message}`);
  }

  return result;
}

function validatePostCompactEffects(result, options = {}) {
  if (!result || result.compactionLogged !== true) throw new Error('PostCompact compaction log was not written.');
  if (options.requirePressureReset === true && result.pressureReset !== true) {
    throw new Error('PostCompact pressure re-injection state was not reset.');
  }
  return true;
}

module.exports = { runPostCompactEffects, validatePostCompactEffects };
