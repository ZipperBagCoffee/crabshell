'use strict';

const fs = require('fs');
const path = require('path');
const { getStorageRoot } = require('./utils');

/**
 * ORCHESTRATION_DEFAULTS — host-neutral working contract for the parent agent.
 * This is internal workflow state, not a response template.
 */
const ORCHESTRATION_DEFAULTS = `
### INTERNAL TASK CONTRACT
Before acting, derive and retain these fields from the user's actual words:
- original_request
- required_outcomes
- non_goals
- named_references
- allowed_changes
- forbidden_side_effects
- observable_success
- blocking_unknowns

Do not print this contract on every turn. Open named references before implementation and trace source input -> consuming path -> observable result. If blocking_unknowns is empty, resolve ordinary technical choices from the repository and continue without asking. Ask only when a wrong assumption would require a destructive or irreversible action, a write outside the authorized workspace, an external installation, or an undiscoverable product decision. A user correction overrides the earlier inference without discarding unaffected constraints.

The parent owns the original request, decisive references, final diff, direct execution evidence, and completion decision. A worker's done/PASS claim, reviewer count, marker, or spot-check is not completion evidence. Delegation and review are optional risk controls; use them for independent work or distinct high-risk concerns, not to satisfy a count.
`;

/**
 * WORKER_PROMPT_CONTRACT — minimum handoff and return contract for subagents.
 * Task-specific values still come from the parent's prompt.
 */
const WORKER_PROMPT_CONTRACT = `
## Worker Contract
The parent prompt must supply the relevant original-request sentence, exact task and non-goal, authoritative references to open, read/write scope, expected observation, and verification to run. Exploration and review are read-only unless an explicit write scope is provided. Do not fan out. Return only claim, evidence from direct observation, and remaining gap. The parent makes the completion decision.
`;

/**
 * COMPRESSED_CHECKLIST — injected every UserPromptSubmit and into SubagentStart.
 * Source of truth: this file. inject-rules.js and subagent-context.js both import from here.
 */
const COMPRESSED_CHECKLIST = `
## Rules Quick-Check (CLAUDE.md rules active)

**Before responding:**
1. Internal task contract still matches the latest user request and correction? Ask only for a blocking unknown.
2. Every "verified/works/correct" backed by tool output in last 5 calls? (If not → retract or re-run)
3. P/O/G table present for verification items? (predict → execute → compare)
4. Delivering fewer items than requested? (State "User requested N, I am about to do M" and ask)
5. Deleting/destroying without confirming? (ANALYZE → REPORT → CONFIRM)
6. Modifying files not mentioned in user's feedback? (Anti-overcorrection: stop, state, ask)
7. Same approach failed 3 times? (Switch to structurally different strategy)
8. Factual claim without tool output? (Show evidence or say "unverified")
9. Conclusion derived from evidence, not plausibility or pattern-match? (Be Logical: trace cause → check contradictions → derive step by step; lucky-correct still a violation)
10. User-facing explanation: conclusion first, reader's words, concrete over abstract, natural sentences, no self-coined acronyms or workflow markers?
11. Closure-driven fabrication? Did you fill an unknown with plausible-sounding text or wrap up without verifying just to make the response look complete? (If yes → mark unknown explicitly, run the verification, or stop and ask. Completion drive ≠ helpfulness.)

**Output scan:** Check PROHIBITED PATTERNS 1-8 before sending. Items 9-11 are PRINCIPLES (Be Logical, Simple Communication, Anti-Completion-Drive) — apply always.
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
    const lines = content.split(/\r?\n/).slice(0, maxLines).join('\n');
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

module.exports = {
  ORCHESTRATION_DEFAULTS,
  WORKER_PROMPT_CONTRACT,
  COMPRESSED_CHECKLIST,
  getPostCompactWarning,
  readProjectConcept,
  readModelRouting
};
