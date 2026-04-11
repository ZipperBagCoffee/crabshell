const path = require('path');
const fs = require('fs');
const { getProjectDir, getProjectName, getStorageRoot, readFileOrDefault, writeFile, readJsonOrDefault, readIndexSafe, writeJson, ensureDir, getTimestamp, acquireIndexLock, releaseIndexLock } = require('./utils');
const os = require('os');
const { refineRaw, refineRawSync } = require('./refine-raw');
const { checkAndRotate } = require('./memory-rotation');
const { extractDelta } = require('./extract-delta');
const { MEMORY_DIR, MEMORY_FILE, SESSIONS_DIR, COUNTER_FILE, WA_COUNT_FILE } = require('./constants');
const { detectRegressingSkillCall, advancePhase } = require('./regressing-state');
const { readStdin: readStdinShared, findTranscriptPath } = require('./transcript-utils');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.crabshell', 'config.json');
const DEFAULT_INTERVAL = 15;

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
    config = readJsonOrDefault(GLOBAL_CONFIG_PATH, { saveInterval: DEFAULT_INTERVAL, keepRaw: false, quietStop: true });
  }
  return config;
}

// Use shared readStdin with 1000ms timeout for PostToolUse hook
function readStdin() {
  return readStdinShared(1000);
}


// Counter stored in counter.json (separated from memory-index.json)
function getCounter() {
  const counterPath = path.join(getStorageRoot(), MEMORY_DIR, COUNTER_FILE);
  const data = readJsonOrDefault(counterPath, { counter: 0 });
  return data.counter || 0;
}

function setCounter(value) {
  const counterPath = path.join(getStorageRoot(), MEMORY_DIR, COUNTER_FILE);
  writeJson(counterPath, { counter: value });
}

/**
 * Reset the WA count file to zero. Called on ticketing skill invocation.
 * Fail-open: writes reset state, swallows errors.
 */
function resetWaCount() {
  try {
    const projectDir = getProjectDir();
    const waPath = path.join(getStorageRoot(projectDir), MEMORY_DIR, WA_COUNT_FILE);
    fs.writeFileSync(waPath, JSON.stringify({ waCount: 0, raCount: 0, totalTaskCalls: 0, lastResetAt: new Date().toISOString(), resetReason: 'ticketing-skill' }, null, 2));
  } catch (e) { /* fail-open */ }
}

/**
 * Classify an Agent hook invocation as WA or RA.
 * Conservative: anything that is not clearly an RA is classified as WA.
 * Returns 'WA', 'RA', or null (if not an Agent tool call).
 */
function classifyAgent(hookData) {
  if (hookData.tool_name !== 'Agent') return null;
  const input = hookData.tool_input || {};
  const text = ((input.prompt || '') + ' ' + (input.description || '')).toLowerCase();
  const RA_PATTERNS = /\b(review agent|verification|verify|reviewer)\b/;
  if (RA_PATTERNS.test(text)) return 'RA';
  return 'WA'; // default = WA (conservative)
}

async function check() {
  const hookData = await readStdin();
  // CLAUDE_PROJECT_DIR (set by Claude Code) is the authoritative project root.
  // Do NOT use hookData.cwd — it changes when Bash cd's to subdirectories.
  const sessionId = hookData.session_id || null;
  const sessionId8 = sessionId ? sessionId.substring(0, 8) : null;

  const memoryDir = path.join(getStorageRoot(), MEMORY_DIR);
  ensureDir(memoryDir);
  const locked = acquireIndexLock(memoryDir);
  if (!locked) {
    // Another process holds the lock — skip this cycle (fail-open).
    return;
  }
  try {
    // Regressing: auto-advance phase on skill invocation
    try {
      const detectedSkill = detectRegressingSkillCall(hookData);
      if (detectedSkill) {
        const projectDir = getProjectDir();
        const newPhase = advancePhase(detectedSkill, projectDir);
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

    let counter = getCounter();
    counter++;
    setCounter(counter);

    // Pressure reset on Task delegation
    if (hookData.tool_name === 'TaskCreate') {
      try {
        const idxPath = path.join(getStorageRoot(), MEMORY_DIR, 'memory-index.json');
        const idx = readIndexSafe(idxPath);
        if (idx.feedbackPressure && idx.feedbackPressure.level > 0) {
          idx.feedbackPressure.level = 0;
          idx.feedbackPressure.consecutiveCount = 0;
          idx.feedbackPressure.decayCounter = 0;
          writeJson(idxPath, idx);
          console.error('[PRESSURE RESET] Task delegation detected — pressure reset to L0');
        }
      } catch (e) { /* fail-open */ }
    }

    // WA count tracking on Agent tool (subagent launch)
    if (hookData.tool_name === 'Agent') {
      try {
        const agentType = classifyAgent(hookData);
        const projectDir = getProjectDir();
        const waPath = path.join(getStorageRoot(projectDir), MEMORY_DIR, WA_COUNT_FILE);
        const waData = readJsonOrDefault(waPath, { waCount: 0, raCount: 0, totalTaskCalls: 0 });
        waData.totalTaskCalls++;
        if (agentType === 'WA') waData.waCount++;
        else if (agentType === 'RA') waData.raCount++;
        fs.writeFileSync(waPath, JSON.stringify(waData, null, 2));
      } catch (e) { /* fail-open */ }
    }

    // Ticketing reset: when ticketing skill is invoked, reset wa-count.json
    if (hookData.tool_name === 'Skill') {
      const input = hookData.tool_input || {};
      const skillName = (typeof input.skill === 'string') ? input.skill.split(':').pop() : '';
      if (skillName === 'ticketing') {
        resetWaCount();
      }
    }

    // Check rotation before auto-save
    const memoryPath = path.join(getStorageRoot(), MEMORY_DIR, MEMORY_FILE);
    const rotationResult = checkAndRotate(memoryPath, config);
    if (rotationResult) {
      console.log(rotationResult.hookOutput);
    }

    if (counter >= interval) {
      const indexPath = path.join(getStorageRoot(), MEMORY_DIR, 'memory-index.json');
      const sessionsDir = path.join(getStorageRoot(), SESSIONS_DIR);

      // Step 1: Create/update L1 from current transcript
      // Prefer transcript_path from hookData, fallback to findTranscriptPath()
      const transcriptPath = (hookData.transcript_path && hookData.transcript_path !== '')
        ? hookData.transcript_path
        : findTranscriptPath();

      if (transcriptPath) {
        try {
          const transcriptMtime = fs.statSync(transcriptPath).mtimeMs;
          const idx = readIndexSafe(indexPath);
          // Only create L1 if transcript changed since last L1 creation
          if (!idx.lastL1TranscriptMtime || transcriptMtime > idx.lastL1TranscriptMtime) {
            ensureDir(sessionsDir);

            // Find existing L1 for this session to append to (offset mode),
            // or create new L1 (fresh session / no existing L1)
            let l1Dest;
            let startOffset = 0;
            if (sessionId8) {
              const existingL1 = fs.readdirSync(sessionsDir)
                .filter(f => f.endsWith('.l1.jsonl') && f.includes(`_${sessionId8}`))
                .sort().reverse()[0]; // newest first
              if (existingL1) {
                l1Dest = path.join(sessionsDir, existingL1);
                startOffset = idx.lastL1TranscriptOffset || 0;
              }
            }
            if (!l1Dest) {
              // New session or no sessionId — create fresh L1
              const ts = getTimestamp();
              const l1Name = sessionId8 ? `${ts}_${sessionId8}.l1.jsonl` : `${ts}.l1.jsonl`;
              l1Dest = path.join(sessionsDir, l1Name);
              startOffset = 0;
            }

            const result = refineRawSync(transcriptPath, l1Dest, startOffset);
            cleanupDuplicateL1(l1Dest);
            idx.lastL1TranscriptMtime = transcriptMtime;
            // Update offset for next incremental read
            if (result && typeof result === 'object' && result.newOffset !== undefined) {
              idx.lastL1TranscriptOffset = result.newOffset;
            } else {
              idx.lastL1TranscriptOffset = fs.statSync(transcriptPath).size;
            }
            writeJson(indexPath, idx);
          }
        } catch (e) {
          fs.appendFileSync(path.join(getLogsDir(), 'error.log'),
            `${new Date().toISOString()}: check() L1 creation failed: ${e.message}\n`);
        }
      }

      // Step 2: Try delta extraction (pass sessionId for session-aware L1 selection)
      const deltaResult = extractDelta(sessionId8);

      if (deltaResult.success) {
        // Set deltaReady flag so inject-rules.js knows this is a legitimate delta
        const index = readIndexSafe(indexPath);
        index.deltaReady = true;
        writeJson(indexPath, index);
        setCounter(0);
      } else {
        // No delta available - just reset counter
        setCounter(0);
      }
    }
  } finally {
    if (locked) releaseIndexLock(memoryDir);
  }
}

async function final() {
  const hookData = await readStdin();
  // CLAUDE_PROJECT_DIR (set by Claude Code) is the authoritative project root.
  const sessionId = hookData.session_id || null;
  const sessionId8 = sessionId ? sessionId.substring(0, 8) : null;
  const projectDir = getProjectDir().replace(/\\/g, '/');
  const timestamp = getTimestamp();
  const sessionsDir = path.join(getStorageRoot(), SESSIONS_DIR);

  ensureDir(sessionsDir);

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

  // Find transcript: stdin transcript_path > session_id lookup > project-name fallback
  let transcriptSrc = null;
  if (hookData.transcript_path && hookData.transcript_path !== '') {
    transcriptSrc = hookData.transcript_path;
  } else if (hookData.session_id) {
    // Try session_id lookup
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    try {
      if (fs.existsSync(claudeProjectsDir)) {
        const projects = fs.readdirSync(claudeProjectsDir);
        for (const proj of projects) {
          const transcriptFile = path.join(claudeProjectsDir, proj, `${hookData.session_id}.jsonl`);
          if (fs.existsSync(transcriptFile)) {
            transcriptSrc = transcriptFile;
            break;
          }
        }
      }
    } catch (e) {
      fs.appendFileSync(path.join(getLogsDir(), 'error.log'),
        `${timestamp}: Failed to find transcript by session_id: ${e.message}\n`);
    }
  }
  // Final fallback: project-name search
  if (!transcriptSrc) {
    transcriptSrc = findTranscriptPath();
  }

  // Copy raw transcript
  let rawSaved = '';
  if (transcriptSrc) {
    try {
      const rawBase = sessionId8 ? `${timestamp}_${sessionId8}` : timestamp;
      const rawDest = path.join(sessionsDir, `${rawBase}.raw.jsonl`);
      fs.copyFileSync(transcriptSrc, rawDest);
      rawSaved = rawDest.replace(/\\/g, '/');
    } catch (e) {
      fs.appendFileSync(path.join(getLogsDir(), 'error.log'),
        `${timestamp}: Failed to copy transcript: ${e.message}\n`);
    }
  }

  // Create L1 refined version
  if (rawSaved) {
    try {
      const l1Dest = rawSaved.replace('.raw.jsonl', '.l1.jsonl');
      const lineCount = await refineRaw(rawSaved, l1Dest);
      // Log stats
      const rawSize = fs.statSync(rawSaved).size;
      const l1Size = fs.statSync(l1Dest).size;
      const reduction = ((1 - l1Size / rawSize) * 100).toFixed(1);
      fs.appendFileSync(path.join(logsDir, 'refine.log'),
        `${timestamp}: ${lineCount} lines, ${rawSize}→${l1Size} bytes (${reduction}% reduction)\n`);

      // Remove duplicate L1 files from same session
      cleanupDuplicateL1(l1Dest);

      // Delete raw file unless keepRaw is enabled
      const config = getConfig();
      if (!config.keepRaw) {
        fs.unlinkSync(rawSaved);
        rawSaved = ''; // Clear so instructions don't show deleted file
      }
    } catch (e) {
      fs.appendFileSync(path.join(getLogsDir(), 'error.log'),
        `${timestamp}: Failed to create L1: ${e.message}\n`);
    }
  }

  const scriptPath = process.argv[1].replace(/\\/g, '/');
  const nodePath = process.execPath.replace(/\\/g, '/');
  const config = getConfig();

  // Prune old L1 files (>30 days) — after L1 creation, before delta extraction
  // Must run before delta so extractDelta never selects a stale file
  try {
    pruneOldL1();
  } catch (e) {
    fs.appendFileSync(path.join(logsDir, 'error.log'),
      `${timestamp}: Failed to prune old L1 files: ${e.message}\n`);
  }

  // Process any remaining delta before session ends (pass sessionId for isolation)
  const deltaResult = extractDelta(sessionId8);
  let deltaOutput = '';
  // Clear offset + set deltaReady inside lock
  {
    const idxPath = path.join(getStorageRoot(), MEMORY_DIR, 'memory-index.json');
    const finalMemoryDir = path.join(getStorageRoot(), MEMORY_DIR);
    const finalLocked = acquireIndexLock(finalMemoryDir);
    try {
      const idx = readIndexSafe(idxPath);
      // Reset offset — final() creates definitive L1 from scratch, next session starts fresh
      delete idx.lastL1TranscriptOffset;
      delete idx.lastL1TranscriptMtime;
      if (deltaResult.success) {
        idx.deltaReady = true;
      }
      writeJson(idxPath, idx);
    } finally {
      if (finalLocked) releaseIndexLock(finalMemoryDir);
    }
  }
  if (deltaResult.success) {
    deltaOutput = `\n[CRABSHELL_DELTA] file=${deltaResult.deltaFile}\nDelta extracted at session end: ${deltaResult.entryCount} entries.`;
  }

  // Quiet mode by default - only show brief message
  if (config.quietStop !== false) {
    let systemMsg = `[CRABSHELL_SAVE] Session saved. L1: ${rawSaved ? 'OK' : 'SKIP'}`;
    if (deltaOutput) {
      systemMsg += deltaOutput;
    }
    const output = {
      systemMessage: systemMsg
    };
    console.log(JSON.stringify(output));
    setCounter(0);
    return;
  }

  const instructions = `
═══════════════════════════════════════════════════════════════
[CRABSHELL_SAVE] SESSION ENDING - Final Save Required
═══════════════════════════════════════════════════════════════

${rawSaved ? `✓ Raw transcript saved: ${rawSaved}` : '⚠ Raw transcript not saved'}

**APPEND complete summary to logbook.md:**
\`\`\`bash
printf '\\n## %s (Session End)\\n%s\\n' "${timestamp}" "[Complete session summary - be thorough]" >> "${projectDir}/.crabshell/memory/logbook.md"
\`\`\`

**RUN compression:**
\`\`\`bash
"${nodePath}" "${scriptPath}" compress
\`\`\`

═══════════════════════════════════════════════════════════════`;

  const output = {
    systemMessage: instructions
  };
  console.log(JSON.stringify(output));

  setCounter(0);
}

function reset() {
  setCounter(0);
  console.log('[CRABSHELL] Counter reset.');
}

// Remove duplicate L1 files from same session (keep only the largest/latest)
function cleanupDuplicateL1(newL1Path) {
  const sessionsDir = path.dirname(newL1Path);
  const newL1Content = fs.readFileSync(newL1Path, 'utf8');
  const newL1FirstLine = newL1Content.split('\n')[0];

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
    const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];

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
function pruneOldL1() {
  const sessionsDir = path.join(getStorageRoot(), SESSIONS_DIR);
  if (!fs.existsSync(sessionsDir)) return 0;

  const now = new Date();
  const l1Files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl'));
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

    // Calendar days comparison matching compress() — >30 days means 31+
    const daysOld = Math.floor((now - fileDate) / (1000 * 60 * 60 * 24));
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
      const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
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
      const daysOld = Math.floor((now - fileDate) / (1000 * 60 * 60 * 24));

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
  project: { file: 'project.md', title: 'Project Overview' }
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
  const memDir = path.join(getStorageRoot(projectDir), 'memory');
  ensureDir(memDir);
  const filePath = path.join(memDir, memConfig.file);

  writeFile(filePath, content);
  console.log(`[CRABSHELL] Saved ${memConfig.title} to .crabshell/memory/${memConfig.file}`);
}

function memoryGet(name) {
  const projectDir = getProjectDir();

  if (!name) {
    // Show all memory files
    console.log('[CRABSHELL] Memory Files:');
    const memDir = path.join(getStorageRoot(projectDir), 'memory');
    Object.entries(MEMORY_FILES).forEach(([key, config]) => {
      const filePath = path.join(memDir, config.file);
      if (fs.existsSync(filePath)) {
        const content = readFileOrDefault(filePath, '').trim();
        const lines = content.split('\n').length;
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

  const memDir = path.join(getStorageRoot(projectDir), 'memory');
  const filePath = path.join(memDir, memConfig.file);
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
  const memDir = path.join(getStorageRoot(projectDir), 'memory');
  console.log('[CRABSHELL] Memory Structure:');

  let total = 0;
  Object.entries(MEMORY_FILES).forEach(([key, config]) => {
    const filePath = path.join(memDir, config.file);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const content = readFileOrDefault(filePath, '');
      const lines = content.trim().split('\n').length;
      console.log(`  ✓ ${config.file} (${lines} lines, ${stats.size} bytes)`);
      total++;
    } else {
      console.log(`  ○ ${config.file} - not created`);
    }
  });

  // Also show logbook.md (rolling)
  const memoryPath = path.join(getStorageRoot(projectDir), MEMORY_DIR, MEMORY_FILE);
  if (fs.existsSync(memoryPath)) {
    const stats = fs.statSync(memoryPath);
    const content = readFileOrDefault(memoryPath, '');
    const lines = content.trim().split('\n').length;
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
      console.error(`[CRABSHELL] Final error: ${e.message}`);
      process.exit(1);
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
  module.exports = { getCounter, setCounter, getConfig, cleanupDuplicateL1, dedupeL1, parseArg, compress, pruneOldL1, classifyAgent, resetWaCount };
}
