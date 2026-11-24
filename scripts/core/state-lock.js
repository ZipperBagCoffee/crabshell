'use strict';
const fs = require('fs');
const path = require('path');
const { acquireFileLock, releaseFileLock } = require('./file-lock');

// Serializes read-modify-write of one state file across processes. Uses the same
// owner-token lock as the memory index (dead or stale owners are taken over one
// at a time; only the owner releases). D185: a writer waits while the lock keeps changing
// hands and refuses when one holder keeps it longer than holderWaitMs (one hold took up to
// 1.3 s with the CPU at 100%), or when this process has spent budgetMs waiting in all, so
// the two locks one hook may take still end inside Codex's 10-second hook limit.
const STATE_LOCK_HOLDER_WAIT_MS = 3000;
const STATE_LOCK_BUDGET_MS = 7000;

function createStateLock({ holderWaitMs = STATE_LOCK_HOLDER_WAIT_MS, budgetMs = STATE_LOCK_BUDGET_MS } = {}) {
  let waitedMs = 0;
  return function withStateLock(stateFile, action) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const lock = stateFile + '.lock';
    const result = acquireFileLock(lock, holderWaitMs, { perHolder: true, maxWaitMs: Math.max(0, budgetMs - waitedMs) });
    waitedMs += result.waitMs;
    if (!result.acquired) {
      const refusal = result.error && result.error !== 'EEXIST' ? ` (${result.error})` : '';
      throw new Error(`Verification state is busy${refusal}; no result was recorded.`);
    }
    try { return action(); }
    finally { releaseFileLock(lock); }
  };
}

const withStateLock = createStateLock();

module.exports = { withStateLock, createStateLock };
