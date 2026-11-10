'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir, getProjectName, getStorageRoot, readFileOrDefault, writeFile, readJsonOrDefault, writeJson, ensureDir } = require('./utils');
const { readIndexSafe, getTimestamp } = require('./core/memory-index-file');
const { tryWithMemoryIndex } = require('./core/memory-lock');
const { refineRaw, refineRawSync } = require('./refine-raw');
const { checkAndRotate } = require('./memory-rotation');
const { extractDelta } = require('./extract-delta');
const { STORAGE_ROOT, MEMORY_DIR, MEMORY_FILE, SESSIONS_DIR, COUNTER_FILE, INDEX_FILE } = require('./constants');
const { detectRegressingSkillCall, advancePhase } = require('./core/regressing-phase');
const { readStdin } = require('./transcript-utils');
const { findTranscriptPath } = require('./core/transcript');
const { inspectSessionTranscript, resolveClaudeTranscript } = require('./core/session-intent');
const { getProjectMemoryPath } = require('./core/project-memory');
const { readSessionState, writeSessionState, removeSessionState, pruneSessionStates, sessionKey } = require('./core/session-state');
const { markSessionStarted } = require('./core/session-delta');

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), STORAGE_ROOT, 'config.json');
const DEFAULT_INTERVAL = 15;
const FINAL_LOCK_WAIT_MS = 800;

// Get logs directory (ensures it exists)
function getLogsDir() {
  const logsDir = path.join(getStorageRoot(), 'memory', 'logs');
  ensureDir(logsDir);
  return logsDir;
}


function getConfig() {
  const configPath = path.join(getStorageRoot(), 'memory', 'config.json');
  let config = readJsonOrDefault(configPath, null);
  if (!config) {
    config = readJsonOrDefault(GLOBAL_CONFIG_PATH, { saveInterval: DEFAULT_INTERVAL, keepRaw: false });
  }
  return config;
}

// Save-interval counter. With a session id it is that session's own count
// (session-state/<sid8>/counter.json), so sessions do not trigger each other's
// saves and the count never needs the shared memory-index lock. Without a
// session id the legacy project-wide counter.json is used.
function getCounter(sessionId) {
  if (sessionKey(sessionId)) {
    const data = readSessionState(getProjectDir(), sessionId, 'counter', { counter: 0 }) || {};
    return data.counter || 0;
  }
  const counterPath = path.join(getStorageRoot(), MEMORY_DIR, COUNTER_FILE);
  const data = readJsonOrDefault(counterPath, { counter: 0 });
  return data.counter || 0;
}

function setCounter(value, sessionId) {
  if (sessionKey(sessionId)) {
    writeSessionState(getProjectDir(), sessionId, 'counter', { counter: value, updatedAt: new Date().toISOString() });
    return;
  }
  const counterPath = path.join(getStorageRoot(), MEMORY_DIR, COUNTER_FILE);
  writeJson(counterPath, { counter: value });
}

// L1 read position for one transcript. Per session in session-state; the legacy
// project-wide fields in memory-index.json only for payloads without a session id.
function readL1Cursor(sessionId, index) {
  if (sessionKey(sessionId)) return readSessionState(getProjectDir(), sessionId, 'l1-cursor', null);
  if (index.lastL1TranscriptMtime === undefined && index.lastL1TranscriptOffset === undefined) return null;
  return { offset: index.lastL1TranscriptOffset || 0, mtime: index.lastL1TranscriptMtime || 0 };
}

function writeL1Cursor(sessionId, index, cursor) {
  if (sessionKey(sessionId)) return writeSessionState(getProjectDir(), sessionId, 'l1-cursor', { ...cursor, updatedAt: new Date().toISOString() });
  index.lastL1TranscriptMtime = cursor.mtime;
  index.lastL1TranscriptOffset = cursor.offset;
  return true;
}

function findSessionL1(sessionsDir, sessionId8) {
  if (!sessionId8 || !fs.existsSync(sessionsDir)) return null;
  return fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.l1.jsonl') && f.includes(`_${sessionId8}`))
    .sort().reverse()[0] || null; // newest first
}

// Brings this session's L1 up to date: refines only what the transcript gained since
// the session's last L1 update and appends it (a new L1 when the session has none),
// so the cost follows the new part, not the whole transcript. The interval save and
// SessionEnd both use it. Returns true when `index` changed and must be written.
function updateSessionL1({ transcriptPath, sessionId, sessionId8, index, sessionsDir }) {
  const stat = fs.statSync(transcriptPath);
  const cursor = readL1Cursor(sessionId, index);
  const sameTranscript = !cursor || !cursor.transcriptPath || cursor.transcriptPath === transcriptPath;
  // Only refine when this transcript changed since this session's last L1 update
  const changed = !cursor || !sameTranscript || !cursor.mtime
    || stat.mtimeMs > cursor.mtime || (cursor.size !== undefined && stat.size !== cursor.size);
  if (!changed) return false;
  ensureDir(sessionsDir);

  // Append to this session's existing L1 from its own position (offset mode),
  // or create a new L1 (fresh session / no existing L1)
  let l1Dest;
  let startOffset = 0;
  const existingL1 = findSessionL1(sessionsDir, sessionId8);
  if (existingL1) {
    l1Dest = path.join(sessionsDir, existingL1);
    // No per-session cursor yet: a session that predates per-session
    // tracking falls back to the legacy project-wide position.
    startOffset = cursor && sameTranscript ? (cursor.offset || 0)
      : (!cursor && sessionId8 ? index.lastL1TranscriptOffset || 0 : 0);
  } else {
    const ts = getTimestamp();
    l1Dest = path.join(sessionsDir, sessionId8 ? `${ts}_${sessionId8}.l1.jsonl` : `${ts}.l1.jsonl`);
    // First L1 of this session: none of its entries has been summarized.
    markSessionStarted(index, sessionId8);
  }

  const result = refineRawSync(transcriptPath, l1Dest, startOffset);
  if (fs.existsSync(l1Dest)) cleanupDuplicateL1(l1Dest);
  const newOffset = result && typeof result === 'object' && result.newOffset !== undefined
    ? result.newOffset : stat.size;
  writeL1Cursor(sessionId, index, { transcriptPath, offset: newOffset, mtime: stat.mtimeMs, size: stat.size });
  return true;
}

// PostToolUse. With a payload (the Claude PostToolUse dispatcher) it does not read
// stdin and returns host notices instead of printing them.
async function check(payload = null) {
  const hookData = payload || await readStdin(1000);
  const notices = [];
  // CLAUDE_PROJECT_DIR (set by Claude Code) is the authoritative project root.
  // Do NOT use hookData.cwd — it changes when Bash cd's to subdirectories.
  const sessionId = hookData.session_id || null;
  const sessionId8 = sessionKey(sessionId);

  const memoryDir = path.join(getStorageRoot(), MEMORY_DIR);
  ensureDir(memoryDir);

  // Regressing: auto-advance phase on skill invocation (own state file).
  try {
    const detectedSkill = detectRegressingSkillCall(hookData);
    if (detectedSkill) {
      const newPhase = advancePhase(detectedSkill, getProjectDir(), sessionId, hookData.tool_input && hookData.tool_input.args);
      if (newPhase) {
        console.error(`[REGRESSING PHASE] ${detectedSkill} -> ${newPhase}`);
      }
    }
  } catch (e) {
    // Non-fatal: must not break counter/delta pipeline
    console.error(`[REGRESSING PHASE ERROR] ${e.message}`);
  }

  const config = getConfig();
  const interval = config.saveInterval || DEFAULT_INTERVAL;
  const counter = getCounter(sessionId) + 1;
  setCounter(counter, sessionId);
  const saveDue = counter >= interval;
  if (!saveDue) return;

  // When another process holds the lock the save is skipped (fail-open): the
  // counter stays at or above the interval, so this session's next tool call
  // retries it.
  const outcome = tryWithMemoryIndex(memoryDir, () => {
    // Check rotation before auto-save
    const memoryPath = path.join(getStorageRoot(), MEMORY_DIR, MEMORY_FILE);
    const rotationResult = checkAndRotate(memoryPath, config);
    if (rotationResult) {
      if (payload) notices.push(rotationResult.hookOutput);
      else console.log(rotationResult.hookOutput);
    }

    const indexPath = path.join(getStorageRoot(), MEMORY_DIR, INDEX_FILE);
    const sessionsDir = path.join(getStorageRoot(), SESSIONS_DIR);

    // Step 1: Create/update L1 from current transcript
    // Prefer transcript_path from hookData, fallback to findTranscriptPath()
    const transcriptPath = (hookData.transcript_path && hookData.transcript_path !== '')
      ? hookData.transcript_path
      : findTranscriptPath();

    if (transcriptPath) {
      try {
        const idx = readIndexSafe(indexPath);
        if (updateSessionL1({ transcriptPath, sessionId, sessionId8, index: idx, sessionsDir })) writeJson(indexPath, idx);
      } catch (e) {
        fs.appendFileSync(path.join(getLogsDir(), 'error.log'),
          `${new Date().toISOString()}: check() L1 creation failed: ${e.message}\n`);
      }
    }

    // Step 2: Try delta extraction (session-aware L1 selection and baseline);
    // extraction sets deltaReady in the same lock hold.
    extractDelta(sessionId8);
    setCounter(0, sessionId);
    return notices;
  });
  return outcome.ran ? outcome.value : undefined;
}

async function final() {
  const hookData = await readStdin(1000);
  const transcriptSrc = resolveClaudeTranscript(hookData);
  const sessionIntent = inspectSessionTranscript(transcriptSrc);
  if (!sessionIntent.persist) return;

  // CLAUDE_PROJECT_DIR (set by Claude Code) is the authoritative project root.
  const sessionId = hookData.session_id || null;
  const sessionId8 = sessionKey(sessionId);
  const timestamp = getTimestamp();
  const sessionsDir = path.join(getStorageRoot(), SESSIONS_DIR);

  ensureDir(sessionsDir);
  const hadSessionL1 = Boolean(findSessionL1(sessionsDir, sessionId8));

  // Debug: log what we received
  const logsDir = getLogsDir();
  const debugPath = path.join(logsDir, 'debug-hook.json');
  writeJson(debugPath, {
    hookData,
    timestamp,
    hasTranscript: !!hookData.transcript_path,
    transcriptPath: hookData.transcript_path || null,
    sessionId: hookData.session_id || null
  });

  // Keep a raw copy of the transcript only when the user asked for one (keepRaw).
  if (transcriptSrc && getConfig().keepRaw) {
    try {
      const rawBase = sessionId8 ? `${timestamp}_${sessionId8}` : timestamp;
      fs.copyFileSync(transcriptSrc, path.join(sessionsDir, `${rawBase}.raw.jsonl`));
    } catch (e) {
      fs.appendFileSync(path.join(logsDir, 'error.log'),
        `${timestamp}: Failed to copy transcript: ${e.message}\n`);
    }
  }

  // In one lock hold: bring this session's L1 up to date (the interval save's
  // incremental path, so only what was written since the last save is refined),
  // prune old L1 files (never this session's own), then extract the delta, so
  // extractDelta never selects a stale file.
  const idxPath = path.join(getStorageRoot(), MEMORY_DIR, INDEX_FILE);
  const finalMemoryDir = path.join(getStorageRoot(), MEMORY_DIR);
  const updateL1 = index => {
    if (!transcriptSrc) return false;
    try {
      return updateSessionL1({ transcriptPath: transcriptSrc, sessionId, sessionId8, index, sessionsDir });
    } catch (e) {
      fs.appendFileSync(path.join(logsDir, 'error.log'),
        `${timestamp}: Failed to update L1: ${e.message}\n`);
      return false;
    }
  };
  // SessionEnd shares a 1.5 s host budget; waiting longer than a tool-call hook
  // keeps a busy lock from dropping the session's last entries.
  const outcome = tryWithMemoryIndex(finalMemoryDir, () => {
    const idx = readIndexSafe(idxPath);
    let indexChanged = updateL1(idx);
    // A session ending before its first save: its L1 holds only its own entries.
    if (sessionId8 && !hadSessionL1 && markSessionStarted(idx, sessionId8)) indexChanged = true;
    if (indexChanged) writeJson(idxPath, idx);
    try {
      pruneOldL1({ keep: findSessionL1(sessionsDir, sessionId8) });
    } catch (e) {
      fs.appendFileSync(path.join(logsDir, 'error.log'),
        `${timestamp}: Failed to prune old L1 files: ${e.message}\n`);
    }
    extractDelta(sessionId8);
    if (!sessionId8) {
      // Legacy project-wide position — the next session starts fresh
      const idx = readIndexSafe(idxPath);
      delete idx.lastL1TranscriptOffset;
      delete idx.lastL1TranscriptMtime;
      writeJson(idxPath, idx);
    }
  }, { waitMs: FINAL_LOCK_WAIT_MS });
  // Another process held the memory index past the wait: still save this session's
  // tail to its L1. The index is left alone; the next save records what it needs.
  if (!outcome.ran) updateL1({});
  if (sessionId8) {
    removeSessionState(getProjectDir(), sessionId, 'counter');
    require('./core/skill-flag').clearSkillActive(getProjectDir(), sessionId);
  }
  try { pruneSessionStates(getProjectDir()); } catch {}

  // SessionEnd prints nothing: Claude Code discards a SessionEnd hook's JSON output
  // (systemMessage included) and no model turn follows. The saved L1 and delta are
  // picked up by the next session's memory notice.
  if (!sessionId8) setCounter(0);
}

function reset() {
  setCounter(0);
  console.log('[CRABSHELL] Counter reset.');
}

// First line of a file, read in chunks so a large L1 is not read whole.
function readFirstLine(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunks = [];
    const buffer = Buffer.alloc(64 * 1024);
    for (let position = 0; ;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (read === 0) break;
      const newline = buffer.subarray(0, read).indexOf(0x0a);
      chunks.push(Buffer.from(buffer.subarray(0, newline === -1 ? read : newline)));
      if (newline !== -1) break;
      position += read;
    }
    return Buffer.concat(chunks).toString('utf8').replace(/\r$/, '');
  } finally {
    fs.closeSync(fd);
  }
}

// Remove duplicate L1 files from same session (keep only the largest/latest)
function cleanupDuplicateL1(newL1Path) {
  const sessionsDir = path.dirname(newL1Path);
  const newL1FirstLine = readFirstLine(newL1Path);

  let sessionStartTs;
  try {
    sessionStartTs = JSON.parse(newL1FirstLine).ts;
  } catch (e) {
    return; // Skip if parsing fails
  }

  const newL1Size = fs.statSync(newL1Path).size;
  const newL1Name = path.basename(newL1Path);

  // Find and delete smaller L1 files from same session
  const l1Files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl'));

  for (const fileName of l1Files) {
    if (fileName === newL1Name) continue;

    const filePath = path.join(sessionsDir, fileName);
    const firstLine = readFirstLine(filePath);

    try {
      const fileStartTs = JSON.parse(firstLine).ts;
      const fileSize = fs.statSync(filePath).size;

      // Same session and smaller than new file = delete
      if (fileStartTs === sessionStartTs && fileSize < newL1Size) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      continue;
    }
  }
}

// Delete L1 files older than 30 days based on filename date prefix
// Uses calendar days (Math.floor) matching compress() behavior:
// exactly 30 days old → keep, >30 days → delete
// Whole calendar days from a local-midnight date to now. Measured midnight to midnight and
// rounded, so a day of 23 or 25 hours (a daylight-saving change) still counts as one day.
function calendarDaysSince(localMidnight, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - localMidnight) / (1000 * 60 * 60 * 24));
}

// `keep` names an L1 file never to delete: the ending session's own L1, which an
// incremental update keeps under its start date.
function pruneOldL1({ keep = null } = {}) {
  const sessionsDir = path.join(getStorageRoot(), SESSIONS_DIR);
  if (!fs.existsSync(sessionsDir)) return 0;

  const now = new Date();
  const l1Files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl') && f !== keep);
  let pruned = 0;

  for (const fileName of l1Files) {
    // Parse date from filename: YYYY-MM-DD_HHMM or YYYYMMDD_HHMMSS format
    // Use local-time Date constructor (matching compress() behavior)
    let fileDate;
    const dashMatch = fileName.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const compactMatch = !dashMatch && fileName.match(/^(\d{4})(\d{2})(\d{2})/);
    if (dashMatch) {
      fileDate = new Date(parseInt(dashMatch[1]), parseInt(dashMatch[2]) - 1, parseInt(dashMatch[3]));
    } else if (compactMatch) {
      fileDate = new Date(parseInt(compactMatch[1]), parseInt(compactMatch[2]) - 1, parseInt(compactMatch[3]));
    } else {
      continue;
    }

    if (isNaN(fileDate.getTime())) continue;

    // Calendar days, as compress() counts them — >30 days means 31+
    const daysOld = calendarDaysSince(fileDate, now);
    if (daysOld > 30) {
      try {
        fs.unlinkSync(path.join(sessionsDir, fileName));
        pruned++;
      } catch (e) {
        // fail-open: skip files that can't be deleted (permission errors, etc.)
      }
    }
  }

  if (pruned > 0) {
    console.error(`[CRABSHELL] Pruned ${pruned} old L1 files (>30 days)`);
  }
  return pruned;
}

// Deduplicate all L1 files (keep largest per session)
function dedupeL1() {
  const sessionsDir = path.join(getStorageRoot(), SESSIONS_DIR);
  if (!fs.existsSync(sessionsDir)) {
    console.log('[CRABSHELL] No sessions directory found');
    return;
  }

  const l1Files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl'));
  const tsMap = {};

  // Group files by session start timestamp
  for (const f of l1Files) {
    try {
      const filePath = path.join(sessionsDir, f);
      const firstLine = readFirstLine(filePath);
      const ts = JSON.parse(firstLine).ts;
      const size = fs.statSync(filePath).size;
      if (!tsMap[ts]) tsMap[ts] = [];
      tsMap[ts].push({ file: f, size, path: filePath });
    } catch (e) {
      continue;
    }
  }

  let deletedCount = 0;
  let savedBytes = 0;

  // Find and delete duplicates
  for (const [ts, files] of Object.entries(tsMap)) {
    if (files.length > 1) {
      files.sort((a, b) => b.size - a.size);
      console.log(`\nDuplicate found: session ${ts}`);
      console.log(`  ✅ Keep: ${files[0].file} (${(files[0].size / 1024).toFixed(0)}KB)`);

      for (let i = 1; i < files.length; i++) {
        console.log(`  ❌ Delete: ${files[i].file} (${(files[i].size / 1024).toFixed(0)}KB)`);
        savedBytes += files[i].size;
        fs.unlinkSync(files[i].path);
        deletedCount++;
      }
    }
  }

  if (deletedCount === 0) {
    console.log('[CRABSHELL] No duplicate L1 files found');
  } else {
    console.log(`\n[CRABSHELL] Deleted: ${deletedCount} files, saved ${(savedBytes / 1024 / 1024).toFixed(2)}MB`);
  }
}


async function refineAll() {
  const sessionsDir = path.join(getStorageRoot(), SESSIONS_DIR);
  if (!fs.existsSync(sessionsDir)) {
    console.log('[CRABSHELL] No sessions directory found');
    return;
  }

  const rawFiles = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.raw.jsonl'))
    .filter(f => !fs.existsSync(path.join(sessionsDir, f.replace('.raw.jsonl', '.l1.jsonl'))));

  if (rawFiles.length === 0) {
    console.log('[CRABSHELL] All raw files already have L1 versions');
    return;
  }

  console.log(`[CRABSHELL] Processing ${rawFiles.length} raw files...`);

  let totalRaw = 0;
  let totalL1 = 0;

  for (const file of rawFiles) {
    const rawPath = path.join(sessionsDir, file);
    const l1Path = rawPath.replace('.raw.jsonl', '.l1.jsonl');

    try {
      await refineRaw(rawPath, l1Path);
      const rawSize = fs.statSync(rawPath).size;
      const l1Size = fs.statSync(l1Path).size;
      totalRaw += rawSize;
      totalL1 += l1Size;
      console.log(`  ${file}: ${(rawSize/1024/1024).toFixed(1)}MB → ${(l1Size/1024/1024).toFixed(1)}MB`);
    } catch (e) {
      console.log(`  ${file}: ERROR - ${e.message}`);
    }
  }

  const reduction = ((1 - totalL1 / totalRaw) * 100).toFixed(1);
  console.log(`[CRABSHELL] Total: ${(totalRaw/1024/1024).toFixed(1)}MB → ${(totalL1/1024/1024).toFixed(1)}MB (${reduction}% reduction)`);
}

function compress() {
  const projectDir = getProjectDir();
  const sessionsDir = path.join(getStorageRoot(projectDir), SESSIONS_DIR);

  ensureDir(sessionsDir);

  const now = new Date();

  try {
    const files = fs.readdirSync(sessionsDir).filter(f =>
      f.endsWith('.md') && !f.includes('week-') && !f.startsWith('archive')
    );

    files.forEach(file => {
      const match = file.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!match) return;

      const fileDate = new Date(match[1], match[2] - 1, match[3]);
      const daysOld = calendarDaysSince(fileDate, now);

      if (daysOld > 30) {
        const archiveDir = path.join(sessionsDir, 'archive');
        ensureDir(archiveDir);
        const archiveFile = path.join(archiveDir, `${match[1]}-${match[2]}.md`);
        const content = readFileOrDefault(path.join(sessionsDir, file), '');
        fs.appendFileSync(archiveFile, `\n\n---\n\n${content}`);
        fs.unlinkSync(path.join(sessionsDir, file));
        console.log(`[CRABSHELL] Archived: ${file}`);
      }
    });
  } catch (e) {
    console.log(`[CRABSHELL] Compress error: ${e.message}`);
  }

  console.log('[CRABSHELL] Compression complete.');
}

// Memory file management (v7.0.0)
const MEMORY_FILES = {
  project: { title: 'Project Overview', resolvePath: getProjectMemoryPath }
};

function memorySet(name, content) {
  if (!name) {
    console.log('[CRABSHELL] Error: memory name required');
    console.log('  Valid names: project');
    return;
  }

  const key = name.toLowerCase();
  const memConfig = MEMORY_FILES[key];

  if (!memConfig) {
    console.log(`[CRABSHELL] Unknown memory file: ${name}`);
    console.log('  Valid names: project');
    return;
  }

  if (!content) {
    console.log('[CRABSHELL] Error: content required');
    console.log(`  Usage: memory-set ${key} "Your content here"`);
    return;
  }

  const projectDir = getProjectDir();
  const filePath = memConfig.resolvePath(projectDir);
  ensureDir(path.dirname(filePath));
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.bak`);

  writeFile(filePath, content);
  console.log(`[CRABSHELL] Saved ${memConfig.title} to ${path.relative(projectDir, filePath).replace(/\\/g, '/')}`);
}

function memoryGet(name) {
  const projectDir = getProjectDir();

  if (!name) {
    // Show all memory files
    console.log('[CRABSHELL] Memory Files:');
    Object.entries(MEMORY_FILES).forEach(([key, config]) => {
      const filePath = config.resolvePath(projectDir);
      if (fs.existsSync(filePath)) {
        const content = readFileOrDefault(filePath, '').trim();
        const lines = content.split(/\r?\n/).length;
        const preview = content.substring(0, 100).replace(/\n/g, ' ');
        console.log(`\n[${key}] ${config.title} (${lines} lines)`);
        console.log(`  ${preview}${content.length > 100 ? '...' : ''}`);
      } else {
        console.log(`\n[${key}] ${config.title} - not created`);
      }
    });
    return;
  }

  const key = name.toLowerCase();
  const memConfig = MEMORY_FILES[key];

  if (!memConfig) {
    console.log(`[CRABSHELL] Unknown memory file: ${name}`);
    console.log('  Valid names: project');
    return;
  }

  const filePath = memConfig.resolvePath(projectDir);
  if (!fs.existsSync(filePath)) {
    console.log(`[CRABSHELL] ${memConfig.title} not created yet.`);
    console.log(`  Create with: memory-set ${key} "content"`);
    return;
  }

  const content = readFileOrDefault(filePath, '');
  console.log(`[CRABSHELL] ${memConfig.title}:`);
  console.log('---');
  console.log(content);
  console.log('---');
}

function memoryList() {
  const projectDir = getProjectDir();
  console.log('[CRABSHELL] Memory Structure:');

  let total = 0;
  Object.entries(MEMORY_FILES).forEach(([key, config]) => {
    const filePath = config.resolvePath(projectDir);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const content = readFileOrDefault(filePath, '');
      const lines = content.trim().split(/\r?\n/).length;
      console.log(`  ✓ ${path.relative(projectDir, filePath).replace(/\\/g, '/')} (${lines} lines, ${stats.size} bytes)`);
      total++;
    } else {
      console.log(`  ○ ${path.relative(projectDir, filePath).replace(/\\/g, '/')} - not created`);
    }
  });

  // Also show logbook.md (rolling)
  const memoryPath = path.join(getStorageRoot(projectDir), MEMORY_DIR, MEMORY_FILE);
  if (fs.existsSync(memoryPath)) {
    const stats = fs.statSync(memoryPath);
    const content = readFileOrDefault(memoryPath, '');
    const lines = content.trim().split(/\r?\n/).length;
    console.log(`  ✓ logbook.md (${lines} lines, ${stats.size} bytes) [rolling]`);
  } else {
    console.log(`  ○ logbook.md - not created [rolling]`);
  }

  console.log(`\nHierarchical files: ${total}/1 created`);
}

// Parse --key=value from arguments
function parseArg(args, key) {
  const prefix = `--${key}=`;
  for (const arg of args) {
    if (arg.startsWith(prefix)) {
      return arg.substring(prefix.length);
    }
  }
  return null;
}

// Main execution (only when run directly, not when required as a module)
if (require.main === module) {

// Support --project-dir=PATH for Bash tool invocations where CLAUDE_PROJECT_DIR is not set
const pdIdx = process.argv.findIndex(a => a.startsWith('--project-dir='));
if (pdIdx >= 0) {
  process.env.CLAUDE_PROJECT_DIR = process.argv[pdIdx].slice('--project-dir='.length);
  process.argv.splice(pdIdx, 1);
}

// Main - handle async commands
const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case 'check':
    check().catch(e => {
      // Log crash to file so we can diagnose PostToolUse failures
      try {
        const logsDir = getLogsDir();
        fs.appendFileSync(path.join(logsDir, 'counter-debug.log'),
          `${new Date().toISOString()} | CHECK CRASHED: ${e.message}\n${e.stack}\n`);
      } catch {}
      console.error(`[CRABSHELL] check error: ${e.message}`);
    });
    break;
  case 'final':
    final().catch(e => {
      // SessionEnd hook: fail open, never report a hook failure to the host.
      console.error(`[CRABSHELL] Final error: ${e.message}`);
      process.exit(0);
    });
    break;
  case 'reset':
    reset();
    break;
  case 'compress':
    compress();
    break;
  case 'refine-all':
    refineAll().catch(e => {
      console.error(`[CRABSHELL] Refine-all error: ${e.message}`);
      process.exit(1);
    });
    break;
  case 'memory-set':
    memorySet(args[0], args.slice(1).join(' '));
    break;
  case 'memory-get':
    memoryGet(args[0]);
    break;
  case 'memory-list':
    memoryList();
    break;
  case 'generate-l3':
    // Manual L3 summary generation
    if (args[0]) {
      console.log('[CRABSHELL_ROTATE] file=' + args[0]);
    } else {
      console.log('[CRABSHELL] Usage: generate-l3 <archive-file>');
    }
    break;
  case 'search-memory':
    {
      const { searchMemory } = require('./search');
      const deep = args.includes('--deep');
      const useRegex = args.includes('--regex');
      const contextSize = parseInt(parseArg(args, 'context') || '2');
      const limit = parseInt(parseArg(args, 'limit') || '20');
      const query = args.filter(a => !a.startsWith('--'))[0];
      if (!query) {
        console.log('[CRABSHELL] Usage: search-memory <query> [--deep] [--regex] [--context=N] [--limit=N]');
        break;
      }
      const results = searchMemory(query, { deep, regex: useRegex, contextWindow: contextSize });
      if (results.length === 0) {
        console.log('[CRABSHELL] No results for "' + query + '"');
      } else {
        for (const r of results) {
          console.log('\n[' + r.source + '] (' + r.matches.length + ' matches)');
          for (const m of r.matches.slice(0, limit)) {
            if (m.entry) {
              // L1 result with structured entry
              console.log('  ' + m.file + ':');
              console.log('    >>> [' + (m.entry.ts || '?') + '] ' + (m.entry.role || '?') + ': "' + m.entry.text + '"');
              if (m.context && m.context.length > 0) {
                for (const c of m.context) {
                  console.log('    [ctx] [' + (c.ts || '?') + '] ' + (c.role || '?') + ': "' + c.text + '"');
                }
              }
            } else if (m.line) {
              console.log('  L' + m.line + ': ' + m.text);
            } else if (m.type) {
              console.log('  [' + m.type + '] ' + m.content);
            } else {
              console.log('  ' + m.file);
            }
          }
          if (r.matches.length > limit) console.log('  ... and ' + (r.matches.length - limit) + ' more');
        }
      }
    }
    break;
  case 'migrate-legacy':
    {
      const { splitLegacyMemory } = require('./legacy-migration');
      const mp = path.join(getStorageRoot(), 'memory', MEMORY_FILE);
      const result = splitLegacyMemory(mp);
      if (result) {
        console.log('[CRABSHELL] Legacy split: ' + result.archives.length + ' archives created');
        result.triggers.forEach(t => console.log(t));
      } else {
        console.log('[CRABSHELL] No migration needed (under threshold)');
      }
    }
    break;
  case 'dedupe-l1':
    dedupeL1();
    break;
  default:
    console.log(`Usage: counter.js <command>

Core Commands:
  check                  Increment counter, trigger auto-save at interval
  final                  Session end handler
  reset                  Reset counter to 0

Memory Management:
  memory-set <name> <content>   Set memory file (project)
  memory-get [name]             Get memory file content
  memory-list                   List all memory files

Memory Rotation (v13.0.0):
  search-memory <query> [--deep]  Search L3/L2/L1 hierarchically
  generate-l3 <archive-file>      Manual L3 summary generation
  migrate-legacy                  Split oversized legacy logbook.md
  compress                        Archive old sessions (30+ days)
  refine-all                      Process raw.jsonl to L1
  dedupe-l1                       Remove duplicate L1 files (keep largest)
`);
}

} // end if (require.main === module)

// Export for testing (only when required as a module, not when run directly)
if (require.main !== module) {
  module.exports = { check, getCounter, setCounter, getConfig, cleanupDuplicateL1, dedupeL1, parseArg, compress, pruneOldL1 };
}
