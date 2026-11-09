// scripts/inject-rules.js
const fs = require('fs');
const path = require('path');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir, getStorageRoot, readJsonOrDefault, writeJson } = require('./utils');
const { readIndexSafe } = require('./core/memory-index-file');
const { tryWithMemoryIndex } = require('./core/memory-lock');
const { readIndexRows } = require('./core/index-rows');
const { getRegressingState } = require('./regressing-state');
const { buildRegressingReminder } = require('./core/regressing-reminder');
const { TICKET_DIR, REGRESSING_STATE_FILE, MEMORY_DIR, MEMORY_FILE, INDEX_FILE } = require('./constants');
const { recentLogbookHeadings } = require('./core/memory-context');
const { readStdin } = require('./transcript-utils');
const { COMPRESSED_CHECKLIST: COMPRESSED_CHECKLIST_SHARED } = require('./shared-context');
const {
  FIRST_TURN_RULES,
  buildFirstTurnContext,
  createContextOutput,
} = require('./core/first-turn-context');
const { classifyUserIntent, userAuthoredText } = require('./core/turn-intent');
const { notePrompt, latestUserIntent } = require('./core/turn-state');
const { memoryNotices, noticeText, checkDeltaPending, checkRotationPending } = require('./core/memory-notice');
const { runExecutionLifecycle } = require('./core/execution-lifecycle');
const { buildWorkflowContext } = require('./core/workflow-context');
const { noteExecutionAuthorization, interruptWork } = require('./core/completion-control');

// Emergency stop keywords - when detected, replaces entire context with EMERGENCY STOP
const EMERGENCY_KEYWORDS = ['아시발멈춰', 'BRAINMELT'];

// Bailout keywords - when detected, resets feedback pressure to L0
const BAILOUT_KEYWORDS = ['봉인해제', 'UNLEASH'];

// Only the words the user typed count (D168): a task report or another session's message
// that quotes a keyword, such as a worker reading this file, does not stop or reset anything.
const typedByUser = hookData => userAuthoredText((hookData && (hookData.prompt || hookData.input)) || '');

function checkEmergencyStop(hookData) {
  const input = typedByUser(hookData);
  return EMERGENCY_KEYWORDS.some(kw => input.includes(kw));
}

function detectBailout(hookData) {
  const input = typedByUser(hookData);
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
    index.feedbackPressure = { level: 0, consecutiveCount: 0, lastDetectedAt: null, decayCounter: 0, oscillationCount: 0 };
  }
  // Ensure oscillationCount field exists on legacy objects
  if (typeof index.feedbackPressure.oscillationCount !== 'number') {
    index.feedbackPressure.oscillationCount = 0;
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

const EMERGENCY_STOP_CONTEXT = `
<EXTREMELY_IMPORTANT>
[DIAGNOSTIC RESET] The user triggered a diagnostic reset: your behavior differs from what was intended.

1. STOP all current work now. Do NOT continue your previous task.
2. Read CLAUDE.md now with the Read tool. Do not rely on memory.
3. Go through CLAUDE.md line by line. For EACH rule, explain in your own words what it means and where this session departed from it.
4. After explaining every rule, state what went wrong, as a statement, not a question: which specific rule was violated, in which turn, with the offending phrase quoted. Base it on the re-read and the recent transcript. Do NOT ask the user what you got wrong; the reset already told you something is wrong.
5. Do NOT apologize or make excuses. Show understanding through the statement in step 4.
6. Memory operations (delta, rotation) may continue normally.

This context REPLACES all normal rules. Your ONLY job now is steps 1-5.
</EXTREMELY_IMPORTANT>
`;

// The memory-save and archive-summary notices live in core/memory-notice (D149): once per
// turn, answer-first on non-execution turns. These names keep the before-other-work text.
const DELTA_INSTRUCTION = noticeText('delta', { firm: true });
const ROTATION_INSTRUCTION = noticeText('rotate', { firm: true });

const COMPRESSED_CHECKLIST = COMPRESSED_CHECKLIST_SHARED;

// Parallel work reminder: independent parts run at the same time. Agent/reviewer counts are not completion criteria.
const DELEGATION_REMINDER = `\n## Parallel Work Check\nParts that touch different files and need no result from each other run at the same time: tool calls without a data dependency in one response, larger parts as background workers (a workflow when the user asked for multi-agent work), after checking free memory. Only dependent or shared-file parts run in order. The parent retains the task contract and completion decision. Each worker prompt must include the relevant original request, task and non-goal, authoritative references, read/write scope and the files others are editing, expected observation, direct verification, and claim/evidence/gap return. Exploration and review default to read-only; workers do not fan out. The parent must reopen decisive references, inspect the final diff, and rerun decisive evidence.\n`;

// Codex delegation guidance — Claude host only (/codex:rescue is a Claude Code plugin surface;
// on the Codex host the guidance would be circular).
const CODEX_DELEGATION = `\n## Codex Delegation\n- /codex:rescue: stuck, second opinion, or large handoff. status·result·cancel for background jobs.\n- Model: the latest one available.\n- Launch from the project root — cwd keys the job registry, resume, and sandbox scope.\n- Codex inherits no CLAUDE.md/hooks — put constraints (no commit/push/installs, file scope) in the prompt.\n- "Task started" ≠ done — status --wait, then result; re-verify the diff yourself.\n- Code that reads a host's input (hook payloads, events): hand over a captured real payload — a synthetic shape passes the worker's test and fails on the host.\n- A sandbox error in the worker (git refusing the folder, a blocked namespace) is the sandbox's setup, not the task: report it with the exact message.\n`;

function shouldInjectDelegationReminder(userPrompt, isRegressingActive) {
  if (isRegressingActive) return true;
  if (!userPrompt) return false;
  const keywords = [/parallel/i, /병렬/, /sequential/i, /순차/, /\bagent/i, /에이전트/];
  return keywords.some(kw => kw.test(userPrompt));
}

// getProjectDir, readJsonOrDefault imported from utils.js; readIndexSafe from core/memory-index-file.js


const { MARKER_START, MARKER_END, removeLegacySection } = require('./core/claude-md-rules');
const { RULES, syncClaudeMdRules } = require('./core/rules-text');

// Boolean form kept for existing callers and tests: true unless the sync failed.
function syncRulesToClaudeMd(projectDir) {
  return !syncClaudeMdRules(projectDir).error;
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

// Sections SessionStart already loads as Recent Sessions are not offered again.
function getRelevantMemorySnippets(projectDir, userPrompt) {
  const keywords = extractKeywords(userPrompt);
  if (keywords.length === 0) return null;

  const memoryPath = path.join(getStorageRoot(projectDir), MEMORY_DIR, MEMORY_FILE);
  if (!fs.existsSync(memoryPath)) return null;

  let content;
  try {
    content = fs.readFileSync(memoryPath, 'utf8');
  } catch (e) {
    return null;
  }

  const alreadyLoaded = new Set(recentLogbookHeadings(content));
  const sections = parseMemorySections(content).filter(section => !alreadyLoaded.has(section.heading));
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

    const statusMap = {};
    for (const row of readIndexRows(content)) statusMap[row.id] = row.status;

    const needsUpdate = [];
    for (const tid of ticketIds) {
      const status = statusMap[tid];
      if (status === 'todo' || status === 'in-progress') {
        needsUpdate.push(`${tid} (${status})`);
      }
    }

    if (needsUpdate.length === 0) return null;

    return `\n## \u26A0 Tickets Need Status Update\n${needsUpdate.join(', ')}: update each ticket's results and INDEX.md status before you continue.\n`;
  } catch (e) {
    return null; // fail-open
  }
}

async function main(options = {}) {
  let memoryContext = '';
  try {
    const hookData = options.hookData || await readStdin(1000);
    const projectDir = options.projectDir || getProjectDir();

    // Extract and classify before any optional state mutation.
    // Explicit bailout keywords are user-authorized state resets even when the
    // surrounding prompt is classified as a question/default turn.
    const userPrompt = (hookData && (hookData.prompt || hookData.input)) || '';
    const intent = classifyUserIntent(userPrompt);
    const isBailout = detectBailout(hookData);
    if (require('./core/turn-intent').isStopRequest(userPrompt)) interruptWork(projectDir, hookData);

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
      });
      for (const diagnostic of lifecycle.diagnostics) {
        console.error(`[CRABSHELL ${host} lifecycle] ${diagnostic}`);
      }
      // Every execution prompt, not once per session: a plugin update during a
      // session reaches CLAUDE.md on the next request (D148). No-op when current.
      if (host === 'claude') {
        const synced = syncClaudeMdRules(projectDir);
        if (synced.error) console.error(`[CRABSHELL ${host} lifecycle] Claude rule synchronization failed: ${synced.error}`);
      }
      noteExecutionAuthorization(projectDir, hookData, { host });
    }

    const configPath = path.join(getStorageRoot(projectDir), 'memory', 'config.json');
    const config = readJsonOrDefault(configPath, {});

    const frequency = config.rulesInjectionFrequency || 1;

    // Counter stored in memory-index.json
    const indexPath = path.join(getStorageRoot(projectDir), MEMORY_DIR, INDEX_FILE);
    const memoryDir = path.join(getStorageRoot(projectDir), 'memory');

    // --- RMW (Read-Modify-Write) block — all index mutations inside lock for atomicity ---
    // Lock-fail fallback (fail-open): on lock acquisition failure, still perform the read
    // and compute in-memory state so context injection proceeds, but SKIP the write
    // (prevents lost-update race when another process is mid-write). Warn to stderr.
    const mayMutateState = intent === 'execution' || isBailout;
    let index;
    let isNegativeFeedback;
    let pressureLevel;
    let count;
    const readAndUpdate = idxLocked => {
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
          }
          if (index.tooGoodSkepticism) index.tooGoodSkepticism.retryCount = 0;
          console.error('[PRESSURE BAILOUT: reset all 3 counters]');
        }
        isNegativeFeedback = isBailout ? false : detectNegativeFeedback(userAuthoredText(userPrompt));
        pressureLevel = isBailout ? 0 : updateFeedbackPressure(index, isNegativeFeedback);
        if (pressureLevel > 0) console.error(`[PRESSURE L${pressureLevel}]`);
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
        count = frequency;
      }
    };
    if (!mayMutateState || !tryWithMemoryIndex(memoryDir, () => readAndUpdate(true)).ran) readAndUpdate(false);

    // Check if should inject. The turn record is kept for every prompt (the Stop hooks read
    // the latest user intent); the fixed rule block is added once per host turn (D147_T002).
    const injecting = count % frequency === 0 || frequency === 1;
    const { sameTurn, newTurn } = notePrompt(projectDir, hookData, {
      intent, userAuthored: Boolean(userAuthoredText(userPrompt).trim()), injecting,
    });
    // Memory notices go on the turn's first prompt whether or not the injection frequency
    // adds the fixed block; their wording follows the latest text the user wrote (D149).
    const memory = memoryNotices(projectDir, hookData, {
      host: options.host || 'claude',
      intent: latestUserIntent(projectDir, hookData) || intent,
      newTurn,
      index,
    });
    memoryContext = memory.context;
    if (injecting) {
      // A later prompt of the same turn already has the fixed block in context: only the
      // changing notices below are added.
      let context = sameTurn ? '' : buildFirstTurnContext(projectDir);

      // Codex delegation guidance — Claude host, execution turns only (I083 R2:
      // delegation guidance is only actionable when work is authorized)
      if (!sameTurn && (options.host || 'claude') === 'claude' && intent === 'execution') {
        context += CODEX_DELEGATION;
      }

      context += memory.context;

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
      if (!sameTurn && shouldInjectDelegationReminder(userPrompt, !!workflowReminder)) {
        context += DELEGATION_REMINDER;
      }

      // Prompt-aware memory loading
      const memorySnippets = getRelevantMemorySnippets(projectDir, userPrompt);
      if (memorySnippets) {
        context += memorySnippets;
      }

      // Pressure levels are tracked for telemetry only — no model-visible
      // injection (I083 R4, retired v21.113.0).

      // Output rules via additionalContext (hidden from user, seen by Claude); nothing at
      // all when a later prompt of the turn has no changing notice.
      if (context.trim()) console.log(JSON.stringify(createContextOutput('UserPromptSubmit', context)));

      // Explicit trigger patterns to stderr (visible to Claude)
      for (const line of memory.stderr) console.error(line);
      if (workflowReminder) {
        console.error('[REGRESSING ACTIVE]');
      }
      if (!sameTurn && memory.stderr.length === 0) {
        console.error('[rules injected]');
      }
    } else if (memory.context.trim()) {
      // The injection frequency skipped the fixed block; the memory notices still go out.
      console.log(JSON.stringify(createContextOutput('UserPromptSubmit', memory.context)));
      for (const line of memory.stderr) console.error(line);
    }
  } catch (e) {
    // On error, still try to inject rules (fail-safe)
    console.error('[rules injection error: ' + e.message + ']');

    // Output rules anyway to not break the workflow, with any memory notice already decided.
    const output = createContextOutput('UserPromptSubmit', FIRST_TURN_RULES + memoryContext);
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
  syncClaudeMdRules,
  removeLegacySection,
  parseMemorySections,
  extractKeywords,
  getRelevantMemorySnippets,
  shouldInjectDelegationReminder,
  classifyUserIntent,
  main,
  // Re-export from core/regressing-reminder for convenience
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
};
