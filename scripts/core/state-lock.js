'use strict';
const fs = require('fs');
const path = require('path');
const { acquireFileLock, releaseFileLock } = require('../utils');

// Serializes read-modify-write of one state file across processes. Uses the same
// owner-token lock as the memory index (dead or stale owners are taken over one
// at a time; only the owner releases). Waits up to one second, then refuses.
const STATE_LOCK_WAIT_MS = 1000;

function withStateLock(stateFile, action) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const lock = stateFile + '.lock';
  if (!acquireFileLock(lock, STATE_LOCK_WAIT_MS).acquired) throw new Error('Verification state is busy; no result was recorded.');
  try { return action(); }
  finally { releaseFileLock(lock); }
}

module.exports = { withStateLock };
