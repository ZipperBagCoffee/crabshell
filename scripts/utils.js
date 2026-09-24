const fs = require('fs');
const path = require('path');
const os = require('os');
const { STORAGE_ROOT, MEMORY_DIR, INDEX_FILE, MEMORY_FILE, LOCK_FILE, INDEX_LOCK_FILE, LOCK_STALE_MS, LOCK_WAIT_MS } = require('./constants');

// Subprocess marker — top-level guard for fail-open invariant. D106 IA-10.
function isBackground() { return process.env.CRABSHELL_BACKGROUND === '1'; }

function getProjectName() { return path.basename(getProjectDir()); }

function getProjectDir() {
  // CLAUDE_PROJECT_DIR is set by Claude Code for hooks — always the project root,
  // regardless of Bash cd or session restarts. This is the authoritative source.
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  if (process.env.PROJECT_DIR) return process.env.PROJECT_DIR;
  return process.cwd();
}

function parseProjectDirArg(argv) {
  for (const a of argv) if (a.startsWith('--project-dir=')) return a.slice('--project-dir='.length);
  return getProjectDir();
}

function getStorageRoot(projectDir) { return path.join(projectDir || getProjectDir(), STORAGE_ROOT); }

function getMemoryDir() { return path.join(getStorageRoot(), MEMORY_DIR); }

const MEMORY_ROOT = path.join(os.homedir(), '.crabshell', 'projects');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readFileOrDefault(filePath, defaultValue) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return defaultValue; }
}

function readJsonOrDefault(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return defaultValue; }
}

// Default memory-index.json structure - prevents field loss on parse errors
function getDefaultIndex() {
  return {
    version: 1,
    current: MEMORY_FILE,
    rotatedFiles: [],
    stats: { totalRotations: 0, lastRotation: null },
    lastMemoryUpdateTs: null
  };
}

// Safe index reader - ALWAYS returns complete structure, preserving existing values
// Uses spread to auto-preserve new optional fields (deltaReady, pendingLastProcessedTs, etc.)
function readIndexSafe(indexPath) {
  const defaults = getDefaultIndex();
  try {
    if (!fs.existsSync(indexPath)) return defaults;
    const existing = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return {
      ...defaults,
      ...existing,
      // Array/object fields need safe validation
      rotatedFiles: Array.isArray(existing.rotatedFiles) ? existing.rotatedFiles : defaults.rotatedFiles,
      stats: existing.stats ?? defaults.stats,
    };
  } catch {
    return defaults;
  }
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  const content = JSON.stringify(data, null, 2);
  // Per-process temp name: a shared "<file>.tmp" let concurrent hook instances
  // overwrite each other's half-written temp, so a rename could publish another
  // process's partial JSON (observed as "Unexpected end of JSON input" readers
  // in _test-inject-rules-race). rename stays the only publish operation —
  // readers never see a torn file.
  const tempPath = `${filePath}.${process.pid}.tmp`;
  // Windows: renameSync can fail with EPERM while a concurrent hook instance
  // or antivirus briefly holds the target open. Retry with a short backoff;
  // fall back to a direct (non-atomic) write only as the final attempt.
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, filePath);
      return;
    } catch (e) {
      lastError = e;
      try { fs.unlinkSync(tempPath); } catch {}
      // Synchronous backoff (hooks are short-lived sync CLIs): 5/10/15ms.
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 * (attempt + 1)); } catch {}
    }
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

function getTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return now.getUTCFullYear() + '-' + pad(now.getUTCMonth()+1) + '-' + pad(now.getUTCDate()) + '_' + pad(now.getUTCHours()) + pad(now.getUTCMinutes());
}

function estimateTokens(text) { return Math.ceil(Buffer.byteLength(text, 'utf8') / 4); }
function estimateTokensFromFile(filePath) { return Math.ceil(fs.statSync(filePath).size / 4); }

function extractTailByTokens(content, targetTokens) {
  const lines = content.split(/\r?\n/);
  let tokens = 0, startIndex = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const lineTokens = estimateTokens(lines[i] + '\n');
    if (tokens + lineTokens > targetTokens) break;
    tokens += lineTokens; startIndex = i;
  }
  return lines.slice(startIndex).join('\n');
}

function updateIndex(archivePath, tokens, memoryDir, dateRange) {
  const indexPath = path.join(memoryDir, INDEX_FILE);
  const index = readIndexSafe(indexPath);  // Use safe reader to preserve all fields
  const entry = { file: path.basename(archivePath), rotatedAt: new Date().toISOString(), tokens, bytes: fs.statSync(archivePath).size, summary: path.basename(archivePath).replace('.md', '.summary.json'), summaryGenerated: false };
  if (dateRange) entry.dateRange = dateRange;
  index.rotatedFiles.push(entry);
  index.stats.totalRotations++;
  index.stats.lastRotation = new Date().toISOString();
  writeJson(indexPath, index);
}

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

module.exports = { MEMORY_ROOT, isBackground, getProjectName, getProjectDir, parseProjectDirArg, getStorageRoot, getMemoryDir, ensureDir, readFileOrDefault, readJsonOrDefault, getDefaultIndex, readIndexSafe, writeFile, writeJson, getTimestamp, estimateTokens, estimateTokensFromFile, extractTailByTokens, updateIndex, acquireLock, releaseLock, acquireIndexLock, releaseIndexLock, ownsIndexLock, acquireFileLock: _acquireFileLock, releaseFileLock: _releaseFileLock, _recordContention };
