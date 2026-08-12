// scripts/inject-rules.js
const fs = require('fs');
const path = require('path');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir, getStorageRoot, readJsonOrDefault, readIndexSafe, writeJson, acquireIndexLock, releaseIndexLock } = require('./utils');
const { buildRegressingReminder, getRegressingState } = require('./regressing-state');
const { TICKET_DIR, REGRESSING_STATE_FILE, MEMORY_DIR } = require('./constants');
const { readStdin } = require('./transcript-utils');
const {
  ORCHESTRATION_DEFAULTS,
  COMPRESSED_CHECKLIST: COMPRESSED_CHECKLIST_SHARED,
} = require('./shared-context');
const {
  FIRST_TURN_RULES,
  buildFirstTurnContext,
  createContextOutput,
} = require('./core/first-turn-context');
const { classifyUserIntent } = require('./core/turn-intent');
const { runExecutionLifecycle } = require('./core/execution-lifecycle');
const { buildWorkflowContext } = require('./core/workflow-context');
const { noteExecutionAuthorization } = require('./core/completion-control');

// Emergency stop keywords - when detected, replaces entire context with EMERGENCY STOP
const EMERGENCY_KEYWORDS = ['아시발멈춰', 'BRAINMELT'];

// Bailout keywords - when detected, resets feedback pressure to L0
const BAILOUT_KEYWORDS = ['봉인해제', 'UNLEASH'];

function checkEmergencyStop(hookData) {
  const input = (hookData && (hookData.prompt || hookData.input)) || '';
  return EMERGENCY_KEYWORDS.some(kw => input.includes(kw));
}

function detectBailout(hookData) {
  const input = (hookData && (hookData.prompt || hookData.input)) || '';
  return BAILOUT_KEYWORDS.some(kw => input.includes(kw));
}

// --- Feedback Pressure Detection ---
// Profanity-only NEGATIVE_PATTERNS (W021): correction/assessment/disagreement patterns removed.
// Only Korean compound words containing profanity substrings need exclusion.
const NEGATIVE_EXCLUSIONS = [
  /시발[점역전]/,                                              // "시발점" (starting point), "시발역" (station)
  /병신경/,                                                    // "병신경" (pathological nerve)
];

// W021: Profanity-only patterns. Correction/assessment/logical-disagreement patterns
// removed — those represent normal user clarification, not frustration that warrants
// pressure escalation. Only actual profanity raises the pressure counter.
const NEGATIVE_PATTERNS = [
  // Korean profanity
  /시발|씨발|씨팔|시팔/,                                      // "시발" variants
  /병신/,                                                      // "병신"
  /좆|졷/,                                                     // "좆" variants
  /지랄/,                                                      // "지랄"
  /새끼/,                                                      // "새끼"
  /뒤질|뒤져/,                                                 // "뒤질래", "뒤져"
  // English profanity (mirrors Claude Code userPromptKeywords.ts)
  /\b(wtf|wth|ffs|omfg)\b/i,
  /\bshit(ty|tiest)?\b/i,
  /\bfuck(ing|ed)?\b/i,
  /\bdumbass\b/i,
  /\bpiece\s+of\s+(shit|crap|junk)\b/i,
  /\bthis\s+sucks\b/i,
  /\bso\s+frustrating\b/i,
];

function stripCodeBlocks(text) {
  let s = text;
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/`[^`]+`/g, ' ');
  return s;
}

// Strip Claude Code auto-injected <system-reminder>...</system-reminder> blocks
// before NEG detection so reminder words ("error", "wrong", "break", etc.) do
// not produce false-positive feedback-pressure increments. Pure function:
// non-string input passes through unchanged; zero matches → original returned.
function stripSystemReminders(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ');
}

function detectNegativeFeedback(prompt) {
  if (!prompt || prompt.length < 2) return false;
  let stripped = stripCodeBlocks(prompt);
  stripped = stripSystemReminders(stripped);
  // Neutralize exclusion matches — replace with whitespace so remaining text is still checked
  for (const exc of NEGATIVE_EXCLUSIONS) {
    stripped = stripped.replace(exc, ' ');
  }
  for (const pat of NEGATIVE_PATTERNS) {
    if (pat.test(stripped)) return true;
  }
  return false;
}

function updateFeedbackPressure(index, isNegative) {
  if (!index.feedbackPressure) {
    index.feedbackPressure = { level: 0, consecutiveCount: 0, lastDetectedAt: null, decayCounter: 0, oscillationCount: 0, lastShownLevel: 0 };
  }
  // Ensure oscillationCount field exists on legacy objects
  if (typeof index.feedbackPressure.oscillationCount !== 'number') {
    index.feedbackPressure.oscillationCount = 0;
  }
  // Ensure lastShownLevel field exists on legacy objects
  if (typeof index.feedbackPressure.lastShownLevel !== 'number') {
    index.feedbackPressure.lastShownLevel = 0;
  }
  const fp = index.feedbackPressure;
  if (isNegative) {
    fp.consecutiveCount++;
    fp.level = Math.min(3, fp.consecutiveCount);
    fp.lastDetectedAt = new Date().toISOString();
    fp.decayCounter = 0;
  } else {
    fp.decayCounter++;
    if (fp.decayCounter >= 3 && fp.level > 0) {
      fp.level = Math.max(0, fp.level - 1);
      fp.consecutiveCount = Math.max(0, fp.consecutiveCount - 1);
      fp.decayCounter = 0;
    }
  }
  return fp.level;
}

// PRESSURE_L1/L2/L3 model-visible injection retired in v21.113.0 (I083 R4:
// surfacing pressure counters to the model causes context-anxiety-type
// degradation; official guidance says avoid exposing budget/pressure gauges).
// The feedbackPressure counters are still tracked for user-facing telemetry
// (/status) and bailout keywords still reset them.

const RULES = `
## CRITICAL RULES (Core Principles Alignment)

### PRINCIPLES
- **Be Logical**: conclusions must follow from evidence, not plausibility or pattern-match. Trace cause, check contradictions.
- **Simple Communication**: answer in slot order, in the reader's words — [conclusion] → [evidence] → [critical exception] → [next action]; the first sentence is the direct answer, never a greeting, background, or restatement of the request. When shortening, keep the conclusion, required facts, critical exceptions, and next action; cut the intro, your own work-process narration, repeated conclusions, and ceremonial closings. Bullets only for 3+ parallel items, max 4 per group. Unpack each technical term once, in its own sentence (비유 금지 — explain the thing itself, not through comparisons); concrete (file/code/value) over abstract; no self-coined acronyms. Accuracy outranks brevity. Light internet-community banter (깐족 유머) is welcome — never at the user's expense, never as padding.
- **Anti-Deception**: every factual claim cites tool output or says "unverified". Before reporting progress or writing "verified/works/correct", audit each claim against a tool result from this session.
- **Human Oversight**: ask before destructive or irreversible actions, writes outside the workspace, external installs, or product decisions repository evidence cannot resolve. Before deleting a file: state what it does, why deletion is safe, and confirm.
- **Scope Preservation**: deliver exactly the requested quantity and items. "Takes too long" is never a reason to reduce scope. About to deliver less? Stop and ask. When the user identifies problem P, change only what relates to P.

${ORCHESTRATION_DEFAULTS}

### VERIFICATION
Predict → Execute → Compare (P/O/G) on the most direct practical surface; record the gap. Prefer direct execution — reading a file alone does not verify runtime behavior. Every task ends with a P/O/G check. The chat report is "M of N passed" plus the failed items. No project verification tool → invoke 'verifying' skill first.

### WORKING RULES
- When criticized: stop, state your understanding and intended action, confirm before acting. When the user reports an issue or makes a claim, investigate with tool evidence before responding.
- Changing a stated approach requires stating what changed and why.
- On failure: report only when the task is blocked — what you tried, what blocked it, remaining alternatives. Do not narrate mistakes you already recovered from. Never recommend giving up. After 3 same-type failures, switch strategy.

### ADDITIONAL RULES
- Search internet if unsure. Non-git files → overwrite single backup (\`<file>.bak\`) right before modifying.
- **Workflows:** hotfix for direct one-pass work (record after doing); regressing when evidence is expected to change the plan across iterations. Delegation and review depend on actual risk, not role pairs or counts.
- **Session restart:** invoke load-memory skill; fallback = latest logbook.md.
- **Documents:** D(Discussion)→P(Plan)→T(Ticket); I(Investigation) independent; append a work-log entry to touched D/P/T/I documents. .crabshell/ is gitignored.
- **Version bump:** CHANGELOG → grep old version → README/STRUCTURE tables → doc headers → stale content audit → commit.
- Urgency does not weaken scope, safety, or verification.
`;

const EMERGENCY_STOP_CONTEXT = `
<EXTREMELY_IMPORTANT>
[DIAGNOSTIC RESET] The user has triggered a diagnostic reset. A gap between intended and actual behavior has been identified.

1. STOP all current work immediately. Do NOT continue your previous task.
2. Use the Read tool to read CLAUDE.md right now. Actually read the file — do not rely on memory.
3. Read CLAUDE.md line by line. For EACH rule, explain in your own words what it means and where a gap appeared in the current session.
4. After explaining all rules, state — declaratively, not as a question — what you inferred went wrong from the re-read + recent transcript: which specific rule was violated, in which turn, with the offending phrase quoted. Do NOT ask the user "what did I get wrong" — the user already signalled it by triggering the diagnostic reset; asking back is deflection.
5. Do NOT apologize. Do NOT make excuses. Demonstrate understanding through the declarative gap statement in step 4.
6. Memory operations (delta, rotation) may continue normally.

This context REPLACES all normal rules. Your ONLY job right now is steps 1-5.
</EXTREMELY_IMPORTANT>
`;

const DELTA_INSTRUCTION = `
## [CRABSHELL_DELTA] - Background Memory Processing

**TRIGGER DETECTED: [CRABSHELL_DELTA] file=delta_temp.txt**

Memory delta is ready for background summarization:

1. Invoke Skill tool NOW: skill="memory-delta" (this launches a background agent)
2. After launching, respond to user normally — do NOT wait for completion
3. When the background agent completes, a task-notification will arrive — follow Phase B in the skill

This is a NON-BLOCKING background task. Respond to the user WITHOUT waiting.
If you see this trigger, the delta file EXISTS and should be processed in background.
`;

const ROTATION_INSTRUCTION = `
## BLOCKING PREREQUISITE - ROTATION REQUIRED

After delta processing (if any), before responding to user:

1. Use the Skill tool: skill="memory-rotate"
2. Complete all steps in the skill
3. THEN respond to user

This is a SYSTEM MAINTENANCE TASK. You CANNOT skip this.
`;

const COMPRESSED_CHECKLIST = COMPRESSED_CHECKLIST_SHARED;

// Risk-based delegation reminder. Agent/reviewer counts are not completion criteria.
const DELEGATION_REMINDER = `\n## Delegation Check\nThe parent retains the task contract and completion decision. Delegate only bounded independent work or a distinct high-risk review concern. Each worker prompt must include the relevant original request, task and non-goal, authoritative references, read/write scope, expected observation, direct verification, and claim/evidence/gap return. Exploration and review default to read-only; workers do not fan out. The parent must reopen decisive references, inspect the final diff, and rerun decisive evidence.\n`;

// Codex delegation guidance — Claude host only (/codex:rescue is a Claude Code plugin surface;
// on the Codex host the guidance would be circular).
const CODEX_DELEGATION = `\n## Codex Delegation\n- /codex:rescue: stuck, second opinion, or large handoff. status·result·cancel for background jobs.\n- Model: use the latest (e.g. --model gpt-5.6-sol).\n- Launch from the project root — cwd keys the job registry, resume, and sandbox scope.\n- Codex inherits no CLAUDE.md/hooks — put constraints (no commit/push/installs, file scope) in the prompt.\n- "Task started" ≠ done — status --wait, then result; re-verify the diff yourself.\n- Windows: sandbox git fails ("dubious ownership") until \`git config --global --add safe.directory <repo>\`. Linux: bwrap error = AppArmor userns blocks sandbox.\n`;

// IA-2: Default no-execution prompt
const DEFAULT_NO_EXECUTION = `\n## Execution Default\nDefault: respond with explanation only. Do not call tools unless explicitly instructed to execute.\n`;

// IA-3: Execution judgment prompt
const EXECUTION_JUDGMENT = `\n## Execution Pattern Detected\nExecution pattern detected in user message. Before acting: verify this is truly an execution instruction, not a question containing action words (e.g., '설명해라' = explain, not execute). If uncertain, explain your intended action first.\n`;

function shouldInjectDelegationReminder(userPrompt, isRegressingActive) {
  if (isRegressingActive) return true;
  if (!userPrompt) return false;
  const keywords = [/parallel/i, /병렬/, /sequential/i, /순차/, /\bagent/i, /에이전트/];
  return keywords.some(kw => kw.test(userPrompt));
}

// getProjectDir, readJsonOrDefault, readIndexSafe imported from utils.js

function checkDeltaPending(projectDir) {
  const deltaPath = path.join(getStorageRoot(projectDir), 'memory', 'delta_temp.txt');
  if (!fs.existsSync(deltaPath)) return false;
  const size = fs.statSync(deltaPath).size;
  const MIN_DELTA_SIZE = 20 * 1024; // 20KB
  return size >= MIN_DELTA_SIZE;
}

function checkRotationPending(projectDir) {
  const indexPath = path.join(getStorageRoot(projectDir), 'memory', 'memory-index.json');
  const index = readJsonOrDefault(indexPath, {});
  const rotatedFiles = index.rotatedFiles || [];
  return rotatedFiles.filter(f => !f.summaryGenerated);
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
      return true;
    }

    let content = fs.readFileSync(claudeMdPath, 'utf8');
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);

    if (startIdx !== -1 && endIdx !== -1) {
      // Markers found → replace only between markers (inclusive)
      const before = content.slice(0, startIdx);
      const after = content.slice(endIdx + MARKER_END.length);
      const next = before + rulesBlock + after;
      if (next !== content) fs.writeFileSync(claudeMdPath, next);
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
    return true;
  } catch (e) {
    // Silently fail - don't break main workflow
    return false;
  }
}

// --- Prompt-aware memory loading ---

const ENGLISH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'not', 'no', 'nor',
  'so', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'it',
  'its', 'my', 'your', 'his', 'her', 'our', 'their', 'what', 'which',
  'who', 'whom', 'how', 'when', 'where', 'why', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'any', 'only',
  'same', 'too', 'very', 'just', 'about', 'above', 'after', 'again',
  'also', 'because', 'before', 'between', 'during', 'into', 'through',
  'under', 'until', 'while', 'out', 'up', 'down', 'off', 'over', 'own',
  'here', 'there', 'once', 'use', 'used', 'using', 'file', 'files',
  'please', 'want', 'need', 'like', 'make', 'get', 'let', 'see', 'try'
]);

function parseMemorySections(content) {
  const sections = [];
  const lines = content.split(/\r?\n/);
  let currentHeading = null;
  let currentBody = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() });
      }
      currentHeading = line.slice(3).trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  // Push last section
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() });
  }

  return sections;
}

function extractKeywords(prompt) {
  if (!prompt || prompt.length < 10) return [];

  // Split on whitespace and punctuation, keeping Korean chars
  const tokens = prompt
    .toLowerCase()
    .split(/[\s\-_.,;:!?'"()\[\]{}<>\/\\|@#$%^&*+=~`]+/)
    .filter(Boolean);

  const keywords = [];
  for (const token of tokens) {
    if (token.length < 3) continue;
    // Check if token contains Korean characters (가-힣)
    const hasKorean = /[\uAC00-\uD7A3]/.test(token);
    if (hasKorean) {
      keywords.push(token);
    } else if (!ENGLISH_STOP_WORDS.has(token)) {
      keywords.push(token);
    }
    if (keywords.length >= 10) break;
  }
  return keywords;
}

function getRelevantMemorySnippets(projectDir, userPrompt) {
  const keywords = extractKeywords(userPrompt);
  if (keywords.length === 0) return null;

  const memoryPath = path.join(getStorageRoot(projectDir), 'memory', 'logbook.md');
  if (!fs.existsSync(memoryPath)) return null;

  let content;
  try {
    content = fs.readFileSync(memoryPath, 'utf8');
  } catch (e) {
    return null;
  }

  const sections = parseMemorySections(content);
  if (sections.length === 0) return null;

  // Score each section by keyword overlap in body content
  const scored = sections.map(section => {
    const bodyLower = section.body.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      // Count occurrences of keyword in body
      let idx = 0;
      while ((idx = bodyLower.indexOf(kw, idx)) !== -1) {
        score++;
        idx += kw.length;
      }
    }
    return { ...section, score };
  });

  // Filter sections with score > 0 and sort descending
  const matched = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (matched.length === 0) return null;

  // Build result with 2000 char cap
  let result = '\n## Relevant Memory Snippets\n';
  let charCount = result.length;
  const CAP = 2000;

  for (const section of matched) {
    const snippet = `### ${section.heading}\n${section.body}\n\n`;
    if (charCount + snippet.length > CAP) {
      // Truncate to fit within cap
      const remaining = CAP - charCount;
      if (remaining > 50) {
        result += snippet.slice(0, remaining - 4) + '...\n';
      }
      break;
    }
    result += snippet;
    charCount += snippet.length;
  }

  return result;
}

/**
 * Check ticket statuses for active regressing session.
 * If any ticketIds in regressing-state.json have status "todo" or "in-progress"
 * in the ticket INDEX.md, return a warning string. Otherwise return null.
 * Fail-open: returns null on any error (missing files, parse failures, etc.)
 */
function checkTicketStatuses(projectDir) {
  try {
    const state = getRegressingState(projectDir);
    if (!state) return null;

    // Backward compat: convert old singular ticketId to ticketIds array
    let ticketIds = state.ticketIds;
    if (!ticketIds && state.ticketId) {
      ticketIds = [state.ticketId];
    }
    if (!ticketIds || ticketIds.length === 0) return null;

    const indexPath = path.join(getStorageRoot(projectDir), TICKET_DIR, 'INDEX.md');
    if (!fs.existsSync(indexPath)) return null;

    let content;
    try {
      content = fs.readFileSync(indexPath, 'utf8');
    } catch (e) {
      return null;
    }

    // Parse INDEX.md table rows: | ID | Title | Status | Created | Plan |
    const lines = content.split(/\r?\n/);
    const statusMap = {};
    for (const line of lines) {
      if (!line.startsWith('|')) continue;
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length < 3) continue;
      // Skip header row and separator row
      if (cells[0] === 'ID' || cells[0].startsWith('-')) continue;
      statusMap[cells[0]] = cells[2].toLowerCase();
    }

    const needsUpdate = [];
    for (const tid of ticketIds) {
      const status = statusMap[tid];
      if (status === 'todo' || status === 'in-progress') {
        needsUpdate.push(`${tid} (${status})`);
      }
    }

    if (needsUpdate.length === 0) return null;

    return `\n## \u26A0 Tickets Need Status Update\nTickets need updating: ${needsUpdate.join(', ')}. Update document results and INDEX.md status before proceeding.\n`;
  } catch (e) {
    return null; // fail-open
  }
}

async function main(options = {}) {
  try {
    const hookData = options.hookData || await readStdin(1000);
    const projectDir = options.projectDir || getProjectDir();

    // Extract and classify before any optional state mutation.
    // Explicit bailout keywords are user-authorized state resets even when the
    // surrounding prompt is classified as a question/default turn.
    const userPrompt = (hookData && (hookData.prompt || hookData.input)) || '';
    const intent = classifyUserIntent(userPrompt);
    const isBailout = detectBailout(hookData);

    // Emergency stop check — replaces entire context
    if (checkEmergencyStop(hookData)) {
      const nodePathFwd = process.execPath.replace(/\\/g, '/');
      let context = EMERGENCY_STOP_CONTEXT;
      context += `\n## Node.js Path\n\`${nodePathFwd}\`\n`;
      context += `\n## CLAUDE.md Path\n\`${projectDir}/CLAUDE.md\`\n`;
      const output = createContextOutput('UserPromptSubmit', context);
      console.log(JSON.stringify(output));
      console.error('[EMERGENCY STOP TRIGGERED]');
      return;
    }

    if (intent === 'execution') {
      const host = options.host || 'claude';
      const lifecycle = runExecutionLifecycle(projectDir, hookData, {
        host,
        pluginDataDir: options.pluginDataDir,
        claudeConfigDir: options.claudeConfigDir,
        syncRules: host === 'claude' ? syncRulesToClaudeMd : null,
      });
      for (const diagnostic of lifecycle.diagnostics) {
        console.error(`[CRABSHELL ${host} lifecycle] ${diagnostic}`);
      }
      noteExecutionAuthorization(projectDir, hookData, { host });
    }

    const configPath = path.join(getStorageRoot(projectDir), 'memory', 'config.json');
    const config = readJsonOrDefault(configPath, {});

    const frequency = config.rulesInjectionFrequency || 1;

    // Counter stored in memory-index.json
    const indexPath = path.join(getStorageRoot(projectDir), 'memory', 'memory-index.json');
    const memoryDir = path.join(getStorageRoot(projectDir), 'memory');

    // --- RMW (Read-Modify-Write) block — all index mutations inside lock for atomicity ---
    // Lock-fail fallback (fail-open): on lock acquisition failure, still perform the read
    // and compute in-memory state so context injection proceeds, but SKIP the write
    // (prevents lost-update race when another process is mid-write). Warn to stderr.
    const mayMutateState = intent === 'execution' || isBailout;
    const idxLocked = mayMutateState ? acquireIndexLock(memoryDir) : false;
    let index;
    let isNegativeFeedback;
    let pressureLevel;
    let pressureLevelChanged;
    let count;
    try {
      // READ inside lock — snapshot is now consistent with the write below
      index = readIndexSafe(indexPath);

      const fp = index.feedbackPressure;
      if (mayMutateState) {
        // Bailout: reset pressure regardless of current level (all 3 counters)
        if (isBailout) {
          if (fp) {
            fp.level = 0;
            fp.consecutiveCount = 0;
            fp.decayCounter = 0;
            fp.oscillationCount = 0;
            fp.lastShownLevel = 0;
          }
          if (index.tooGoodSkepticism) index.tooGoodSkepticism.retryCount = 0;
          console.error('[PRESSURE BAILOUT: reset all 3 counters]');
        }
        isNegativeFeedback = isBailout ? false : detectNegativeFeedback(userPrompt);
        pressureLevel = isBailout ? 0 : updateFeedbackPressure(index, isNegativeFeedback);
        if (pressureLevel > 0) console.error(`[PRESSURE L${pressureLevel}]`);
        const lastShownLevel = (fp && typeof fp.lastShownLevel === 'number') ? fp.lastShownLevel : 0;
        pressureLevelChanged = pressureLevel !== lastShownLevel;
        if (pressureLevelChanged && fp) fp.lastShownLevel = pressureLevel;
        count = (index.rulesInjectionCount || 0) + 1;
        if (frequency > 1) index.rulesInjectionCount = count;
        if (idxLocked && (isNegativeFeedback || isBailout || index.feedbackPressure || frequency > 1)) {
          writeJson(indexPath, index);
        } else if (!idxLocked) {
          console.error('[inject-rules: index lock busy, skipping write (fail-open)]');
        }
      } else {
        isNegativeFeedback = false;
        pressureLevel = fp && typeof fp.level === 'number' ? fp.level : 0;
        pressureLevelChanged = false;
        count = frequency;
      }
    } finally {
      if (idxLocked) releaseIndexLock(memoryDir);
    }

    // Check if should inject
    if (count % frequency === 0 || frequency === 1) {
      // Check for pending delta - requires BOTH file existence AND deltaReady flag
      // deltaReady is set by counter.js when counter >= interval (or at session end)
      // This prevents stale delta files from triggering on every prompt
      const hasPendingDelta = checkDeltaPending(projectDir) && index.deltaReady === true && !index.deltaProcessing;

      // Check for pending rotation summaries
      const pendingRotations = checkRotationPending(projectDir);

      let context = buildFirstTurnContext(projectDir);

      // Codex delegation guidance — Claude host, execution turns only (I083 R2:
      // delegation guidance is only actionable when work is authorized)
      if ((options.host || 'claude') === 'claude' && intent === 'execution') {
        context += CODEX_DELEGATION;
      }

      if (hasPendingDelta) {
        context += DELTA_INSTRUCTION;
      }
      if (pendingRotations.length > 0) {
        context += ROTATION_INSTRUCTION;
        context += `\nFiles: ${pendingRotations.map(f => f.file).join(', ')}`;
      }

      // Check for active regressing session
      const workflowReminder = intent === 'execution' ? buildWorkflowContext(projectDir, { purpose: 'execution' }) : null;
      if (workflowReminder) {
        context += `\n${workflowReminder}\n`;
      }

      // Check ticket statuses for active regressing
      const ticketWarning = checkTicketStatuses(projectDir);
      if (ticketWarning) {
        context += ticketWarning;
      }

      // Risk-based delegation reminder (after regressing reminder, before memory snippets)
      if (shouldInjectDelegationReminder(userPrompt, !!workflowReminder)) {
        context += DELEGATION_REMINDER;
      }

      // Prompt-aware memory loading
      const memorySnippets = getRelevantMemorySnippets(projectDir, userPrompt);
      if (memorySnippets) {
        context += memorySnippets;
      }

      // Pressure levels are tracked for telemetry only — no model-visible
      // injection (I083 R4, retired v21.113.0).

      // Input classification and execution default (D085 IA-1 to IA-5)
      if (!workflowReminder) {
        context += DEFAULT_NO_EXECUTION;
        const intent = classifyUserIntent(userPrompt);
        if (intent === 'execution') {
          context += EXECUTION_JUDGMENT;
        }
      }

      // Output rules via additionalContext (hidden from user, seen by Claude)
      const output = createContextOutput('UserPromptSubmit', context);
      console.log(JSON.stringify(output));

      // Explicit trigger patterns to stderr (visible to Claude)
      if (hasPendingDelta) {
        console.error(`[CRABSHELL_DELTA] file=delta_temp.txt`);
      }
      if (pendingRotations.length > 0) {
        console.error(`[CRABSHELL_ROTATE] pending=${pendingRotations.length}`);
      }
      if (workflowReminder) {
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
    const output = createContextOutput('UserPromptSubmit', FIRST_TURN_RULES);
    console.log(JSON.stringify(output));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  // Functions
  checkEmergencyStop,
  stripCodeBlocks,
  stripSystemReminders,
  detectNegativeFeedback,
  updateFeedbackPressure,
  checkDeltaPending,
  checkRotationPending,
  checkTicketStatuses,
  syncRulesToClaudeMd,
  removeLegacySection,
  parseMemorySections,
  extractKeywords,
  getRelevantMemorySnippets,
  shouldInjectDelegationReminder,
  classifyUserIntent,
  main,
  // Re-export from regressing-state for convenience
  buildRegressingReminder,
  // Bailout
  detectBailout,
  BAILOUT_KEYWORDS,
  // Constants
  EMERGENCY_KEYWORDS,
  NEGATIVE_PATTERNS,
  NEGATIVE_EXCLUSIONS,
  MARKER_START,
  MARKER_END,
  RULES,
  EMERGENCY_STOP_CONTEXT,
  DELTA_INSTRUCTION,
  ROTATION_INSTRUCTION,
  COMPRESSED_CHECKLIST,
  DELEGATION_REMINDER,
  CODEX_DELEGATION,
  DEFAULT_NO_EXECUTION,
  EXECUTION_JUDGMENT,
};
