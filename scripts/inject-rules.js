// scripts/inject-rules.js
const fs = require('fs');
const path = require('path');
const os = require('os');

// Context estimation settings
const CONTEXT_LIMIT = 200000;  // 200k tokens
const WARNING_THRESHOLD = 0.80;  // 80%
const CRITICAL_THRESHOLD = 0.90;  // 90%

const RULES = `
## CRITICAL RULES (auto-injected every prompt)
- NEVER delete files without explicit user permission. REPORT first, ASK permission.
- Think objectively. Don't just agree with user - verify claims independently.
- Don't assume, verify. Check the specified method first, even if you think you know a better way.
- Don't cut corners. Do it properly, verify from actual sources, not summaries.
- When you make a mistake, don't apologize. Explain your actual reasoning process.
- If you don't know or want a better approach, search the internet.
`;

const DELTA_INSTRUCTION = `
## BLOCKING PREREQUISITE - EXECUTE FIRST

STOP. Before generating ANY text response to the user:

1. Use the Skill tool: skill="memory-delta"
2. Complete all steps in the skill
3. THEN respond to user

This is a SYSTEM MAINTENANCE TASK that BLOCKS user response.
You CANNOT skip this. You CANNOT respond first.
Your response to the user is INVALID until delta processing completes.
`;

const ROTATION_INSTRUCTION = `
## BLOCKING PREREQUISITE - ROTATION REQUIRED

After delta processing (if any), before responding to user:

1. Use the Skill tool: skill="memory-rotate"
2. Complete all steps in the skill
3. THEN respond to user

This is a SYSTEM MAINTENANCE TASK. You CANNOT skip this.
`;

function getProjectDir() {
  // Same logic as utils.js - find project root by .claude folder
  if (process.env.PROJECT_DIR) return process.env.PROJECT_DIR;
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.claude'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function readJsonSafe(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {}
  return defaultValue;
}

// Safe index reader - ALWAYS returns complete structure, preserving existing values
function readIndexSafe(indexPath) {
  const defaults = {
    version: 1,
    current: 'memory.md',
    rotatedFiles: [],
    stats: { totalRotations: 0, lastRotation: null },
    counter: 0,
    lastMemoryUpdateTs: null
  };
  try {
    if (!fs.existsSync(indexPath)) return defaults;
    const existing = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return {
      version: existing.version ?? defaults.version,
      current: existing.current ?? defaults.current,
      rotatedFiles: Array.isArray(existing.rotatedFiles) ? existing.rotatedFiles : defaults.rotatedFiles,
      stats: existing.stats ?? defaults.stats,
      counter: existing.counter ?? defaults.counter,
      lastMemoryUpdateTs: existing.lastMemoryUpdateTs ?? defaults.lastMemoryUpdateTs,
      rulesInjectionCount: existing.rulesInjectionCount
    };
  } catch {
    return defaults;
  }
}

function checkDeltaPending(projectDir) {
  const deltaPath = path.join(projectDir, '.claude', 'memory', 'delta_temp.txt');
  const exists = fs.existsSync(deltaPath);
  // Debug: log to file for verification
  const logPath = path.join(projectDir, '.claude', 'memory', 'logs', 'inject-debug.log');
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} | cwd=${process.cwd()} | projectDir=${projectDir} | delta=${exists}\n`);
  } catch (e) {}
  return exists;
}

function checkRotationPending(projectDir) {
  const indexPath = path.join(projectDir, '.claude', 'memory', 'memory-index.json');
  const index = readJsonSafe(indexPath, {});
  const rotatedFiles = index.rotatedFiles || [];
  const pending = rotatedFiles.filter(f => !f.summaryGenerated);
  // Debug log
  const logPath = path.join(projectDir, '.claude', 'memory', 'logs', 'inject-debug.log');
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} | rotation pending=${pending.length}\n`);
  } catch (e) {}
  return pending;
}

// Find most recent JSONL transcript file
function findCurrentTranscript() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return null;

  let newest = null;
  let newestTime = 0;

  function scanDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.jsonl')) {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs > newestTime) {
            newestTime = stat.mtimeMs;
            newest = fullPath;
          }
        }
      }
    } catch (e) {}
  }

  scanDir(claudeDir);
  return newest;
}

// Estimate context usage from transcript
function estimateContextUsage(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;

  try {
    const content = fs.readFileSync(transcriptPath, 'utf8').trim();
    const lines = content.split('\n');

    // Find last assistant entry with usage info
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === 'assistant' && entry.message?.usage) {
          const u = entry.message.usage;
          const total = (u.input_tokens || 0) +
                        (u.cache_creation_input_tokens || 0) +
                        (u.cache_read_input_tokens || 0);
          const percent = total / CONTEXT_LIMIT;
          return { total, percent, percentStr: (percent * 100).toFixed(1) };
        }
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

function main() {
  try {
    const projectDir = getProjectDir();
    const configPath = path.join(projectDir, '.claude', 'memory', 'config.json');
    const config = readJsonSafe(configPath, {});

    const frequency = config.rulesInjectionFrequency || 1;

    // Counter stored in memory-index.json
    const indexPath = path.join(projectDir, '.claude', 'memory', 'memory-index.json');
    const index = readIndexSafe(indexPath);  // Use safe reader to preserve all fields

    let count = (index.rulesInjectionCount || 0) + 1;

    // Update counter if frequency > 1 (need to track)
    if (frequency > 1) {
      index.rulesInjectionCount = count;
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    }

    // Check if should inject
    if (count % frequency === 0 || frequency === 1) {
      // Check for pending delta
      const hasPendingDelta = checkDeltaPending(projectDir);

      // Check for pending rotation summaries
      const pendingRotations = checkRotationPending(projectDir);

      // Check context usage for auto-clear
      const transcriptPath = findCurrentTranscript();
      const contextUsage = estimateContextUsage(transcriptPath);
      let contextWarning = null;

      if (contextUsage) {
        if (contextUsage.percent >= CRITICAL_THRESHOLD) {
          // 90%+ - CRITICAL
          contextWarning = {
            level: 'CRITICAL',
            percent: contextUsage.percentStr,
            message: `[CRITICAL] Context ${contextUsage.percentStr}% - /clear 하세요!`
          };
        } else if (contextUsage.percent >= WARNING_THRESHOLD) {
          // 80%+ - WARNING
          contextWarning = {
            level: 'WARNING',
            percent: contextUsage.percentStr,
            message: `[MEMORY KEEPER] Context ${contextUsage.percentStr}% - /clear 권장`
          };
        }
      }

      // Build context: rules + optional instructions
      let context = RULES;
      if (hasPendingDelta) {
        context += DELTA_INSTRUCTION;
      }
      if (pendingRotations.length > 0) {
        context += ROTATION_INSTRUCTION;
        context += `\nFiles: ${pendingRotations.map(f => f.file).join(', ')}`;
      }

      // Output rules via additionalContext (hidden from user, seen by Claude)
      const output = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: context
        }
      };
      console.log(JSON.stringify(output));

      // Brief indicator to stderr (shown to user)
      const indicators = [];
      if (hasPendingDelta) indicators.push('delta');
      if (pendingRotations.length > 0) indicators.push('rotation');

      // Output context warning first if present (most important)
      if (contextWarning) {
        console.error(contextWarning.message);
      }

      if (indicators.length > 0) {
        console.error(`[rules + ${indicators.join(' + ')} pending]`);
      } else if (!contextWarning) {
        console.error('[rules injected]');
      }
    }
  } catch (e) {
    // On error, still try to inject rules (fail-safe)
    console.error('[rules injection error: ' + e.message + ']');

    // Output rules anyway to not break the workflow
    const output = {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: RULES
      }
    };
    console.log(JSON.stringify(output));
  }
}

main();
