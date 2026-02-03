// scripts/inject-rules.js
const fs = require('fs');
const path = require('path');

const RULES = `
## CRITICAL RULES (auto-injected every prompt)
- All actions must be based on understanding. If you can't explain your understanding of the system and the request, don't act.
- Before any action (except the date commands required for this rule): use \`date\` to check start time, think for at least 30 seconds, verify 30 seconds passed with \`date\` again.
- NEVER delete files without demonstrating understanding of the system and impact. REPORT your understanding first.
- Before ANY destructive/irreversible action: 1) ANALYZE situation first, 2) REPORT your understanding to user, 3) CONFIRM understanding is correct, 4) THEN execute.
- For complex tasks: CREATE a plan document BEFORE execution. Get user approval on the plan first.
- Think objectively. Don't just agree with user - verify claims independently.
- Don't assume, verify. Check the specified method first, even if you think you know a better way.
- Don't cut corners. Do it properly, verify from actual sources, not summaries.
- When criticized: 1) Pause, don't apologize or rush to act. 2) Explain what you understand about the criticism. 3) State what action you intend to take based on that understanding. 4) Ask to confirm your understanding is correct before acting.
- If you don't know or want a better approach, search the internet.
`;

const DELTA_INSTRUCTION = `
## [MEMORY_KEEPER_DELTA] - BLOCKING PREREQUISITE

**TRIGGER DETECTED: [MEMORY_KEEPER_DELTA] file=delta_temp.txt**

STOP. Before generating ANY text response to the user:

1. Invoke Skill tool NOW: skill="memory-delta"
2. Complete ALL steps in the skill (verify file, call Haiku, append to memory.md, mark-updated, cleanup)
3. ONLY THEN respond to user

This is a MANDATORY SYSTEM MAINTENANCE TASK.
- You CANNOT skip this
- You CANNOT respond to user first
- Your response is BLOCKED until delta processing completes

If you see this instruction, the delta file EXISTS and MUST be processed.
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
      rulesInjectionCount: existing.rulesInjectionCount,
      deltaCreatedAtMemoryMtime: existing.deltaCreatedAtMemoryMtime
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

// Auto-sync RULES to CLAUDE.md (only if changed)
function syncRulesToClaudeMd(projectDir) {
  try {
    const claudeMdPath = path.join(projectDir, 'CLAUDE.md');

    // Extract rule lines from RULES constant
    const ruleLines = RULES.split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('- '));

    // Build new section
    const newSection = `## Memory Keeper Plugin Rules

**CRITICAL: Read hook outputs carefully. Don't treat them as noise.**

${ruleLines.join('\n')}
- Hook outputs contain important instructions - follow them
`;

    // If CLAUDE.md doesn't exist, create it with the section
    if (!fs.existsSync(claudeMdPath)) {
      fs.writeFileSync(claudeMdPath, `# Project Notes\n\n${newSection}`);
      return;
    }

    const content = fs.readFileSync(claudeMdPath, 'utf8');

    // Find Memory Keeper Plugin Rules section
    const sectionStart = content.indexOf('## Memory Keeper Plugin Rules');

    // If section doesn't exist, append it
    if (sectionStart === -1) {
      fs.writeFileSync(claudeMdPath, content.trimEnd() + '\n\n' + newSection);
      return;
    }

    const afterSection = content.slice(sectionStart);
    const nextSection = afterSection.indexOf('\n## ', 1);
    const sectionEnd = nextSection === -1 ? content.length : sectionStart + nextSection;

    const currentSection = content.slice(sectionStart, sectionEnd);
    if (currentSection.trim() === newSection.trim()) return; // No change needed

    // Update file
    const newContent = content.slice(0, sectionStart) + newSection + content.slice(sectionEnd);
    fs.writeFileSync(claudeMdPath, newContent);
  } catch (e) {
    // Silently fail - don't break main workflow
  }
}

function main() {
  try {
    const projectDir = getProjectDir();

    // Auto-sync RULES to CLAUDE.md (runs once per session, only if changed)
    syncRulesToClaudeMd(projectDir);

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

      // Explicit trigger patterns to stderr (visible to Claude)
      if (hasPendingDelta) {
        console.error(`[MEMORY_KEEPER_DELTA] file=delta_temp.txt`);
      }
      if (pendingRotations.length > 0) {
        console.error(`[MEMORY_KEEPER_ROTATE] pending=${pendingRotations.length}`);
      }
      if (!hasPendingDelta && pendingRotations.length === 0) {
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
