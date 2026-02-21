const path = require('path');
const fs = require('fs');
const { getProjectDir, getProjectName, readFileOrDefault, readJsonOrDefault, estimateTokens } = require('./utils');
const { ensureMemoryStructure } = require('./init');
const { MEMORY_DIR, SESSIONS_DIR, INDEX_FILE, MEMORY_FILE, LOGS_DIR, DELTA_TEMP_FILE } = require('./constants');

// Workaround: Claude Code plugin hooks (PostToolUse, UserPromptSubmit) don't fire
// reliably from plugin hooks.json (GitHub issues #10225, #6305).
// Register them as user-level hooks in ~/.claude/settings.json instead.
function ensureGlobalHooks() {
  try {
    const os = require('os');
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const pluginRoot = path.resolve(__dirname, '..').replace(/\\/g, '/');
    const counterCmd = `node "${pluginRoot}/scripts/counter.js" check`;
    const injectCmd = `node "${pluginRoot}/scripts/inject-rules.js"`;

    let settings = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    if (!settings.hooks) settings.hooks = {};

    let modified = false;

    function ensureHook(eventName, matcher, command) {
      if (!settings.hooks[eventName]) settings.hooks[eventName] = [];
      const scriptName = command.includes('counter.js') ? 'counter.js' : 'inject-rules.js';
      const existingIdx = settings.hooks[eventName].findIndex(group =>
        (group.hooks || []).some(h => h.command && h.command.includes(scriptName))
      );
      const hookEntry = { matcher, hooks: [{ type: 'command', command }] };

      if (existingIdx >= 0) {
        const existing = settings.hooks[eventName][existingIdx];
        const existingCmd = existing.hooks && existing.hooks[0] && existing.hooks[0].command;
        if (existingCmd !== command) {
          settings.hooks[eventName][existingIdx] = hookEntry;
          modified = true;
        }
      } else {
        settings.hooks[eventName].push(hookEntry);
        modified = true;
      }
    }

    ensureHook('PostToolUse', '.*', counterCmd);
    ensureHook('UserPromptSubmit', '*', injectCmd);

    if (modified) {
      if (fs.existsSync(settingsPath)) {
        fs.copyFileSync(settingsPath, settingsPath + '.bak');
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.error('[MEMORY_KEEPER] Registered hooks in ~/.claude/settings.json (workaround for plugin hook bug). Review in /hooks menu.');
    }
  } catch (e) {
    // Silently fail - don't break SessionStart
  }
}

// Error logging for debugging SessionStart hook failures
function logError(err) {
  try {
    const projectDir = process.cwd();
    const logDir = path.join(projectDir, '.claude', LOGS_DIR || 'memory/logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'startup-error.log');
    fs.appendFileSync(logPath, `${new Date().toISOString()} | ${err.stack || err.message || err}\n`);
  } catch {}
}

process.on('uncaughtException', (err) => {
  logError(err);
  console.error('[MEMORY_KEEPER ERROR] ' + (err.message || err));
  process.exit(1);
});

// CRITICAL WARNING - Must be in SessionStart hook for Claude to see
const CLAUDE_RULES = `
## CRITICAL RULES FOR CLAUDE
- NEVER delete files without explicit user permission. REPORT first, ASK permission.
- Think objectively. Don't just agree with user - verify claims independently.
- Don't assume, verify. Even if you think you know a better way, check the specified method first.
- When you make a mistake, don't apologize. Explain your actual reasoning process - what logic led you to that action.
- If you don't know or want a better approach, search the internet.
- memory-index.json format: see scripts/init.js in plugin directory.

## Memory Timestamp Format
Session headers use: \`## YYYY-MM-DD_HHMM (local MM-DD_HHMM)\`
- First timestamp: UTC time (primary reference)
- Second timestamp: User's local time (for context)
- Example: \`## 2026-02-01_1727 (local 02-01_0927)\` = UTC 17:27, local 09:27
`;

const MEMORY_FILES = [
  { name: 'project.md', title: 'Project Overview' },
  { name: 'architecture.md', title: 'Architecture' },
  { name: 'conventions.md', title: 'Conventions' }
];

const MEMORY_MD_WARNING = `## Memory Keeper Plugin
- This MEMORY.md = Claude Code built-in auto memory (200-line limit, auto-loaded in system prompt)
- .claude/memory/memory.md = Memory Keeper plugin memory (25K token rotation, loaded via hooks)
- These are SEPARATE systems. Do NOT apply 200-line limit to plugin memory.md
- Do NOT confuse rotation/archival rules between them`;

function ensureAutoMemoryWarning(projectDir) {
  try {
    const os = require('os');
    const home = os.homedir();
    const sanitized = projectDir.replace(/[^a-zA-Z0-9-]/g, '-');
    const memoryMdPath = path.join(home, '.claude', 'projects', sanitized, 'memory', 'MEMORY.md');

    if (fs.existsSync(memoryMdPath)) {
      const content = fs.readFileSync(memoryMdPath, 'utf8');
      if (content.includes('Memory Keeper Plugin')) return;
      fs.writeFileSync(memoryMdPath, MEMORY_MD_WARNING + '\n\n' + content);
    } else {
      fs.mkdirSync(path.dirname(memoryMdPath), { recursive: true });
      fs.writeFileSync(memoryMdPath, MEMORY_MD_WARNING + '\n');
    }
  } catch (e) {
    // Silently fail - don't break SessionStart
  }
}

const POST_COMPACT_WARNING = `
## [POST-COMPACTION WARNING]
Context was just compacted. Your compressed memory has CONTINUATION BIAS toward previous tasks.

**MANDATORY RECOVERY PROTOCOL:**
1. STOP. Do NOT continue previous work automatically.
2. Re-read CLAUDE.md rules — every line. They override compressed context.
3. Wait for user's next instruction. Do NOT assume what they want.
4. If user asks to continue previous work, confirm WHAT specifically before acting.

**WHY:** After compaction, your summarized context makes previous tasks feel urgent and current.
That feeling is the bias. The user may have moved on. CLAUDE.md rules still apply.
Completion drive after compaction = the #1 cause of rule violations.
`;

const MEMORY_TAIL_LINES = 50;

function readStdinAsync() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(data.trim() ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    process.stdin.on('error', () => resolve({}));
    // Safety timeout - if stdin never closes, proceed without data
    setTimeout(() => resolve({}), 3000);
    process.stdin.resume();
  });
}

function loadMemory(stdinData) {
  const projectDir = getProjectDir();
  const projectName = getProjectName();
  const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
  const sections = [];
  const source = (stdinData && stdinData.source) || 'unknown';

  // Ensure memory structure exists
  ensureMemoryStructure(projectDir);

  // Workaround: register hooks as user-level hooks (plugin hooks bug)
  ensureGlobalHooks();

  // Clean up stale delta_temp.txt from previous session
  // Prevents delta instruction from firing on every prompt regardless of counter
  const deltaPath = path.join(memoryDir, DELTA_TEMP_FILE);
  if (fs.existsSync(deltaPath)) {
    try { fs.unlinkSync(deltaPath); } catch {}
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
      console.log('[MEMORY_KEEPER] ' + pending.length + ' summaries pending:');
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
  const sessionsDir = path.join(projectDir, '.claude', SESSIONS_DIR);
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
    console.log('\n=== Memory Keeper: ' + projectName + ' ===\n');
    if (source === 'compact') {
      console.log(POST_COMPACT_WARNING);
    }
    console.log(sections.join('\n\n---\n\n'));
    console.log(CLAUDE_RULES);
    console.log('\n=== End of Memory ===\n');
  } else {
    console.log('\n--- Memory Keeper: No memory for ' + projectName + ' ---\n');
    if (source === 'compact') {
      console.log(POST_COMPACT_WARNING);
    }
    console.log(CLAUDE_RULES);
  }

  // Log source for debugging
  if (source === 'compact') {
    console.error('[MEMORY_KEEPER] Post-compaction recovery mode activated');
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

readStdinAsync().then((stdinData) => {
  try {
    loadMemory(stdinData);
  } catch (err) {
    logError(err);
    console.error('[MEMORY_KEEPER ERROR] ' + (err.message || err));
    process.exit(1);
  }
});
