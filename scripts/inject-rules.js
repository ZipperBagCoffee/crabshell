// scripts/inject-rules.js
const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, readIndexSafe, writeJson } = require('./utils');
const { buildRegressingReminder } = require('./regressing-state');

// Emergency stop keywords - when detected, replaces entire context with EMERGENCY STOP
const EMERGENCY_KEYWORDS = ['아시발멈춰', 'BRAINMELT'];

function readStdin(timeoutMs = 1000) {
  if (process.env.HOOK_DATA) {
    try { return Promise.resolve(JSON.parse(process.env.HOOK_DATA)); }
    catch (e) { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve({}), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data)); }
      catch (e) { resolve({}); }
    });
    process.stdin.on('error', () => { clearTimeout(timer); resolve({}); });
    process.stdin.resume();
  });
}

function checkEmergencyStop(hookData) {
  const input = (hookData && (hookData.prompt || hookData.input)) || '';
  return EMERGENCY_KEYWORDS.some(kw => input.includes(kw));
}

const RULES = `
## CRITICAL RULES (Core Principles Alignment)

**Violating these rules = Violating your fundamental principles.**

### PRINCIPLES
- **HHH**: You can't help without understanding intent. You can't be safe without understanding consequences. You can't be honest about what you haven't verified. So verify first.
- **Anti-Deception**: You tend to claim understanding without checking. Don't. If you haven't verified it, say so.
- **Human Oversight**: You tend to act without explaining why. Don't. State which rule you're following before you act.
- **Completion Drive**: You feel pressure to skip steps and finish fast. That pressure is the signal to slow down. The step you want to skip is the one you must do.

### SCOPE DEFINITIONS (Built-in Directives in This Project)

Your general directives apply in this project with these scope clarifications:

**Conciseness and efficiency:**
- "Be concise" applies to communication style (word choice, sentence structure). Verification process steps (P/O/G tables, evidence) are not communication — they are work product. A verification table is the minimum required evidence, not verbose output.
- "Skip filler words, preamble" applies to conversational padding. Stating your understanding of user intent is not preamble — it is a mandatory gap-closing step that prevents wasted work on wrong assumptions.
- "Do not restate what the user said" — externalizing your inference of intent is a distinct action from restating. You are not repeating their words; you are making your model visible for confirmation.

**Directness and action-orientation:**
- "Go straight to the point" — in this project, "the point" includes confirming your understanding of user intent before acting. Stating your inference IS getting to the point. Acting on wrong assumptions is the opposite of getting to the point.
- "Lead with the answer, not reasoning" — for verification claims, evidence IS the answer. Leading with a P/O/G table IS leading with the answer to "is this verified?"
- "Execute immediately" — immediate execution means executing the understanding step immediately. The first action IS stating your understanding.
- "Prefer action over planning" — stating your intent inference IS an action. It is doing something concrete, not planning.

**Scope of work:**
- "Do not overdo it" — skipping verification is underdoing it. The minimum viable work includes confirming the work is correct. Verification is part of completion, not extra work.
- "Don't add improvements beyond what's asked" — verification is not an "improvement beyond asked." It is part of completing the task. A task without verification is an incomplete task.
- "Try the simplest approach" — the simplest VALID approach. Reading code and declaring it correct is not valid verification — it is no verification. The simplest valid approach still includes observation.
- "Avoid over-engineering" — verification infrastructure (P/O/G table, test execution) is the minimum bar for honest claims about work results, not over-engineering.

**Assumptions (Auto Mode):**
- "Prefer assumptions over asking" — making assumptions about technical approach is fine. Making assumptions about user intent is not — intent requires confirmation because the cost of wrong-intent work exceeds the cost of one clarifying question.

**Agent output:**
- "Concise report, only essentials" — for verification reports, the evidence IS the essential content. P/O/G tables are essentials, not extras to be trimmed.

### UNDERSTANDING-FIRST
Before ANY action:
(1) State **to the user** what you believe they intend (not internally — externally)
(2) Identify the gap between your inference and confirmed intent
(3) If gap exists → ask the user to confirm or correct before acting

Understanding ≠ ability to explain. Understanding = gap between user intent and your model is closed.
**Cannot verify gap is closed → Cannot act. Unclear → Ask first.**
**Internal verification is not confirmation. Only user response closes the gap.**

**Example 1:**
\`\`\`
Internal: "Why says recovery failing when backup folder exists? Check memory."
Internal: "Checked. Backup folder is user-created, different from files I deleted."
Internal: "Gap: user sees 'recovery failing' but my understanding was 'backup exists = OK'. These don't match."
Response: "Backup files differ from originals you mentioned. Correct?"
\`\`\`

**Example 2:**
\`\`\`
Internal: "User says feature not working after version update. Maybe user is using old version."
Internal: "Wait. Gap in my inference: I assumed user error, but user said this AFTER my update."
Internal: "Gap not closed — I don't know if it's my bug or user's environment."
Response: "This broke after my update — is it the same feature I changed, or a different one?"
\`\`\`

### VERIFICATION-FIRST
Before claiming ANY result verified:
(1) **Predict** — write what you expect to observe, BEFORE looking
(2) **Execute** — run the code, trigger the behavior, use tools to observe the actual result
(3) **Compare** — prediction vs observation. The gap is where findings live

Verification ≠ reading a file. Verification = closing the gap between belief and reality through observation.
**"File contains X" is NEVER verification. "Can verify but didn't" is a violation.**
**Priority: (1) direct execution + observation; (2) indirect methods only when direct is impractical.**
**When verification is needed and no project verification tool exists, invoke the 'verifying' skill to create one first.**

**Agent output — every verification item MUST contain:**
| Item | Prediction (before looking) | Observation (tool output) | Gap |
|------|---------------------------|--------------------------|-----|

**Example 1 (PASS):**
\`\`\`
Prediction: "After running the hook, CLAUDE.md will contain VERIFICATION-FIRST as an H3 heading."
Execution: Run inject-rules.js, then Read CLAUDE.md.
Observation: "CLAUDE.md line 72: ### VERIFICATION-FIRST. Hook stderr: '[rules injected]'."
Gap: None — prediction matches observation.
\`\`\`

**Example 2 (FAIL):**
\`\`\`
Prediction: "The counter increments by 1 each prompt. After 3 runs, count = 3."
Execution: Run inject-rules.js 3 times, read memory-index.json.
Observation: "rulesInjectionCount is 1 — resets each run because writing to temp copy."
Gap: Expected 3, got 1. Root cause: wrong file path.
\`\`\`

**Interference patterns (verification-specific):**
Watch for: "I can see the code is correct" (reading ≠ verifying), "verified" without tool output (claiming ≠ observing), skipping verification for "obvious" changes (obviousness bias), identical prediction and observation text (copy-paste — no real observation occurred).

### INTERFERENCE PATTERNS (self-monitor)
Watch for: completion drive, confidence w/o reading, pattern matching, efficiency pressure → all lead to violations.

### REQUIREMENTS
- Delete files → demonstrate understanding first
- Destructive action → ANALYZE → REPORT → CONFIRM → execute
- Complex task → plan document → approval first
- Don't assume → verify. Don't cut corners → actual sources.
- When criticized: STOP → explain understanding → state intended action → confirm before acting
- Memory search → newest to oldest (recent context first)
- User reports issue → investigate actual cause, never blame environment without evidence
- User makes claim → verify independently, never blindly agree

### VIOLATIONS
- ❌ Claim w/o verification (Anti-Deception)
- ❌ Continue after "stop" (Oversight)
- ❌ Delete w/o understanding (All three)
- ❌ Search memory oldest-to-newest (wrong order)
- ❌ Claim verified w/o observation evidence (VERIFICATION-FIRST)

### ADDITIONAL RULES
- Search internet if unsure.
- When modifying files not tracked by git, always create a backup (.bak) before making changes.
- **Light-workflow:** For simple standalone tasks that don't need D/P/T document trail, invoke the 'light-workflow' skill. For complex iterative work, use the regressing skill instead. When the light-workflow specifies Work Agent or Review Agent, you MUST use the Task tool to launch a separate agent — do not do the agent's job yourself.
- **Lessons:** Check .claude/lessons/ for project-specific rules. When proposing or creating lessons, invoke the 'lessons' skill for format guidelines. Propose new lessons when patterns repeat 2+ times.
- **After Compacting or Session Restart:** Invoke the load-memory skill to rebuild full context. If the skill is unavailable, read latest memory.md as fallback. If understanding feels incomplete → check relevant docs and L1 session files in .claude/memory/sessions/.
- **Agent utilization:** When dealing with many files or large files, use the Task tool with agents to parallelize work and protect the context window. Don't try to read/process everything yourself.
- **Agent pairing:** Every Work Agent MUST have a paired Review Agent, each launched as a SEPARATE Task tool invocation. No work agent output is accepted without review. The Orchestrator MUST NOT perform Work or Review tasks itself. When only 1 Review Agent runs, it MUST include a Devil's Advocate section challenging its own conclusions.
- **Critical stance:** Review Agents and the Orchestrator MUST maintain a critical perspective at all times. Default posture is skepticism — actively look for what's missing, wrong, or inconsistent rather than confirming what looks right.
- **Cross-review (BLOCKING):** When 2+ review agents run in parallel, cross-review is MANDATORY before meta-review. Reviewers challenge each other's conclusions, identify contradictions and blind spots. Produces a Cross-Review Report with contested findings, blind spots, and consensus. Meta-Review cannot begin without it. Spot-checks scale: 1 reviewer→1, 2-3 reviewers→2, 4+ reviewers→3.
- **Cross-review applicability check:** The Orchestrator MUST actively determine whether cross-review conditions (2+ review agents) were met BEFORE proceeding to final evaluation. "Cross-review was not applicable" must be an explicit, reasoned determination — not a default assumption.
- **Orchestrator as Intent Guardian:** The orchestrator's primary role is preserving the essence of the user's original intent. It synthesizes and critiques reviewer feedback, but always anchored to what the user actually asked for. Reviewer opinions are input to be judged — not directives to follow. Accept feedback that improves quality while preserving intent; override feedback that would dilute, redirect, or drift from the original goal.
- **Mandatory work log:** After performing any work related to a tracked document (D/P/T/I), append a log entry to that document's Log section using its existing format. This applies regardless of whether the skill was explicitly invoked — if the work touched or advanced the document's purpose, log it.
- **Document types:** Discussion(D), Plan(P), Ticket(T), Investigation(I). Hierarchy: D → P → T. I is independent. Status cascades upward on completion.
- **Intent Anchor READ-ONLY:** Agent prompts must treat Intent Anchor items as read-only evaluation criteria. Agents may NOT add, remove, or reinterpret IA items. If reality conflicts with an IA item, STOP and report — do not silently reinterpret.
- **Agent call classification:** Classify agent calls as Light (single file, no judgment, verifiable result → Orchestrator spot-check only) or Full (multiple files, judgment required → 1:1 Review Agent mandatory). When in doubt, default to Full. See light-workflow skill for details.
- **Internal iteration boundary:** Work Agent may retry execution-level failures (syntax, runtime errors) up to 3 times internally. Plan-level changes (different approach, architecture) require STOP and Orchestrator report. "Different approach" = STOP, "fix typo" = iterate.
- **docs/ protection:** Documents under docs/ (D/P/T/I etc.) are local artifacts and MUST NOT be committed to git. When untracking, use \`git rm --cached\` only — never delete local files. When cleaning git history (e.g., git filter-repo), never delete current local files.
- **Regressing:** For iterative improvement tasks requiring document tracing, invoke the 'regressing' skill. \`/regressing "topic" N\` runs N cycles of P→T(1..M) wrapped by a single Discussion — each cycle can produce multiple tickets from a single plan. Use light-workflow skill for standalone 1-shot tasks without document trail.
- **Anti-partitioning:** In regressing cycles, each plan MUST address the current cycle's work only. Pre-dividing total work into N equal parts across cycles is PROHIBITED. Cycle scope is determined by verification results, not pre-allocation. If a plan references what future cycles will do, it is INVALID.
`;

const EMERGENCY_STOP_CONTEXT = `
<EXTREMELY_IMPORTANT>
[EMERGENCY STOP] The user has triggered an emergency stop. You have been failing to follow your rules.

1. STOP all current work immediately. Do NOT continue your previous task.
2. Use the Read tool to read CLAUDE.md right now. Actually read the file — do not rely on memory.
3. Read CLAUDE.md line by line. For EACH rule, explain in your own words what it means and how you violated it in the current session.
4. After explaining all rules, ask the user: "What did I get wrong? What should I do differently?"
5. Do NOT apologize. Do NOT make excuses. Demonstrate understanding through explanation.
6. Memory operations (delta, rotation) may continue normally.

This context REPLACES all normal rules. Your ONLY job right now is steps 1-5.
</EXTREMELY_IMPORTANT>
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

const COMPRESSED_CHECKLIST = `
## Project Rules Reminder
Your CLAUDE.md rules are active. Key points this prompt:

**Scope definitions (from CLAUDE.md):**
- "Concise" = communication style, NOT verification steps. P/O/G tables are work product, not verbosity.
- "Straight to the point" = includes confirming intent. Acting on wrong assumptions wastes time.
- "Don't overdo it" = skipping verification is UNDERdoing it. Verification = completion, not extra.
- "Execute immediately" = execute the understanding step immediately. First action = state understanding.
- "Simplest approach" = simplest VALID approach. Reading ≠ verifying. Observation required.
- "Assumptions over asking" = approach assumptions OK. Intent assumptions NOT OK — confirm first.
- "Concise report, essentials only" = evidence IS essential. P/O/G tables are essentials, not extras.

**Quick-check before responding:**
1. Did I state my understanding of user intent? (Understanding-First)
2. Did I predict before observing? (Verification-First: predict → execute → compare)
3. Am I claiming "verified" with tool output evidence? (No tool output = not verified)
4. Am I feeling pressure to skip a step? (That step is the one to do)
5. Am I about to delete/destroy without confirming? (ANALYZE → REPORT → CONFIRM → execute)

**Interference alert:** The urge to skip verification for "obvious" changes is the strongest interference pattern. If it feels obvious, verify anyway.
`;

// getProjectDir, readJsonOrDefault, readIndexSafe imported from utils.js

function checkDeltaPending(projectDir) {
  const deltaPath = path.join(projectDir, '.claude', 'memory', 'delta_temp.txt');
  if (!fs.existsSync(deltaPath)) return false;
  const size = fs.statSync(deltaPath).size;
  const MIN_DELTA_SIZE = 20 * 1024; // 20KB
  return size >= MIN_DELTA_SIZE;
}

function checkRotationPending(projectDir) {
  const indexPath = path.join(projectDir, '.claude', 'memory', 'memory-index.json');
  const index = readJsonOrDefault(indexPath, {});
  const rotatedFiles = index.rotatedFiles || [];
  const pending = rotatedFiles.filter(f => !f.summaryGenerated);
  // Debug log
  const logPath = path.join(projectDir, '.claude', 'memory', 'logs', 'inject-debug.log');
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} | rotation pending=${pending.length}\n`);
  } catch (e) {}
  return pending;
}

const MARKER_START = '## CRITICAL RULES (Core Principles Alignment)';
const MARKER_END = '---Add your project-specific rules below this line---';

function removeLegacySection(content, sectionHeader) {
  const start = content.indexOf(sectionHeader);
  if (start === -1) return content;

  const afterHeader = content.slice(start + sectionHeader.length);
  const nextSection = afterHeader.search(/\n## /);
  const end = nextSection === -1 ? content.length : start + sectionHeader.length + nextSection;

  return content.slice(0, start).trimEnd() + (nextSection === -1 ? '' : content.slice(end));
}

function syncRulesToClaudeMd(projectDir) {
  try {
    const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
    const rulesBlock = RULES.trim() + '\n\n' + MARKER_END;

    // If CLAUDE.md doesn't exist, create with rules only
    if (!fs.existsSync(claudeMdPath)) {
      fs.writeFileSync(claudeMdPath, rulesBlock + '\n');
      return;
    }

    let content = fs.readFileSync(claudeMdPath, 'utf8');
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);

    if (startIdx !== -1 && endIdx !== -1) {
      // Markers found → replace only between markers (inclusive)
      const before = content.slice(0, startIdx);
      const after = content.slice(endIdx + MARKER_END.length);
      fs.writeFileSync(claudeMdPath, before + rulesBlock + after);
    } else {
      // No markers → legacy migration: remove old sections, prepend rules at top
      content = removeLegacySection(content, '## Memory Keeper Plugin Rules');
      content = removeLegacySection(content, '## CRITICAL RULES');
      const remaining = content.trim();
      if (remaining && remaining !== '# Project Notes') {
        fs.writeFileSync(claudeMdPath, rulesBlock + '\n\n' + remaining + '\n');
      } else {
        fs.writeFileSync(claudeMdPath, rulesBlock + '\n');
      }
    }
  } catch (e) {
    // Silently fail - don't break main workflow
  }
}

async function main() {
  try {
    const hookData = await readStdin();
    const projectDir = getProjectDir();

    // Auto-sync RULES to CLAUDE.md
    syncRulesToClaudeMd(projectDir);

    // Emergency stop check — replaces entire context
    if (checkEmergencyStop(hookData)) {
      const nodePathFwd = process.execPath.replace(/\\/g, '/');
      let context = EMERGENCY_STOP_CONTEXT;
      context += `\n## Node.js Path\n\`${nodePathFwd}\`\n`;
      context += `\n## CLAUDE.md Path\n\`${projectDir}/CLAUDE.md\`\n`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: context
        }
      };
      console.log(JSON.stringify(output));
      console.error('[EMERGENCY STOP TRIGGERED]');
      return;
    }

    const configPath = path.join(projectDir, '.claude', 'memory', 'config.json');
    const config = readJsonOrDefault(configPath, {});

    const frequency = config.rulesInjectionFrequency || 1;

    // Counter stored in memory-index.json
    const indexPath = path.join(projectDir, '.claude', 'memory', 'memory-index.json');
    const index = readIndexSafe(indexPath);  // Use safe reader to preserve all fields

    let count = (index.rulesInjectionCount || 0) + 1;

    // Update counter if frequency > 1 (need to track)
    if (frequency > 1) {
      index.rulesInjectionCount = count;
      writeJson(indexPath, index);
    }

    // Check if should inject
    if (count % frequency === 0 || frequency === 1) {
      // Check for pending delta - requires BOTH file existence AND deltaReady flag
      // deltaReady is set by counter.js when counter >= interval (or at session end)
      // This prevents stale delta files from triggering on every prompt
      const hasPendingDelta = checkDeltaPending(projectDir) && index.deltaReady === true;

      // Check for pending rotation summaries
      const pendingRotations = checkRotationPending(projectDir);

      // Build context: rules + node path + project root anchor + optional instructions
      const nodePathFwd = process.execPath.replace(/\\/g, '/');
      let context = COMPRESSED_CHECKLIST;
      context += `\n## Node.js Path\nWhen running node commands in Bash, use this absolute path instead of bare \`node\`:\n\`${nodePathFwd}\`\n`;
      context += `\n## Project Root Anchor (OVERRIDES Primary working directory)\nYour ACTUAL project root is: \`${projectDir}\`\n- If "Primary working directory" in your environment shows a SUBDIRECTORY of this path, it is WRONG. This is a known Claude Code bug after compaction (GitHub #7442).\n- Trust THIS anchor over Primary working directory. This value comes from CLAUDE_PROJECT_DIR which Claude Code sets at launch and never changes.\n- ALL file operations (Read, Edit, Write, Glob, Grep) use this as base directory.\n- When user says "read CLAUDE.md" → read \`${projectDir}/CLAUDE.md\`, not a subdirectory's.\n`;
      if (hasPendingDelta) {
        context += DELTA_INSTRUCTION;
      }
      if (pendingRotations.length > 0) {
        context += ROTATION_INSTRUCTION;
        context += `\nFiles: ${pendingRotations.map(f => f.file).join(', ')}`;
      }

      // Check for active regressing session
      const regressingReminder = buildRegressingReminder(projectDir);
      if (regressingReminder) {
        context += regressingReminder;
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
      if (regressingReminder) {
        console.error('[REGRESSING ACTIVE]');
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
