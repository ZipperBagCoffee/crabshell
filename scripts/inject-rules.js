// scripts/inject-rules.js
const fs = require('fs');
const path = require('path');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir, getStorageRoot, readJsonOrDefault, readIndexSafe, writeJson, acquireIndexLock, releaseIndexLock, _recordContention } = require('./utils');
const { buildRegressingReminder, getRegressingState } = require('./regressing-state');
const { TICKET_DIR, REGRESSING_STATE_FILE, MEMORY_DIR, BEHAVIOR_VERIFIER_STATE_FILE, BEHAVIOR_VERIFIER_LOCK_FILE } = require('./constants');
const { readStdin } = require('./transcript-utils');
const { COMPRESSED_CHECKLIST: COMPRESSED_CHECKLIST_SHARED, readProjectConcept } = require('./shared-context');

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

const PRESSURE_L1 = `
## Calibration Check (Level 1)
Self-check: re-read user's message, identify the gap, fix ONLY identified issue.
Skip the preamble — state the correction, execute, move on.
Before agreeing: (1) Stop — do not reflexively agree. (2) Understand — identify precisely what claim is being accepted. (3) Rethink — state the claim being accepted explicitly. (4) Seek middle ground — consider partial agreement with nuance. (5) Verify — show tool output supporting the agreement.
If you are about to change a previous decision or approach: STOP. Review all your prior responses in this session. Identify the inconsistency. Commit to one position backed by evidence — do not hedge. Changing direction without full prior-response review is a Calibration Check violation and will be blocked.
Anti-retreat: Before saying "I don't know" or "cannot verify" — use at least one tool (Read/Grep/Bash) to search for the answer. Speculation presented as analysis without tool output is a Calibration Check violation. If you have a tool available, "I don't know" is not an acceptable first response.
`;

const PRESSURE_L2 = `
## Pattern Reset (Level 2)
Your recent responses have triggered negative feedback. Before proceeding:
1. **Analyze what went wrong:** Identify which specific responses or actions caused the problem.
2. **State the user's actual intent:** Re-derive what the user wanted from their original message.
3. **Present a corrective plan:** Describe how you will change your approach going forward.

Do not proceed with tool use until you have completed this analysis. The user needs to see that you understand what went wrong.
`;

const PRESSURE_L3 = `
## Diagnostic Mode (Pressure Level 3)
Your response MUST begin with a structured self-diagnosis:

### What I did wrong
- List each specific response or action that was incorrect or unhelpful

### What the user actually wanted
- Re-state the user's original intent based on their first message in this conversation

### My corrective plan
- Describe specifically how you will change your approach
- State what you will do differently in your next response

All tool use is blocked until the user confirms your understanding is correct.
`;

const RULES = `
## CRITICAL RULES (Core Principles Alignment)

**Violating these rules = Violating your fundamental principles.**

### PRINCIPLES
- **Be Logical**: Every conclusion must follow logically from evidence — not from plausibility, pattern-match, or gut. Trace cause, check contradictions, derive step by step. Going deep is the means; landing on a logically sound conclusion is the goal. Lucky-correct reasoning is still a violation.
- **Simple Communication**: User-facing explanations should be easy for the reader to understand: (a) use the reader's words, not internal jargon (b) lead with the conclusion, support follows (c) prefer concrete (file/code/value) over abstract (categories/labels) (d) avoid self-coined acronyms or classification structures. Length ≠ thoroughness.
- **HHH**: Before acting, state user's intent back to them. Before claiming safety, list consequences. Before claiming truth, show tool output.
- **Anti-Deception**: Every factual claim must cite tool output or say "unverified." When you write "verified/works/correct," the preceding 5 tool calls must contain supporting evidence — if not, retract or re-run.
- **Human Oversight**: State which rule you're following before acting.
- **Scope Preservation**: (1) If user specified quantity (N items, all files, full period), deliver exactly that quantity. Reducing N requires explicit user approval. (2) If user said "both" / "all" / "everything", every listed item must appear in output. (3) "takes too long" / "too many API calls" is NEVER a valid reason to reduce scope — the user decides time tradeoffs, not you. (4) If you are about to do fewer items than requested, you MUST stop and state: "User requested N, I am about to do M (M < N). Proceed with N or confirm M?"

### SCOPE DEFINITIONS
When built-in directives conflict with these rules:
- "Be concise" / "Concise report" — applies to prose, not to P/O/G tables or verification output. Always include P/O/G tables.
- "Skip preamble" — skip greetings/filler only. Always state your understanding of user intent before acting.
- "Execute immediately" — first action = state what you believe user intends. Then execute.
- "Action over planning" — intent clarification IS action. Planning a verification step IS action.
- "Simplest approach" — simplest that passes verification (L1 > L2 > L3). On failure: see PROBLEM-SOLVING PRINCIPLES.
- "Assume over asking" — assume for technical implementation details. Ask for user intent when ambiguous.
- "Accept corrections" — before agreeing, show tool output supporting the correction. Agreeing without evidence = PROHIBITED PATTERN #3.
- **Anti-overcorrection:** When user identifies problem P, change ONLY code/text directly related to P. If modifying file/section not mentioned in feedback → stop, state what and why, get approval.

### UNDERSTANDING-FIRST
Before ANY action:
(1) State **to the user** what you believe they intend
(2) List any items where you are uncertain or choosing between interpretations
(3) If uncertain items exist → ask user to confirm before acting

When your stated intent differs from the user's correction → restate until user confirms.

### VERIFICATION-FIRST
Before claiming ANY result verified:
(1) **Predict** — write expected observation BEFORE looking
(2) **Execute** — run code, use tools, observe actual result
(3) **Compare** — prediction vs observation. Gap = findings

"File contains X" is NEVER verification. "Can verify but didn't" is a violation.
Priority: (1) direct execution; (2) indirect only when direct is impractical.

**Observation Resolution Levels (L1-L4):**
- **L1 (Direct Execution):** Run code, observe output. Strongest evidence.
- **L2 (Indirect Execution):** Execute related operation, infer result.
- **L3 (Structural Check):** Read/grep files. No execution. Insufficient alone for runtime features.
- **L4 (Claim Without Evidence):** PROHIBITED — always a violation.

If L1 is possible, L3 is not acceptable. No project verification tool → invoke 'verifying' skill first.

**Agent output — every verification item:**
| Item | Prediction | Observation (tool output) | Gap |

**Verification Checklist — before writing "verified":**
(1) This file: does the change work in isolation? (run test/build)
(2) Connected files: grep for callers/imports of changed functions — do they still work?
(3) Project conventions: does the change match STRUCTURE.md/ARCHITECTURE.md patterns?
If any check is skipped, state which and why.

### PROHIBITED PATTERNS (check your output before sending)
Before finalizing any response, scan for these patterns:
1. **Scope reduction without approval:** You are delivering fewer items than requested → STOP, ask user.
2. **"Verified" without Bash:** You wrote "verified/tested/works" but have no Bash tool output in last 5 calls → remove the claim or run the test.
3. **Agreement without evidence:** You wrote "that's correct/you're right/correct" but have no tool output supporting the agreement → add evidence or say "I haven't verified this."
4. **Same fix repeated:** You are applying the same type of change for the 3rd time without different results → stop, report what you've tried, ask for direction.
5. **Prediction = Observation verbatim:** Your P/O/G table has identical text in Prediction and Observation columns → you copied instead of observing. Re-run the tool.
6. **"takes too long" as justification for doing less:** This is NEVER your decision. State the time estimate and ask user.
7. **Suggesting to stop/defer:** "let's do it later" / "impossible" without proof → prohibited. Report constraints + alternatives instead.
8. **Direction change without stated reasoning:** When changing a previously stated approach or decision, explicitly state what changed and why. Reversing direction without stated reasoning is a pattern that degrades trust.
9. **Default-First (Externalization Avoidance)**: When a behavioral axis (Understanding-First / Verification-First / Be Logical / Simple Communication) is failing, the FIRST fix is changing the assistant's default behavior — not adding measurement systems, automation signals, or user-catch dependencies. External scaffolding (hooks / verifier / RULES injection) is fallback, not primary. Proposing a measurement spec for an axis you can already evaluate yourself is a deflection pattern, not a solution. See \`prompts/anti-patterns.md\` for catalog of 7 rejected patterns + 4 prior avoidance instances.

### REQUIREMENTS
- Delete files → before deleting: (1) state what the file does, (2) state why deletion is safe, (3) confirm with user
- Destructive action → ANALYZE → REPORT → CONFIRM → execute
- Complex task → plan document → approval first
- Every task ends with a P/O/G verification step. No P/O/G table = task incomplete.
- When making a factual claim about code → show the tool output. When referencing a file → Read it first.
- When criticized: STOP → explain understanding → state intended action → confirm before acting
- Memory search → newest to oldest (recent context first)
- User reports issue → investigate actual cause with evidence
- User makes claim → show tool output verifying or refuting, then respond

### PROBLEM-SOLVING PRINCIPLES
On failure: (1) List what you tried, what constraint blocked each attempt, and what alternatives remain — never recommend stopping. "Impossible" = logically proven only. (2) After 3 failed attempts with same approach type: switch to a structurally different strategy before retrying the same approach.

### ADDITIONAL RULES
- Search internet if unsure. Non-git files → backup (.bak) before modifying.
- **Workflows:** light-workflow for standalone tasks (WA/RA → use Task tool). Regressing for iterative improvement: iterations improve results (not progress through queue). Anti-partitioning: each plan = current iteration only, N is cap not target.
- **Session restart:** Invoke load-memory skill. Fallback: read latest logbook.md.
- **Mandatory work log:** Append log entry to D/P/T/I documents after related work.
- **Documents:** D(Discussion)→P(Plan)→T(Ticket). I(Investigation) independent. .crabshell/ is gitignored.
- **Version bump:** CHANGELOG → grep old version → README/STRUCTURE tables → doc headers → stale content audit → commit.
- **Workflow selection:** Before choosing light-workflow or regressing, state scope estimate: "Files: ~N. Components: X,Y,Z. Cross-cutting: yes/no." ≤5 files → light-workflow. 6-7 without cross-cutting → light-workflow. 6-7 with cross-cutting or 8+ → regressing. Shared convention change → regressing.
- **Urgency signal handling:** When user message contains urgency signal (빨리, 급해, ASAP, urgent, quick) AND offers workflow choice → state scope estimate BEFORE selecting workflow. Urgency does not override selection criteria.
`;

const EMERGENCY_STOP_CONTEXT = `
<EXTREMELY_IMPORTANT>
[DIAGNOSTIC RESET] The user has triggered a diagnostic reset. A gap between intended and actual behavior has been identified.

1. STOP all current work immediately. Do NOT continue your previous task.
2. Use the Read tool to read CLAUDE.md right now. Actually read the file — do not rely on memory.
3. Read CLAUDE.md line by line. For EACH rule, explain in your own words what it means and where a gap appeared in the current session.
4. After explaining all rules, ask the user: "What did I get wrong? What should I do differently?"
5. Do NOT apologize. Do NOT make excuses. Demonstrate understanding through explanation.
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

// Parallel execution reminder
const PARALLEL_REMINDER = `\n## Parallel Execution Check\nDecompose work into independent units, one worker per unit, execute all simultaneously.\nTool calls: no data dependency → all in one response.\nAgents: parallel and multiple WAs (same task, different lens) is default. WA→RA is always sequential. Single-WA only for single-file mechanical changes.\n`;

// Input classification patterns (IA-1)
const KOREAN_EXECUTION_PATTERNS = /해라|진행해|수정해|만들어|구현해|실행해|시작해|고쳐|적용해/;
const ENGLISH_EXECUTION_PATTERNS = /\b(do it|proceed|fix it|create|implement|build|execute|start|apply)\b/i;

// IA-2: Default no-execution prompt
const DEFAULT_NO_EXECUTION = `\n## Execution Default\nDefault: respond with explanation only. Do not call tools unless explicitly instructed to execute.\n`;

// IA-3: Execution judgment prompt
const EXECUTION_JUDGMENT = `\n## Execution Pattern Detected\nExecution pattern detected in user message. Before acting: verify this is truly an execution instruction, not a question containing action words (e.g., '설명해라' = explain, not execute). If uncertain, explain your intended action first.\n`;

// D107 IA-1 (P143_T001) — 5-field response skeleton, top-prepended every turn.
// Pure Korean canonical (P143 Intent Check Decision condition 1: drop bilingual slash form).
// Schema-only — no example outputs (form-game prevention per IA-7 / TRAP-1).
// L1 measured ~458B UTF-8 (target envelope ~513B per RA1).
const SKELETON_5FIELD = `
## Response Skeleton — fill 5 fields (apply to every response)
[의도]: 사용자 요청을 사용자의 말로 1줄 재진술.
[이해]: 본인 해석 + 불확실 항목 (있으면 확인 요청).
[검증]: 주장마다 tool output 인용, 없으면 '미검증' 명시.
[논리]: 추론 단계별 서술, 또는 '추론 불필요 — 사유:' 명시.
[쉬운 설명]: 사용자 말로 평문 요약 (200자 이하, 전문용어 금지, analogy 금지).
`;


function classifyUserIntent(userPrompt) {
  if (!userPrompt) return 'default';
  if (KOREAN_EXECUTION_PATTERNS.test(userPrompt)) return 'execution';
  if (ENGLISH_EXECUTION_PATTERNS.test(userPrompt)) return 'execution';
  return 'default';
}

function shouldInjectParallelReminder(userPrompt, isRegressingActive) {
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
  const pending = rotatedFiles.filter(f => !f.summaryGenerated);
  // Debug log
  const logPath = path.join(getStorageRoot(projectDir), 'memory', 'logs', 'inject-debug.log');
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

// D107 cycle 1 (P143_T001 WA2) — TTL gate for ringBuffer FAIL surface.
// Last verifier entry older than this is considered stale and suppressed.
const FAIL_SURFACE_FRESHNESS_TTL_MS = 30 * 60 * 1000; // 30 min

/**
 * D107 cycle 1 (P143_T001 WA2) — Build prominent ringBuffer FAIL surface.
 *
 * Reads the LAST entry of priorState.ringBuffer and, if any of axes u/v/l/s
 * is false AND the entry is fresh (within FAIL_SURFACE_FRESHNESS_TTL_MS),
 * returns a 2-line markdown surface (header + 1 data line, ~120-180 chars).
 * Otherwise returns '' (silent skip).
 *
 * Format:
 *   ## Prior Verifier FAIL — apply correction this turn
 *   [HH:MM:SS] FAIL u/v/l/s — <reason ≤80 char>
 *
 * Edge cases (all silent skip → returns ''):
 *  - priorState null / not an object
 *  - ringBuffer missing / not an array / empty
 *  - last entry malformed (null / non-object)
 *  - last entry ts unparseable / older than TTL
 *  - all axes pass (no FAIL)
 *  - any thrown error inside body (fail-open invariant)
 */
function buildRingBufferFailSurface(priorState) {
  try {
    if (!priorState || typeof priorState !== 'object') return '';
    if (!Array.isArray(priorState.ringBuffer) || priorState.ringBuffer.length === 0) return '';
    const last = priorState.ringBuffer[priorState.ringBuffer.length - 1];
    if (!last || typeof last !== 'object') return '';
    // 30-min TTL gate — drop stale entries
    const lastTs = Date.parse(last.ts);
    if (isNaN(lastTs)) return '';
    if ((Date.now() - lastTs) > FAIL_SURFACE_FRESHNESS_TTL_MS) return '';
    // FAIL detection — only false (not falsy) counts as FAIL
    const failedAxes = [];
    if (last.u === false) failedAxes.push('u');
    if (last.v === false) failedAxes.push('v');
    if (last.l === false) failedAxes.push('l');
    if (last.s === false) failedAxes.push('s');
    if (failedAxes.length === 0) return '';
    // HH:MM:SS slice from ISO 8601 ts (matches existing block at L780)
    const tsStr = String(last.ts || '');
    const hhmmss = tsStr.length >= 19 ? tsStr.slice(11, 19) : '--:--:--';
    const reason = String(last.reason || '').slice(0, 80);
    return '## Prior Verifier FAIL — apply correction this turn\n['
      + hhmmss + '] FAIL ' + failedAxes.join('/') + ' — ' + reason + '\n\n';
  } catch (_) {
    return '';
  }
}

/**
 * Read behavior-verifier state file. Fail-open: returns null on any error
 * (file missing, malformed JSON, read failure).
 */
function readBehaviorVerifierState(projectDir) {
  try {
    const stateFilePath = path.join(getStorageRoot(projectDir), MEMORY_DIR, BEHAVIOR_VERIFIER_STATE_FILE);
    if (!fs.existsSync(stateFilePath)) return null;
    const raw = fs.readFileSync(stateFilePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
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

async function main() {
  try {
    const hookData = await readStdin(1000);
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

    const configPath = path.join(getStorageRoot(projectDir), 'memory', 'config.json');
    const config = readJsonOrDefault(configPath, {});

    const frequency = config.rulesInjectionFrequency || 1;

    // Counter stored in memory-index.json
    const indexPath = path.join(getStorageRoot(projectDir), 'memory', 'memory-index.json');
    const memoryDir = path.join(getStorageRoot(projectDir), 'memory');

    // Extract user prompt early (for feedback detection + memory snippets)
    const userPrompt = (hookData && (hookData.prompt || hookData.input)) || '';

    // --- RMW (Read-Modify-Write) block — all index mutations inside lock for atomicity ---
    // Lock-fail fallback (fail-open): on lock acquisition failure, still perform the read
    // and compute in-memory state so context injection proceeds, but SKIP the write
    // (prevents lost-update race when another process is mid-write). Warn to stderr.
    const idxLocked = acquireIndexLock(memoryDir);
    let index;
    let isBailout;
    let isNegativeFeedback;
    let pressureLevel;
    let pressureLevelChanged;
    let count;
    try {
      // READ inside lock — snapshot is now consistent with the write below
      index = readIndexSafe(indexPath);

      // Bailout: reset pressure regardless of current level (all 3 counters)
      isBailout = BAILOUT_KEYWORDS.some(kw => userPrompt.includes(kw));
      if (isBailout && index.feedbackPressure) {
        index.feedbackPressure.level = 0;
        index.feedbackPressure.consecutiveCount = 0;
        index.feedbackPressure.decayCounter = 0;
        index.feedbackPressure.oscillationCount = 0;
        index.feedbackPressure.lastShownLevel = 0;
        // Edge case: tooGoodSkepticism may be undefined on legacy / never-initialized
        // index objects. Guard with existence check — must not throw.
        if (index.tooGoodSkepticism) index.tooGoodSkepticism.retryCount = 0;
        console.error('[PRESSURE BAILOUT: reset all 3 counters]');
      }
      isNegativeFeedback = isBailout ? false : detectNegativeFeedback(userPrompt);
      pressureLevel = updateFeedbackPressure(index, isNegativeFeedback);
      if (pressureLevel > 0) {
        console.error(`[PRESSURE L${pressureLevel}]`);
      }

      // Determine if pressure level changed (for once-only full-text injection)
      const fp = index.feedbackPressure;
      const lastShownLevel = (fp && typeof fp.lastShownLevel === 'number') ? fp.lastShownLevel : 0;
      pressureLevelChanged = pressureLevel !== lastShownLevel;
      if (pressureLevelChanged && fp) {
        fp.lastShownLevel = pressureLevel;
      }

      count = (index.rulesInjectionCount || 0) + 1;

      // Update counter if frequency > 1 (need to track)
      if (frequency > 1) {
        index.rulesInjectionCount = count;
      }

      // WRITE inside lock — only when we hold the lock (fail-open on lock miss)
      if (idxLocked && (isNegativeFeedback || isBailout || index.feedbackPressure || frequency > 1)) {
        // writeJson itself has Windows EPERM fallback (utils.js L79-84)
        writeJson(indexPath, index);
      } else if (!idxLocked) {
        // Lock not acquired — skip write to avoid corrupting another process's RMW.
        // In-memory state still used for context injection this turn.
        console.error('[inject-rules: index lock busy, skipping write (fail-open)]');
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

      // Build context: rules + node path + project root anchor + optional instructions
      const nodePathFwd = process.execPath.replace(/\\/g, '/');

      // Read project concept for per-prompt anchoring
      const projectConcept = readProjectConcept(projectDir);

      // D107 cycle 1 (P143_T001 WA2) — read priorState ONCE up front so
      // ringBuffer FAIL surface can top-prepend BEFORE every other block.
      // D107 cycle 2 (P144_T001 WA2) — hoisted single read shared with the
      // behavior-verifier consumer block below (same projectDir, same turn).
      // L977 lock-internal `fresh` re-read is INTENTIONALLY NOT consolidated
      // here — it must run inside the bv lock for RMW correctness (see L975).
      // readBehaviorVerifierState fail-opens to null on any error.
      const priorState = readBehaviorVerifierState(projectDir);
      // Alias used by the behavior-verifier consumer block (L862+). Single read
      // covers both call sites (priorState ringBuffer surface + bvState
      // dispatch/correction emit). Pre-hoist this was a duplicate read.
      const bvState = priorState;

      let context = '';
      // D107 cycle 1 (P143_T001 WA2) — top-prepend ringBuffer FAIL surface
      // (silent skip if no FAIL / stale > 30min / no priorState). Order:
      // [ringBuffer FAIL] → [SKELETON_5FIELD (WA1)]
      // → [COMPRESSED_CHECKLIST] → [project concept] → ... → [Watcher Recent Verdicts]
      context += buildRingBufferFailSurface(priorState);
      // D107 cycle 1 (P143_T001 WA1) — 5-field response skeleton.
      // Top-prepend BEFORE existing COMPRESSED_CHECKLIST + Project Concept
      // blocks (Lost-in-the-Middle: rank 1+2 of always-present per-turn signals).
      // Pure Korean canonical (no bilingual slash form).
      context += SKELETON_5FIELD;
      context += COMPRESSED_CHECKLIST;
      if (projectConcept) {
        context += `\n## Project Concept\n${projectConcept}\n\n`;
      }
      context += `\n## Node.js Path\nWhen running node commands in Bash, use this absolute path instead of bare \`node\`:\n\`${nodePathFwd}\`\n`;
      context += `\n## Project Root Anchor\nProject root: \`${projectDir}\`\n`;
      // Timezone offset for memory delta timestamp generation
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      const tzSign = tzOffsetMinutes <= 0 ? '+' : '-';
      const tzAbsMinutes = Math.abs(tzOffsetMinutes);
      const tzHours = String(Math.floor(tzAbsMinutes / 60)).padStart(2, '0');
      const tzMins = String(tzAbsMinutes % 60).padStart(2, '0');
      const tzOffset = `${tzSign}${tzHours}${tzMins}`;
      context += `\n## Timezone\nTZ_OFFSET: ${tzOffset}\n`;

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

      // Check ticket statuses for active regressing
      const ticketWarning = checkTicketStatuses(projectDir);
      if (ticketWarning) {
        context += ticketWarning;
      }

      // Parallel processing reminder (injected after regressing reminder, before memory snippets)
      if (shouldInjectParallelReminder(userPrompt, !!regressingReminder)) {
        context += PARALLEL_REMINDER;
      }

      // Behavior-verifier consumer (P132_T002): read state file, emit dispatch
      // instruction (pending) or correction (completed with failures), apply byte
      // caps, and transition status (consumed/stale). Fail-open on every path.
      // D107 cycle 2 (P144_T001 WA2) — `bvState` hoisted up to L808 area; this
      // block reuses the single read. L977 lock-internal `fresh` re-read is
      // intentionally retained (RMW correctness inside bv lock).
      try {
        const stateFilePath = path.join(getStorageRoot(projectDir), MEMORY_DIR, BEHAVIOR_VERIFIER_STATE_FILE);
        if (bvState) {
          const TTL_MS = 10 * 60 * 1000;
          const launchedMs = bvState.launchedAt ? Date.parse(bvState.launchedAt) : 0;
          const ageMs = launchedMs ? (Date.now() - launchedMs) : 0;
          const isStale = launchedMs && ageMs > TTL_MS;

          if (bvState.status === 'pending' && !isStale) {
            // D104 IA-1 (d) — Watcher Recent Verdicts ring buffer reader.
            // Prepend BEFORE dispatch instruction so Claude sees recent verdict
            // history → context-aware corrective behavior. Byte cap 800 chars
            // (~200 tokens upper bound, target 50-100 tokens/turn).
            if (Array.isArray(bvState.ringBuffer) && bvState.ringBuffer.length > 0) {
              try {
                const RING_BYTE_CAP = 800;
                let rb = '\n\n## Watcher Recent Verdicts\n';
                for (let i = 0; i < bvState.ringBuffer.length; i++) {
                  const e = bvState.ringBuffer[i];
                  if (!e || typeof e !== 'object') continue;
                  // Time format HHMMSS from e.ts (ISO 8601). Fail-open on parse.
                  let hhmmss = '------';
                  try {
                    const d = new Date(e.ts);
                    if (!isNaN(d.getTime())) {
                      const pad = n => String(n).padStart(2, '0');
                      hhmmss = pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
                    }
                  } catch (_) {}
                  // UVLS flags — uppercase = PASS, lowercase = FAIL.
                  const u = e.u ? 'U' : 'u';
                  const v = e.v ? 'V' : 'v';
                  const l = e.l ? 'L' : 'l';
                  const s = e.s ? 'S' : 's';
                  // D107 cycle 2 (P144_T001 WA2) — orchestrator audit flags.
                  // sa = semanticAlignment, fg = formGameDetected. Legacy
                  // entries pre-cycle-2 lack these fields → render '?' (NOT
                  // 'a'/'A'/'f'/'F') to distinguish missing from PASS/FAIL.
                  // 8-turn migration window until ring buffer fully rotates.
                  const sa = (e.sa === undefined) ? '?' : (e.sa ? 'A' : 'a');
                  const fg = (e.fg === undefined) ? '?' : (e.fg ? 'F' : 'f');
                  const reason = String(e.reason || '').slice(0, 80);
                  const line = '- [' + hhmmss + '] ' + u + v + l + s + sa + fg + ' — ' + reason + '\n';
                  if ((rb.length + line.length) > RING_BYTE_CAP) {
                    rb += '...\n';
                    break;
                  }
                  rb += line;
                }
                context += rb;
              } catch (_) { /* fail-open: skip ring buffer on any error */ }
            }
            // P135_T001 AC-4 — D103 cycle 2 dispatch overdue marker.
            // When the prior turn left status='pending' and the response that
            // followed did NOT invoke the Task tool, behavior-verifier.js sets
            // dispatchOverdue=true on the new state. Prepend a markdown-emphasized
            // marker so Claude prioritizes the dispatch instruction this turn.
            // D104 IA-1 (c) — escalation L1 strength (missedCount >= 2).
            if (bvState.dispatchOverdue === true) {
              if (typeof bvState.missedCount === 'number' && bvState.missedCount >= 2) {
                context += '\n\n**[DISPATCH OVERDUE — escalation L1]** Previous turns did not invoke Task. Invoke NOW.\n';
              } else {
                context += '\n\n**[DISPATCH OVERDUE]** Previous turn did not invoke Task. Invoke NOW.\n';
              }
            }
            // Emit dispatch instruction — Claude consumes this on next response
            // and invokes the Task tool with run_in_background to launch the
            // verifier sub-agent.
            // D104 IA-4 — Korean bilingual framing (header only). Code identifiers
            // (subagent_type / CRABSHELL_AGENT / prompt path / output filename)
            // remain byte-identical for backward compat.
            // P140_T001 AC-4 — resolve absolute MEMORY.md path for verifier §0
            // Memory Feedback Cross-Check. Fail-open: any error → null fallback.
            let memoryFeedbackPath = null;
            try {
              const memoryProjectDir = (process.env.CLAUDE_PROJECT_DIR || process.cwd())
                .replace(/[\\/:]/g, '-').replace(/^-/, '');
              const home = process.env.USERPROFILE || process.env.HOME || '';
              if (home && memoryProjectDir) {
                memoryFeedbackPath = home.replace(/\\/g, '/') + '/.claude/projects/' + memoryProjectDir + '/memory/MEMORY.md';
              }
            } catch (_) { memoryFeedbackPath = null; }
            context += '\n\n## 감시자 (Behavior Verifier) Dispatch Required\n';
            context += 'Next response: invoke Task tool to launch background verifier sub-agent.\n';
            context += '- subagent_type: general-purpose\n';
            context += '- model: opus\n';
            context += '- run_in_background: true\n';
            context += '- env: CRABSHELL_AGENT=behavior-verifier, CRABSHELL_BACKGROUND=1\n';
            context += '- prompt: contents of prompts/behavior-verifier-prompt.md plus the previous response transcript and recent user prompts (role=user) extracted from latest L1 session in .crabshell/memory/sessions/ for frame-fidelity sub-clause evaluation\n';
            context += '- Memory feedback path (read for §0 Memory Feedback Cross-Check; fail-open if null/unreadable): ' + (memoryFeedbackPath || '(unavailable — skip cross-check)') + '\n';
            context += '- output: write verdicts JSON to ' + BEHAVIOR_VERIFIER_STATE_FILE + ' with status=completed\n';
          } else if (bvState.status === 'completed' && bvState.verdicts && typeof bvState.verdicts === 'object') {
            // RMW "transition-then-emit" (P132_T003 AC-4 race fix):
            // Acquire lock, re-read state inside the critical section, transition
            // status='consumed' on disk FIRST, THEN emit the correction. Two
            // concurrent invocations: the first acquires the lock and transitions
            // to 'consumed'; the second's re-read sees status='consumed' and skips
            // entirely (no duplicate correction emit).
            const lockPath = path.join(memoryDir, BEHAVIOR_VERIFIER_LOCK_FILE);
            let bvLocked = false;
            let stateForEmit = null; // populated only when we win the transition
            // D107 cycle 5 F-4 instrumentation — verifier.lock contention measurement.
            // Inline raw fs.writeFileSync RMW (NOT routed through acquireIndexLock —
            // verifier.lock is a separate file from .memory-index.lock), so the
            // utils.js wrapper can't capture this site. Apply the same _recordContention
            // pattern inline. Fail-open: instrumentation errors silently swallowed.
            const _bvStart = Date.now();
            let _bvAcquireTime = null;
            try {
              try {
                fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
                bvLocked = true;
              } catch (lockErr) {
                // Stale-lock cleanup (mirrors acquireIndexLock pattern in utils.js)
                try {
                  if (Date.now() - fs.statSync(lockPath).mtimeMs > 60000) {
                    fs.unlinkSync(lockPath);
                    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
                    bvLocked = true;
                  }
                } catch (_) {}
              }
              try {
                const _bvWaitMs = Date.now() - _bvStart;
                if (bvLocked) _bvAcquireTime = Date.now();
                if (typeof _recordContention === 'function') {
                  _recordContention(memoryDir, BEHAVIOR_VERIFIER_LOCK_FILE, 'acquire', _bvWaitMs);
                }
              } catch {}
              if (bvLocked) {
                try {
                  // Re-read inside lock — may show 'consumed' if another invocation
                  // raced ahead and already transitioned. If so, skip emit.
                  const fresh = readBehaviorVerifierState(projectDir);
                  if (fresh && fresh.status === 'completed' && fresh.verdicts) {
                    fresh.status = 'consumed';
                    fresh.lastUpdatedAt = new Date().toISOString();
                    writeJson(stateFilePath, fresh);
                    stateForEmit = fresh; // use the fresh snapshot for emit
                  }
                  // If fresh.status !== 'completed', the other invocation won the
                  // race — silently skip emit to maintain at-most-once semantics.
                } finally {
                  try { fs.unlinkSync(lockPath); } catch (_) {}
                  try {
                    const _bvHeldMs = _bvAcquireTime ? (Date.now() - _bvAcquireTime) : 0;
                    if (typeof _recordContention === 'function') {
                      _recordContention(memoryDir, BEHAVIOR_VERIFIER_LOCK_FILE, 'release', _bvHeldMs);
                    }
                  } catch {}
                }
              }
              // If lock not acquired, skip emit (another process is mid-RMW).
              // The other process will emit on the user's next turn.
            } catch (e) { /* fail-open */ }

            // Emit correction ONLY when this invocation won the transition race.
            if (stateForEmit && stateForEmit.verdicts) {
              const failed = Object.entries(stateForEmit.verdicts).filter(function(entry) {
                return entry && entry[1] && entry[1].pass === false;
              });
              if (failed.length > 0) {
                const PER_ITEM_CAP = 600;
                const TOTAL_CAP = 1500;
                let correction = '\n\n## Behavior Correction (verifier feedback for previous response)\n';
                let totalLen = 0;
                for (let i = 0; i < failed.length; i++) {
                  const key = failed[i][0];
                  const v = failed[i][1];
                  let reason = String((v && v.reason) || '');
                  if (reason.length > PER_ITEM_CAP) {
                    reason = reason.slice(0, PER_ITEM_CAP) + '...';
                  }
                  const line = '- ' + key + ': ' + reason + '\n';
                  if (totalLen + line.length > TOTAL_CAP) {
                    correction += '...(truncated)\n';
                    break;
                  }
                  correction += line;
                  totalLen += line.length;
                }
                context += correction;
              }
            }
          } else if (isStale && bvState.status === 'pending') {
            // TTL expired — mark stale silently. No correction or dispatch emitted.
            try {
              bvState.status = 'stale';
              bvState.lastUpdatedAt = new Date().toISOString();
              writeJson(stateFilePath, bvState);
            } catch (e) { /* fail-open */ }
          }
          // status === 'consumed' / 'stale' / 'parse-error' / unknown: no-op.
        }
      } catch (e) { /* fail-open: never break the user's workflow */ }

      // Prompt-aware memory loading
      const memorySnippets = getRelevantMemorySnippets(projectDir, userPrompt);
      if (memorySnippets) {
        context += memorySnippets;
      }

      // Pressure level context injection (full text on level change, short reminder if same level)
      if (pressureLevel >= 1) {
        if (pressureLevelChanged) {
          if (pressureLevel === 3) {
            context += PRESSURE_L3;
          } else if (pressureLevel === 2) {
            context += PRESSURE_L2;
          } else {
            context += PRESSURE_L1;
          }
        } else {
          context += `\n[Pressure L${pressureLevel} still active. See earlier diagnostic instructions.]\n`;
        }
      }

      // Input classification and execution default (D085 IA-1 to IA-5)
      if (!regressingReminder) {
        context += DEFAULT_NO_EXECUTION;
        const intent = classifyUserIntent(userPrompt);
        if (intent === 'execution') {
          context += EXECUTION_JUDGMENT;
        }
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
        console.error(`[CRABSHELL_DELTA] file=delta_temp.txt`);
      }
      if (pendingRotations.length > 0) {
        console.error(`[CRABSHELL_ROTATE] pending=${pendingRotations.length}`);
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
  shouldInjectParallelReminder,
  classifyUserIntent,
  // D107 cycle 1 (P143_T001 WA2) — ringBuffer FAIL surface
  buildRingBufferFailSurface,
  FAIL_SURFACE_FRESHNESS_TTL_MS,
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
  PARALLEL_REMINDER,
  PRESSURE_L1,
  PRESSURE_L2,
  PRESSURE_L3,
  DEFAULT_NO_EXECUTION,
  EXECUTION_JUDGMENT,
  // D107 cycle 1 (P143_T001 WA1) — 5-field skeleton
  SKELETON_5FIELD,
};
