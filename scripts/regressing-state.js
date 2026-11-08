const path = require('path');
const { getStorageRoot, readJsonOrDefault } = require('./utils');
const { REGRESSING_STATE_FILE } = require('./constants');
const { REGRESSING_STALE_MS } = require('./core/limits');

// True when a regressing state last updated at lastUpdatedAt is older than
// REGRESSING_STALE_MS. A missing or unreadable time returns `unknown`: each caller
// keeps its own answer for that case.
function isRegressingStale(lastUpdatedAt, { now = Date.now(), unknown = false } = {}) {
  const updated = lastUpdatedAt ? new Date(lastUpdatedAt).getTime() : NaN;
  if (!Number.isFinite(updated)) return unknown;
  return now - updated > REGRESSING_STALE_MS;
}

/**
 * Reads .crabshell/memory/regressing-state.json and returns parsed state.
 * Returns null if file doesn't exist, active !== true, or required fields missing.
 */
function getRegressingState(projectDir) {
  const statePath = path.join(getStorageRoot(projectDir), 'memory', REGRESSING_STATE_FILE);
  const state = readJsonOrDefault(statePath, null);
  if (!state) return null;
  if (state.active !== true) return null;
  // Validate required fields
  if (!state.phase || !state.cycle || !state.totalCycles) return null;
  return state;
}

module.exports = { getRegressingState, isRegressingStale };
