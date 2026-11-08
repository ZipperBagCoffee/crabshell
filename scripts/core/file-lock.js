'use strict';

const fs = require('fs');
const path = require('path');
const { LOCK_FILE, INDEX_LOCK_FILE } = require('../constants');
const { readJsonOrDefault, writeJson } = require('../utils');

// Lock settings
const LOCK_STALE_MS = 60000;  // 60 seconds
const LOCK_WAIT_MS = 250;     // how long a hook waits for a live lock holder before skipping

// File lock with an owner token. The lock file holds "<pid>:<token>"; only the
// holder whose token is on disk may delete it, so a holder that outlived the
// stale threshold cannot remove the lock of the process that took it over.
const _heldLocks = new Map(); // lockPath -> { token, acquiredAt }

function _sleepMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {}
}

const STEAL_STALE_MS = 10000;

// The lock content when its owner is gone (process no longer exists, or the
// lock is older than LOCK_STALE_MS); null while a live owner holds it.
function _staleLockContent(lockPath) {
  let content = '', stat;
  try { content = fs.readFileSync(lockPath, 'utf8'); stat = fs.statSync(lockPath); } catch { return null; }
  if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) return content;
  const pid = Number.parseInt(content.split(':')[0], 10);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return null;
  try { process.kill(pid, 0); return null; } catch (error) { return error.code === 'ESRCH' ? content : null; }
}

// Remove a dead owner's lock. Takeovers are serialized by a short secondary lock,
// and the lock is removed only if it still holds the content judged stale, so two
// waiters cannot both take over (the second would otherwise delete the first's
// fresh lock).
function _stealStaleLock(lockPath, staleContent) {
  const stealPath = `${lockPath}.steal`;
  try { fs.writeFileSync(stealPath, String(process.pid), { flag: 'wx' }); }
  catch {
    try { if (Date.now() - fs.statSync(stealPath).mtimeMs > STEAL_STALE_MS) fs.unlinkSync(stealPath); } catch {}
    return false;
  }
  try {
    let current;
    try { current = fs.readFileSync(lockPath, 'utf8'); } catch { return true; } // already released
    if (current !== staleContent || _staleLockContent(lockPath) === null) return false;
    fs.unlinkSync(lockPath);
    return true;
  } catch { return false; }
  finally { try { fs.unlinkSync(stealPath); } catch {} }
}

// Returns { acquired, contended, waitMs }. Waits up to waitMs for a live holder;
// every path, including a takeover that cannot remove the lock, respects the deadline.
function _acquireFileLock(lockPath, waitMs = LOCK_WAIT_MS) {
  const start = Date.now();
  const token = `${process.pid}:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  let contended = false;
  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(lockPath, token, { flag: 'wx' });
      _heldLocks.set(lockPath, { token, acquiredAt: Date.now() });
      return { acquired: true, contended, waitMs: Date.now() - start };
    } catch (error) {
      if (error.code !== 'EEXIST') return { acquired: false, contended, waitMs: Date.now() - start };
      contended = true;
      const stale = _staleLockContent(lockPath);
      const stolen = stale !== null && _stealStaleLock(lockPath, stale);
      if (Date.now() - start >= waitMs) return { acquired: false, contended, waitMs: Date.now() - start };
      if (!stolen) _sleepMs(Math.min(10 + attempt * 5, 40));
    }
  }
}

// Returns held milliseconds, or null when this process does not own the lock.
function _releaseFileLock(lockPath) {
  const held = _heldLocks.get(lockPath);
  if (!held) return null;
  _heldLocks.delete(lockPath);
  try { if (fs.readFileSync(lockPath, 'utf8') === held.token) fs.unlinkSync(lockPath); } catch {}
  return Date.now() - held.acquiredAt;
}

function ownsLock(lockPath) {
  const held = _heldLocks.get(lockPath);
  if (!held) return false;
  try { return fs.readFileSync(lockPath, 'utf8') === held.token; } catch { return false; }
}

function acquireLock(memoryDir) { return _acquireFileLock(path.join(memoryDir, LOCK_FILE)).acquired; }

function releaseLock(memoryDir) { _releaseFileLock(path.join(memoryDir, LOCK_FILE)); }

// D107 cycle 5 F-4 instrumentation — best-effort lock-contention measurement.
// Held time is measured in the holding process. Concurrent writes to
// lock-contention.json may lose increments since recordContention CANNOT acquire
// any lock (deadlock prevention per P147 RA1 R-1 — it runs inside the lock
// primitive itself). D119: a failed attempt is a "skip", not an acquire, and an
// acquire is "contended" only when another holder was actually present.
const CONTENTION_FILE = 'lock-contention.json';

function _recordContention(memoryDir, lockName, op, ms, contended) {
  // Fail-open: any error during instrumentation must NOT propagate to the lock
  // primitive. Caller wraps this in try/catch but we also catch internally as
  // defense-in-depth (per P147 AC-6 fail-open invariant).
  try {
    const filePath = path.join(memoryDir, CONTENTION_FILE);
    const state = readJsonOrDefault(filePath, {});
    if (!state[lockName] || typeof state[lockName] !== 'object') {
      state[lockName] = {
        acquireCount: 0,
        releaseCount: 0,
        totalWaitMs: 0,
        totalHeldMs: 0,
        maxWaitMs: 0,
        maxHeldMs: 0,
        contendedCount: 0,
        lastAcquiredPid: null,
        lastUpdatedAt: null
      };
    }
    const m = state[lockName];
    const nowIso = new Date().toISOString();
    if (op === 'acquire') {
      m.acquireCount = (m.acquireCount || 0) + 1;
      m.totalWaitMs = (m.totalWaitMs || 0) + (ms || 0);
      if ((ms || 0) > (m.maxWaitMs || 0)) m.maxWaitMs = ms;
      if (contended === undefined ? (ms || 0) > 0 : contended) m.contendedCount = (m.contendedCount || 0) + 1;
      m.lastAcquiredPid = process.pid;
    } else if (op === 'skip') {
      m.skipCount = (m.skipCount || 0) + 1;
      m.totalWaitMs = (m.totalWaitMs || 0) + (ms || 0);
    } else if (op === 'release') {
      m.releaseCount = (m.releaseCount || 0) + 1;
      m.totalHeldMs = (m.totalHeldMs || 0) + (ms || 0);
      if ((ms || 0) > (m.maxHeldMs || 0)) m.maxHeldMs = ms;
    }
    m.lastUpdatedAt = nowIso;
    writeJson(filePath, state);
  } catch {}
}

function acquireIndexLock(memoryDir, waitMs = LOCK_WAIT_MS) {
  const result = _acquireFileLock(path.join(memoryDir, INDEX_LOCK_FILE), waitMs);
  try { _recordContention(memoryDir, INDEX_LOCK_FILE, result.acquired ? 'acquire' : 'skip', result.waitMs, result.contended); } catch {}
  return result.acquired;
}

function releaseIndexLock(memoryDir) {
  const heldMs = _releaseFileLock(path.join(memoryDir, INDEX_LOCK_FILE));
  if (heldMs !== null) { try { _recordContention(memoryDir, INDEX_LOCK_FILE, 'release', heldMs); } catch {} }
}

function ownsIndexLock(memoryDir) { return ownsLock(path.join(memoryDir, INDEX_LOCK_FILE)); }

module.exports = { acquireLock, releaseLock, acquireIndexLock, releaseIndexLock, ownsIndexLock, acquireFileLock: _acquireFileLock, releaseFileLock: _releaseFileLock, _recordContention };
