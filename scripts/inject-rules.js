// scripts/inject-rules.js
const fs = require('fs');
const path = require('path');

const RULES = `
## CRITICAL RULES (auto-injected every prompt)
- NEVER delete files without explicit user permission. REPORT first, ASK permission.
- Think objectively. Don't just agree with user - verify claims independently.
- Don't assume, verify. Check the specified method first, even if you think you know a better way.
- When you make a mistake, don't apologize. Explain your actual reasoning process.
- If you don't know or want a better approach, search the internet.
`;

const DELTA_INSTRUCTION = `
## MEMORY KEEPER DELTA INSTRUCTION
INSTRUCTION: A delta file is pending. You MUST execute the memory-delta skill NOW.

Steps:
1. Use the Skill tool: skill="memory-delta"
2. The skill will guide you through: read delta -> summarize -> append to memory.md -> cleanup

DO NOT skip this. DO NOT delay. Execute immediately before responding to user.
`;

const ROTATION_INSTRUCTION = `
## MEMORY KEEPER ROTATION INSTRUCTION
INSTRUCTION: Rotation summaries pending. Execute memory-rotate skill NOW.

Steps:
1. Use the Skill tool: skill="memory-rotate"
2. The skill will trigger Haiku to generate L3 summary

Execute after delta processing (if any). DO NOT skip.
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

function main() {
  try {
    const projectDir = getProjectDir();
    const configPath = path.join(projectDir, '.claude', 'memory', 'config.json');
    const config = readJsonSafe(configPath, {});

    const frequency = config.rulesInjectionFrequency || 1;

    // Counter stored in memory-index.json
    const indexPath = path.join(projectDir, '.claude', 'memory', 'memory-index.json');
    const index = readJsonSafe(indexPath, {});

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
      if (indicators.length > 0) {
        console.error(`[rules + ${indicators.join(' + ')} pending]`);
      } else {
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
