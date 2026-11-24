'use strict';

const fs = require('fs');
const path = require('path');
const { LOCK_FILE, INDEX_LOCK_FILE } = require('../constants');
const { readJsonOrDefault, writeJson } = require('../utils');

// Lock settings
const LOCK_STALE_MS = 60000;  // 60 seconds
const LOCK_WAIT_MS = 250;     // how long a hook waits for a live lock holder before skipping
// A refusal other than "already exists" that lasts this long while no lock file is there is
// not a lock being deleted (a read-only folder, say): the wait ends instead of using all of its time (D185).
const REFUSAL_RETRY_MS = 250;

// File lock with an owner token. The lock file holds "<pid>:<token>"; only the
// holder whose token is on disk may delete it, so a holder that outlived the
// stale threshold cannot remove the lock of the process that took it over.
const _heldLocks = new Map(); // lockPath -> { token, acquiredAt }

function _sleepMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {}
}

const STEAL_STALE_MS = 10000;

// One look at the lock: its content (null when unreadable) and whether its owner is gone
// (process no longer exists, or the lock is older than LOCK_STALE_MS). One read per look, so
// waiters keep the file open as little as possible (on Windows an open handle keeps a deleted
// lock file in the way of the next owner, D185).
function _inspectLock(lockPath) {
  let content = null, stat;
  try { content = fs.readFileSync(lockPath, 'utf8'); stat = fs.statSync(lockPath); } catch { return { content, stale: false }; }
  if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) return { content, stale: true };
  const pid = Number.parseInt(content.split(':')[0], 10);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return { content, stale: false };
  try { process.kill(pid, 0); return { content, stale: false }; } catch (error) { return { content, stale: error.code === 'ESRCH' }; }
}

// The lock content when its owner is gone; null while a live owner holds it.
function _staleLockContent(lockPath) {
  const look = _inspectLock(lockPath);
  return look.stale ? look.content : null;
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

// Returns { acquired, contended, waitMs, error }. Waits up to waitMs for a live holder;
// every path, including a takeover that cannot remove the lock, respects the deadline.
// A refusal other than EEXIST while the lock file is still there is the lock changing hands
// (Windows answers EPERM while it is being deleted, and keeps doing so while other waiters
// still have it open, D185); a refusal while no lock file is there that lasts
// REFUSAL_RETRY_MS (a read-only folder, say) ends the wait early. `error` names the last
// refusal. options.perHolder: the wait restarts whenever the lock changes hands (its content
// changes or it is gone), so a writer queued behind others that keep finishing is not
// dropped; options.maxWaitMs bounds the whole wait (perHolder without it waits waitMs in all).
function _acquireFileLock(lockPath, waitMs = LOCK_WAIT_MS, options = {}) {
  const start = Date.now();
  const token = `${process.pid}:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const maxWaitMs = Number.isFinite(options.maxWaitMs) ? options.maxWaitMs : waitMs;
  let contended = false, refusedSince = null, since = start, holder;
  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(lockPath, token, { flag: 'wx' });
      _heldLocks.set(lockPath, { token, acquiredAt: Date.now() });
      return { acquired: true, contended, waitMs: Date.now() - start };
    } catch (error) {
      let stolen = false, seen = null;
      if (error.code === 'EEXIST') {
        refusedSince = null;
        contended = true;
        const look = _inspectLock(lockPath);
        seen = look.content;
        stolen = look.stale && _stealStaleLock(lockPath, look.content);
      } else {
        // A lock file being deleted still answers stat (EPERM); one that is not there says ENOENT.
        let present = true;
        try { fs.statSync(lockPath); } catch (statError) { present = statError.code !== 'ENOENT'; }
        if (present) { contended = true; refusedSince = null; }
        else if (refusedSince === null) refusedSince = Date.now();
      }
      const now = Date.now();
      if (options.perHolder && (attempt === 0 || seen !== holder)) { holder = seen; since = now; }
      const refusedAlone = refusedSince !== null && now - refusedSince >= Math.min(waitMs, REFUSAL_RETRY_MS);
      const capped = options.perHolder && now - start >= maxWaitMs;
      // A takeover that just removed a dead owner's lock gets its one write attempt.
      if (!stolen && (refusedAlone || capped || now - since >= waitMs)) return { acquired: false, contended, waitMs: now - start, error: error.code || 'UNKNOWN' };
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
