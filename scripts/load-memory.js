const path = require('path');
const fs = require('fs');
const { getProjectDir, getProjectName, getStorageRoot, readFileOrDefault, readJsonOrDefault, writeJson, estimateTokens, acquireIndexLock, releaseIndexLock } = require('./utils');
const { ensureMemoryStructure } = require('./init');
const { MEMORY_DIR, SESSIONS_DIR, INDEX_FILE, MEMORY_FILE, LOGS_DIR, DELTA_TEMP_FILE, REGRESSING_STATE_FILE, SKILL_ACTIVE_FILE } = require('./constants');
const { getPostCompactWarning: getPostCompactWarningShared } = require('./shared-context');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

// Legacy global hook registration removed in v19.43.0.
// Plugin hooks.json is the sole source of hook registration.
// See lesson: 2026-03-26_no-global-hooks-use-plugin.md
// HOOK_RUNNER_CODE removed in v19.43.0 — plugin hooks.json is sufficient

// ensureGlobalHooks() removed in v19.43.0 — was registering duplicate hooks in global settings.json

// Error logging for debugging SessionStart hook failures
function logError(err) {
  try {
    const projectDir = getProjectDir();
    const logDir = path.join(getStorageRoot(projectDir), LOGS_DIR || 'memory/logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'startup-error.log');
    fs.appendFileSync(logPath, `${new Date().toISOString()} | ${err.stack || err.message || err}\n`);
  } catch {}
}

process.on('uncaughtException', (err) => {
  logError(err);
  console.error('[CRABSHELL ERROR] ' + (err.message || err));
  process.exit(1);
});

// CRITICAL WARNING - Must be in SessionStart hook for Claude to see
const CLAUDE_RULES = `
## Crabshell Operational Notes
- When you make a mistake, explain your actual reasoning process — what logic led to that action. Do not apologize.
- memory-index.json format: see scripts/init.js in plugin directory.

## Memory Timestamp Format
Session headers use: \`## YYYY-MM-DD_HHMM (local MM-DD_HHMM)\`
- First timestamp: UTC time (primary reference)
- Second timestamp: User's local time (for context)
- Example: \`## 2026-02-01_1727 (local 02-01_0927)\` = UTC 17:27, local 09:27
- HTML/CSS design: avoid AI slop patterns (purple gradients, 3-col icon grids, centered-everything, uniform border-radius, generic hero copy, decorative blobs). Ref: gstack 10-pattern blacklist.
- Coding: externalize values into constants, config objects, or environment variables instead of hardcoding.
`;

const MEMORY_FILES = [
  { name: 'project.md', title: 'Project Overview' }
];

const MEMORY_MD_WARNING = `## Crabshell Plugin
- This MEMORY.md = Claude Code built-in auto memory (200-line limit, auto-loaded in system prompt)
- .crabshell/memory/logbook.md = Crabshell plugin memory (25K token rotation, loaded via hooks)
- These are SEPARATE systems. Do NOT apply 200-line limit to plugin logbook.md
- Do NOT confuse rotation/archival rules between them`;

function ensureAutoMemoryWarning(projectDir) {
  try {
    const os = require('os');
    const home = os.homedir();
    const sanitized = projectDir.replace(/[^a-zA-Z0-9-]/g, '-');
    const memoryMdPath = path.join(home, '.claude', 'projects', sanitized, 'memory', 'MEMORY.md');

    if (fs.existsSync(memoryMdPath)) {
      const content = fs.readFileSync(memoryMdPath, 'utf8');
      if (content.includes('Crabshell Plugin')) return;
      fs.writeFileSync(memoryMdPath, MEMORY_MD_WARNING + '\n\n' + content);
    } else {
      fs.mkdirSync(path.dirname(memoryMdPath), { recursive: true });
      fs.writeFileSync(memoryMdPath, MEMORY_MD_WARNING + '\n');
    }
  } catch (e) {
    // Silently fail - don't break SessionStart
  }
}

const getPostCompactWarning = getPostCompactWarningShared;

const { readStdin: readStdinShared } = require('./transcript-utils');

const MEMORY_TAIL_LINES = 50;

// Use shared readStdin with 3000ms timeout for SessionStart hook
function readStdinAsync() {
  return readStdinShared(3000);
}

function loadMemory(stdinData) {
  const projectDir = getProjectDir();
  const projectName = getProjectName();
  const memoryDir = path.join(getStorageRoot(projectDir), MEMORY_DIR);
  const sections = [];
  const source = (stdinData && stdinData.source) || 'unknown';

  // Ensure memory structure exists
  ensureMemoryStructure(projectDir);

  // Conditional delta_temp.txt handling on SessionStart:
  // - deltaReady=true → preserve (unprocessed delta from previous session, will be consumed)
  // - deltaReady!=true → stale file, delete to prevent ghost triggers
  const deltaPath = path.join(memoryDir, DELTA_TEMP_FILE);
  if (fs.existsSync(deltaPath)) {
    const indexPath = path.join(memoryDir, INDEX_FILE);
    const idx = readJsonOrDefault(indexPath, {});
    if (idx.deltaReady !== true) {
      try { fs.unlinkSync(deltaPath); } catch {}
    }
  }

  // Clean up stale skill-active.json on SessionStart
  // Previous session's flag should never persist — always start fresh
  const skillActivePath = path.join(memoryDir, SKILL_ACTIVE_FILE);
  if (fs.existsSync(skillActivePath)) {
    try { fs.unlinkSync(skillActivePath); } catch {}
  }

  // SessionStart pressure decay — decay to level 1 (not reset to 0)
  // Level 1 persists so agent stays alert; only normal-prompt decay (in-session) goes below 1
  const pressureIndexPath = path.join(memoryDir, INDEX_FILE);
  const pressureIndex = readJsonOrDefault(pressureIndexPath, {});
  if (pressureIndex.feedbackPressure && pressureIndex.feedbackPressure.level > 1) {
    pressureIndex.feedbackPressure.level = 1;
    pressureIndex.feedbackPressure.consecutiveCount = Math.min(1, pressureIndex.feedbackPressure.consecutiveCount);
    pressureIndex.feedbackPressure.decayCounter = 0;
    const pressureLocked = acquireIndexLock(memoryDir);
    try {
      writeJson(pressureIndexPath, pressureIndex);
      console.error(`[CRABSHELL] Pressure decayed to L${pressureIndex.feedbackPressure.level} on session start`);
    } catch {} finally {
      if (pressureLocked) releaseIndexLock(memoryDir);
    }
  }

  // Check for stale regressing state
  const regressingStatePath = path.join(memoryDir, REGRESSING_STATE_FILE);
  const regressingState = readJsonOrDefault(regressingStatePath, null);
  if (regressingState && regressingState.active === true && regressingState.lastUpdatedAt) {
    const updatedTime = new Date(regressingState.lastUpdatedAt).getTime();
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (!isNaN(updatedTime) && (now - updatedTime) > twentyFourHours) {
      console.error(`[CRABSHELL] WARNING: Regressing state is stale (last updated: ${regressingState.lastUpdatedAt}). Verify with user before continuing.`);
    }
  }

  // Ensure MEMORY.md warning (Claude Code built-in vs plugin distinction)
  ensureAutoMemoryWarning(projectDir);

  // Load hierarchical memory files
  MEMORY_FILES.forEach(({ name, title }) => {
    const filePath = path.join(memoryDir, name);
    if (fs.existsSync(filePath)) {
      const content = readFileOrDefault(filePath, '').trim();
      if (content) sections.push('## ' + title + '\n' + content);
    }
  });

  // Load L3 summaries from index
  const indexPath = path.join(memoryDir, INDEX_FILE);
  const index = readJsonOrDefault(indexPath, null);
  const rotatedFiles = (index && Array.isArray(index.rotatedFiles)) ? index.rotatedFiles : [];

  if (rotatedFiles.length > 0) {
    // Check for pending summaries
    const pending = rotatedFiles.filter(f => !f.summaryGenerated);
    if (pending.length > 0) {
      console.log('[CRABSHELL] ' + pending.length + ' summaries pending:');
      pending.forEach(f => console.log('  - ' + f.file));
    }

    // Load most recent L3 summary
    const generated = rotatedFiles.filter(f => f.summaryGenerated);
    if (generated.length > 0) {
      const latest = generated[generated.length - 1];
      const summaryPath = path.join(memoryDir, latest.summary);
      if (fs.existsSync(summaryPath)) {
        const summary = readJsonOrDefault(summaryPath, null);
        if (summary && summary.overallSummary) {
          sections.push('## Previous Memory Summary\n' + summary.overallSummary);
        }
      }
    }
  }

  // Load L1 tail (unreflected content from last session)
  const sessionsDir = path.join(getStorageRoot(projectDir), SESSIONS_DIR);
  if (fs.existsSync(sessionsDir)) {
    const l1Files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl')).sort().reverse();
    if (l1Files.length > 0) {
      const memoryPath = path.join(memoryDir, MEMORY_FILE);
      const memoryContent = fs.existsSync(memoryPath) ? readFileOrDefault(memoryPath, '') : '';
      const unreflected = getUnreflectedL1Content(path.join(sessionsDir, l1Files[0]), memoryContent);
      if (unreflected) {
        sections.push('## Unreflected from Last Session\n' + unreflected.join('\n'));
      }
    }
  }

  // Load rolling memory (last N lines)
  const memoryPath = path.join(memoryDir, MEMORY_FILE);
  if (fs.existsSync(memoryPath)) {
    const content = readFileOrDefault(memoryPath, '');
    const lines = content.split('\n');
    if (lines.length > MEMORY_TAIL_LINES) {
      const tail = lines.slice(-MEMORY_TAIL_LINES).join('\n');
      sections.push('## Recent Sessions (last ' + MEMORY_TAIL_LINES + ' lines)\n' + tail);
    } else if (content.trim()) {
      sections.push('## Recent Sessions\n' + content);
    }
  }

  // Output
  if (sections.length > 0) {
    console.log('\n=== Crabshell: ' + projectName + ' ===\n');
    if (source === 'compact') {
      console.log(getPostCompactWarning(projectDir));
    }
    console.log(sections.join('\n\n---\n\n'));
    console.log(CLAUDE_RULES);
    console.log('\n=== End of Memory ===\n');
  } else {
    console.log('\n--- Crabshell: No memory for ' + projectName + ' ---\n');
    if (source === 'compact') {
      console.log(getPostCompactWarning(projectDir));
    }
    console.log(CLAUDE_RULES);
  }

  // Log source for debugging
  if (source === 'compact') {
    console.error('[CRABSHELL] Post-compaction recovery mode activated');
  }
}

function getUnreflectedL1Content(l1Path, memoryContent) {
  try {
    const content = fs.readFileSync(l1Path, 'utf8');
    const lines = content.split('\n').filter(l => l.trim()).slice(-20);
    const summary = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role === 'assistant' && entry.content) {
          const text = typeof entry.content === 'string' ? entry.content : entry.content.map(c => c.text || '').join('');
          if (text.length > 50 && !memoryContent.includes(text.substring(0, 50))) {
            summary.push(text.substring(0, 200));
          }
        }
      } catch {}
    }
    return summary.length > 0 ? summary : null;
  } catch { return null; }
}

// Support --project-dir=PATH for Bash tool invocations where CLAUDE_PROJECT_DIR is not set
const pdIdx = process.argv.findIndex(a => a.startsWith('--project-dir='));
if (pdIdx >= 0) {
  process.env.CLAUDE_PROJECT_DIR = process.argv[pdIdx].slice('--project-dir='.length);
  process.argv.splice(pdIdx, 1);
}

readStdinAsync().then((stdinData) => {
  // CLAUDE_PROJECT_DIR (set by Claude Code) is the authoritative project root.
  // Do NOT use stdinData.cwd — it changes when Bash cd's to subdirectories.
  try {
    loadMemory(stdinData);
  } catch (err) {
    logError(err);
    console.error('[CRABSHELL ERROR] ' + (err.message || err));
    process.exit(1);
  }
});
