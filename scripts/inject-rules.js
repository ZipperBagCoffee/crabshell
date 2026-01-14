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

function getProjectDir() {
  // Try common methods to find project dir
  if (process.env.CLAUDE_PROJECT_DIR) {
    return process.env.CLAUDE_PROJECT_DIR;
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
  // Debug: log to stderr (visible to user)
  console.error(`[DEBUG] projectDir=${projectDir}, deltaPath=${deltaPath}, exists=${exists}`);
  return exists;
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

      // Build context: rules + optional delta instruction
      let context = RULES;
      if (hasPendingDelta) {
        context += DELTA_INSTRUCTION;
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
      if (hasPendingDelta) {
        console.error('[rules injected + delta pending]');
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
