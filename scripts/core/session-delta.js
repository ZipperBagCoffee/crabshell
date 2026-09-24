'use strict';
// Per-session delta watermarks kept in memory-index.json under `sessionDelta`,
// keyed by the first 8 characters of the session id (the L1 file key).
// Callers hold the memory-index lock. The global lastMemoryUpdateTs /
// pendingLastProcessedTs fields are kept as the maximum over sessions for older
// readers, and remain the baseline for sessions that predate per-session tracking.
const { SESSION_STATE_MAX_AGE_MS } = require('../constants');

const maxTs = (a, b) => (!a ? b || null : !b ? a : (a > b ? a : b));

function entryFor(index, sessionKey) {
  return sessionKey && index.sessionDelta && typeof index.sessionDelta === 'object'
    ? index.sessionDelta[sessionKey] || null : null;
}

// Timestamp after which this session's L1 entries still need extraction.
function deltaBaseline(index, sessionKey, queued) {
  const entry = entryFor(index, sessionKey);
  if (entry) return (queued && entry.pendingTs) || entry.committedTs || null;
  return (queued && index.pendingLastProcessedTs) || index.lastMemoryUpdateTs || null;
}

// A session whose first L1 file is being created starts with no baseline: its
// L1 holds only its own entries, so none of them has been summarized yet.
function markSessionStarted(index, sessionKey, now = new Date().toISOString()) {
  if (!sessionKey) return false;
  if (!index.sessionDelta || typeof index.sessionDelta !== 'object') index.sessionDelta = {};
  if (index.sessionDelta[sessionKey]) return false;
  index.sessionDelta[sessionKey] = { seenAt: now };
  return true;
}

// A session whose L1 existed before per-session tracking (no record yet) starts
// from the last committed project-wide watermark — not the pending maximum,
// which may belong to another session's newer queued entries.
function registerExistingSession(index, sessionKey, now = new Date().toISOString()) {
  if (!sessionKey || entryFor(index, sessionKey)) return false;
  if (!index.sessionDelta || typeof index.sessionDelta !== 'object') index.sessionDelta = {};
  index.sessionDelta[sessionKey] = { seenAt: now, committedTs: index.lastMemoryUpdateTs || null };
  return true;
}

function recordPending(index, sessionKey, ts, now = new Date().toISOString()) {
  if (!ts) return;
  index.pendingLastProcessedTs = maxTs(index.pendingLastProcessedTs, ts);
  const entry = entryFor(index, sessionKey);
  if (!entry) return;
  entry.pendingTs = maxTs(entry.pendingTs, ts);
  entry.seenAt = now;
}

function pendingSnapshot(index) {
  const snapshot = {};
  for (const [key, entry] of Object.entries(index.sessionDelta || {})) {
    if (entry && entry.pendingTs) snapshot[key] = entry.pendingTs;
  }
  return snapshot;
}

function commitPending(index, snapshot, now = Date.now()) {
  for (const [key, ts] of Object.entries(snapshot || {})) {
    const entry = entryFor(index, key);
    if (!entry) continue;
    entry.committedTs = maxTs(entry.committedTs, ts);
    if (entry.pendingTs && entry.pendingTs <= ts) delete entry.pendingTs;
  }
  for (const [key, entry] of Object.entries(index.sessionDelta || {})) {
    const seen = Date.parse(entry && entry.seenAt || '') || 0;
    if (entry && !entry.pendingTs && now - seen > SESSION_STATE_MAX_AGE_MS) delete index.sessionDelta[key];
  }
}

module.exports = { commitPending, deltaBaseline, markSessionStarted, pendingSnapshot, recordPending, registerExistingSession };
