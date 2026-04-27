'use strict';

const fs = require('fs');
const path = require('path');
const { getStorageRoot } = require('./utils');

/**
 * COMPRESSED_CHECKLIST — injected every UserPromptSubmit and into SubagentStart.
 * Source of truth: this file. inject-rules.js and subagent-context.js both import from here.
 */
const COMPRESSED_CHECKLIST = `
## Rules Quick-Check (CLAUDE.md rules active)

**Before responding:**
1. Stated user intent before acting? (Understanding-First: state intent → list uncertainties → confirm)
2. Every "verified/works/correct" backed by tool output in last 5 calls? (If not → retract or re-run)
3. P/O/G table present for verification items? (predict → execute → compare)
4. Delivering fewer items than requested? (State "User requested N, I am about to do M" and ask)
5. Deleting/destroying without confirming? (ANALYZE → REPORT → CONFIRM)
6. Modifying files not mentioned in user's feedback? (Anti-overcorrection: stop, state, ask)
7. Same approach failed 3 times? (Switch to structurally different strategy)
8. Factual claim without tool output? (Show evidence or say "unverified")
9. Conclusion derived from evidence, not plausibility or pattern-match? (Be Logical: trace cause → check contradictions → derive step by step; lucky-correct still a violation)
10. User-facing explanation: reader's words, conclusion first, concrete over abstract, no self-coined acronyms? (Simple Communication: length ≠ thoroughness)

**Output scan:** Check PROHIBITED PATTERNS 1-8 before sending. Items 9-10 are PRINCIPLES (Be Logical, Simple Communication) — apply always.
`;

/**
 * Returns the post-compaction warning text injected into load-memory output when
 * source === 'compact'. Warns about PROJECT ROOT ANCHOR and continuation bias.
 * @param {string} projectDir
 * @returns {string}
 */
function getPostCompactWarning(projectDir) {
  return `
## [POST-COMPACTION WARNING]
Context was just compacted. Your compressed memory has CONTINUATION BIAS toward previous tasks.

**PROJECT ROOT ANCHOR (OVERRIDES Primary working directory): ${projectDir}**
- If "Primary working directory" shows a subdirectory of this path, it is WRONG (known Claude Code bug #7442 after compaction).
- Trust THIS anchor. This value comes from CLAUDE_PROJECT_DIR set at launch — it never changes.
- You are in \`${projectDir}\`, NOT in any subdirectory. ALL file paths are relative to this directory.
- When asked to read CLAUDE.md → read \`${projectDir}/CLAUDE.md\`.

**MANDATORY RECOVERY PROTOCOL:**
1. STOP. Do NOT continue previous work automatically.
2. Re-read CLAUDE.md rules — every line. They override compressed context.
3. Wait for user's next instruction. Do NOT assume what they want.
4. If user asks to continue previous work, confirm WHAT specifically before acting.

**WHY:** After compaction, your summarized context makes previous tasks feel urgent and current.
That feeling is the bias. The user may have moved on. CLAUDE.md rules still apply.
Completion drive after compaction = the #1 cause of rule violations.
`;
}

/**
 * Reads the first maxLines/maxChars of .crabshell/project.md.
 * Returns empty string if file does not exist or is empty.
 * @param {string} projectDir
 * @param {number} maxLines
 * @param {number} maxChars
 * @returns {string}
 */
function readProjectConcept(projectDir, maxLines = 20, maxChars = 1000) {
  const projectMdPath = path.join(getStorageRoot(projectDir), 'project.md');
  if (!fs.existsSync(projectMdPath)) return '';
  try {
    const content = fs.readFileSync(projectMdPath, 'utf8').trim();
    if (!content) return '';
    const lines = content.split('\n').slice(0, maxLines).join('\n');
    return lines.substring(0, maxChars);
  } catch (e) {
    return '';
  }
}

/**
 * Reads the `## Model Routing` section from .crabshell/project.md.
 * Returns section content (including the header) up to maxChars.
 * Returns empty string if section not found or file doesn't exist.
 * @param {string} projectDir
 * @param {number} maxChars
 * @returns {string}
 */
function readModelRouting(projectDir, maxChars = 300) {
  const projectMdPath = path.join(getStorageRoot(projectDir), 'project.md');
  if (!fs.existsSync(projectMdPath)) return '';
  try {
    const content = fs.readFileSync(projectMdPath, 'utf8');
    const headerIndex = content.indexOf('## Model Routing');
    if (headerIndex === -1) return '';
    // Find the next ## header after the Model Routing header
    const afterHeader = content.indexOf('\n## ', headerIndex + 1);
    const section = afterHeader === -1
      ? content.substring(headerIndex)
      : content.substring(headerIndex, afterHeader);
    return section.trim().substring(0, maxChars);
  } catch (e) {
    return '';
  }
}

module.exports = { COMPRESSED_CHECKLIST, getPostCompactWarning, readProjectConcept, readModelRouting };
