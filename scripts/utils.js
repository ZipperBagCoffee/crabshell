const fs = require('fs');
const path = require('path');
const os = require('os');
const { STORAGE_ROOT, MEMORY_DIR, INDEX_FILE, MEMORY_FILE, LOCK_FILE, INDEX_LOCK_FILE, LOCK_STALE_MS } = require('./constants');

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
  const tempPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tempPath, content, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (e) {
    // Windows: renameSync fails with EPERM/ENOENT when target is locked
    // (antivirus, concurrent hook instances). Fallback to direct write.
    try { fs.unlinkSync(tempPath); } catch {}
    fs.writeFileSync(filePath, content, 'utf8');
  }
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

function acquireLock(memoryDir) {
  const lockPath = path.join(memoryDir, LOCK_FILE);
  try { fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' }); return true; }
  catch (e) { try { if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lockPath); return acquireLock(memoryDir); } } catch {} return false; }
}

function releaseLock(memoryDir) { try { fs.unlinkSync(path.join(memoryDir, LOCK_FILE)); } catch {} }

// D107 cycle 5 F-4 instrumentation — best-effort lock-contention measurement.
// In-process map of acquire timestamps keyed by lockName for accurate held-time
// pairing in single-process scope. Cross-process held time is approximated via
// `lastAcquiredAt` on disk (read by releaseIndexLock). Under-counting bias is
// acceptable: F-4 reports lower bound; concurrent writes to lock-contention.json
// may lose increments since recordContention CANNOT acquire any lock (deadlock
// prevention per P147 RA1 R-1 — `recordContention` invoked from inside the lock
// primitive itself, recursive lock acquisition would infinite-loop).
const _acquireTimeStore = new Map();
const CONTENTION_FILE = 'lock-contention.json';

function _recordContention(memoryDir, lockName, op, ms) {
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
      if ((ms || 0) > 0) m.contendedCount = (m.contendedCount || 0) + 1;
      m.lastAcquiredPid = process.pid;
    } else if (op === 'release') {
      m.releaseCount = (m.releaseCount || 0) + 1;
      m.totalHeldMs = (m.totalHeldMs || 0) + (ms || 0);
      if ((ms || 0) > (m.maxHeldMs || 0)) m.maxHeldMs = ms;
    }
    m.lastUpdatedAt = nowIso;
    writeJson(filePath, state);
  } catch {}
}

function acquireIndexLock(memoryDir) {
  const lockPath = path.join(memoryDir, INDEX_LOCK_FILE);
  const _start = Date.now();
  try {
    fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' });
    const _waitMs = Date.now() - _start;
    try { _acquireTimeStore.set(lockPath, Date.now()); } catch {}
    try { _recordContention(memoryDir, INDEX_LOCK_FILE, 'acquire', _waitMs); } catch {}
    return true;
  }
  catch (e) {
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
        fs.unlinkSync(lockPath);
        // Recursion: inner frame records its own metrics; outer frame returns
        // the inner result. No double-counting because only the successful
        // writeFileSync branch records.
        return acquireIndexLock(memoryDir);
      }
    } catch {}
    // Failed acquire: record wait time as contended (best-effort sample).
    const _waitMs = Date.now() - _start;
    try { _recordContention(memoryDir, INDEX_LOCK_FILE, 'acquire', _waitMs); } catch {}
    return false;
  }
}

function releaseIndexLock(memoryDir) {
  const lockPath = path.join(memoryDir, INDEX_LOCK_FILE);
  let _heldMs = 0;
  try {
    const _acquireTimeStored = _acquireTimeStore.get(lockPath);
    if (typeof _acquireTimeStored === 'number') {
      _heldMs = Date.now() - _acquireTimeStored;
      _acquireTimeStore.delete(lockPath);
    }
  } catch {}
  try { fs.unlinkSync(lockPath); } catch {}
  try { _recordContention(memoryDir, INDEX_LOCK_FILE, 'release', _heldMs); } catch {}
}

module.exports = { MEMORY_ROOT, isBackground, getProjectName, getProjectDir, parseProjectDirArg, getStorageRoot, getMemoryDir, ensureDir, readFileOrDefault, readJsonOrDefault, getDefaultIndex, readIndexSafe, writeFile, writeJson, getTimestamp, estimateTokens, estimateTokensFromFile, extractTailByTokens, updateIndex, acquireLock, releaseLock, acquireIndexLock, releaseIndexLock, _recordContention };
