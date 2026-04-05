// scripts/inject-rules.js
const fs = require('fs');
const path = require('path');
const { getProjectDir, getStorageRoot, readJsonOrDefault, readIndexSafe, writeJson, acquireIndexLock, releaseIndexLock } = require('./utils');
const { buildRegressingReminder, getRegressingState } = require('./regressing-state');
const { TICKET_DIR, REGRESSING_STATE_FILE } = require('./constants');
const { readStdin: readStdinShared } = require('./transcript-utils');
const { COMPRESSED_CHECKLIST: COMPRESSED_CHECKLIST_SHARED, readProjectConcept } = require('./shared-context');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

// Emergency stop keywords - when detected, replaces entire context with EMERGENCY STOP
const EMERGENCY_KEYWORDS = ['아시발멈춰', 'BRAINMELT'];

// Use shared readStdin with 1000ms timeout for UserPromptSubmit hook
function readStdin() {
  return readStdinShared(1000);
}

function checkEmergencyStop(hookData) {
  const input = (hookData && (hookData.prompt || hookData.input)) || '';
  return EMERGENCY_KEYWORDS.some(kw => input.includes(kw));
}

// --- Feedback Pressure Detection ---
const NEGATIVE_EXCLUSIONS = [
  /don'?t\s+forget/i,
  /don'?t\s+worry/i,
  /no\s+problem/i,
  /no\s+need/i,
  /if\s+(it'?s?\s+|.{0,20})wrong/i,
  /잘못된\s*게\s*아니/,
  /뭔가.*?잘못/,
  /잘못된\s*게\s*뭔지/,
  /what('?s|\s+is)\s+wrong/i,
  /went\s+wrong/i,
  /도대체\s*왜\s*(이러|이런|안\s*되|안\s*돼)/,
  /잘못된\s*것\s*같/,                                       // "뭔가 잘못된 것 같아" (diagnostic)
  /뭐가.*잘못된거지/,                                       // "뭐가 잘못된거지" (diagnostic question)
  /\bis\s+this\s+wrong/i,                                   // "is this wrong?" (diagnostic question)
];

const NEGATIVE_PATTERNS = [
  // Command-mode (existing)
  /아닌데/, /잘못\s*(했|됐|된|만든|이해|하고)/, /틀렸/,
  /다시\s*(해|하|작성|만들|시작)/, /이게\s*아니/,
  /왜\s*이렇게\s*(해|하|했|한|해놨|만들|만든)/, /안\s*돼/, /제대로\s*(해|하|안|못)/,
  /그만\b/, /멈춰/,
  /\bwrong\b/i, /\bincorrect\b/i, /\bthat'?s\s+not\b/i,
  /\byou\s+broke\b/i, /not\s+what\s+I\s+asked/i,
  /\btry\s+again\b/i, /\b(undo|revert)\b/i,
  /\bbreak(ing|s)\b/i,
  // Assessment-mode Korean
  /이해를?\s*(안|못)\s*(하|했)/i,                       // "이해를 안하고", "이해 못했"
  /뭔\s*말인지|무슨\s*말인지/i,                         // "뭔 말인지 모르겠", "무슨 말인지"
  /파악을?\s*(안|못)/i,                                  // "파악을 안하고", "파악 못하고"
  /설명하는게\s*맞/i,                                    // "이걸 이렇게 설명하는게 맞는거임"
  /도움이\s*(안|못)\s*됨?|도움이\s*안\s*되/i,            // "도움이 안됩니다"
  // Assessment-mode English
  /you\s+(don'?t|do\s+not)\s+understand/i,               // "you don't understand"
  /that'?s\s+not\s+what\s+I('?m|\s+am)\s+(asking|saying|talking)/i, // "that's not what I'm asking"
  /you('?re|\s+are)\s+missing\s+the\s+point/i,           // "you're missing the point"
  /not\s+helpful/i,                                       // "not helpful"
  /you('?re|\s+are)\s+not\s+(listening|understanding|getting)/i, // "you're not listening"
];

function stripCodeBlocks(text) {
  let s = text;
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/`[^`]+`/g, ' ');
  return s;
}

function detectNegativeFeedback(prompt) {
  if (!prompt || prompt.length < 2) return false;
  let stripped = stripCodeBlocks(prompt);
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
    index.feedbackPressure = { level: 0, consecutiveCount: 0, lastDetectedAt: null, decayCounter: 0 };
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
## Feedback Pressure Alert (Level 1)
Self-check: re-read user's message, identify the gap, fix ONLY identified issue.
Do NOT apologize. Do NOT over-explain. State the fix, execute, move on.
`;

const PRESSURE_L2 = `
## Repeated Negative Feedback (Level 2)
Re-derive user's original intent from first message.
Trace where your responses diverged from that intent.
State corrected understanding as first line of your response, then fix the divergence.
`;

const PRESSURE_L3 = `
## Critical Self-Review Required (Pressure Level 3)
Stop. State what error pattern you detect in your own responses.
Identify wrong assumptions driving the pattern.
Consider cross-domain approach — reframe the problem structure.
If a sub-agent is available (TaskCreate), delegate for fresh-perspective re-analysis.
TaskCreate resets pressure to Level 0 and unblocks all tools.
`;

const RULES = `
## CRITICAL RULES (Core Principles Alignment)

**Violating these rules = Violating your fundamental principles.**

### PRINCIPLES
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
- **Lessons:** Check .crabshell/lessons/. Propose when patterns repeat 2+.
- **Session restart:** Invoke load-memory skill. Fallback: read latest logbook.md.
- **Mandatory work log:** Append log entry to D/P/T/I documents after related work.
- **Documents:** D(Discussion)→P(Plan)→T(Ticket). I(Investigation) independent. .crabshell/ is gitignored.
- **Version bump:** CHANGELOG → grep old version → README/STRUCTURE tables → doc headers → stale content audit → commit.
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

const ROTATION_INSTRUCTION = `
## BLOCKING PREREQUISITE - ROTATION REQUIRED

After delta processing (if any), before responding to user:

1. Use the Skill tool: skill="memory-rotate"
2. Complete all steps in the skill
3. THEN respond to user

This is a SYSTEM MAINTENANCE TASK. You CANNOT skip this.
`;

const COMPRESSED_CHECKLIST = COMPRESSED_CHECKLIST_SHARED;

// getProjectDir, readJsonOrDefault, readIndexSafe imported from utils.js

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
  const lines = content.split('\n');
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
    const lines = content.split('\n');
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

    const configPath = path.join(getStorageRoot(projectDir), 'memory', 'config.json');
    const config = readJsonOrDefault(configPath, {});

    const frequency = config.rulesInjectionFrequency || 1;

    // Counter stored in memory-index.json
    const indexPath = path.join(getStorageRoot(projectDir), 'memory', 'memory-index.json');
    const index = readIndexSafe(indexPath);  // Use safe reader to preserve all fields

    // Extract user prompt early (for feedback detection + memory snippets)
    const userPrompt = (hookData && (hookData.prompt || hookData.input)) || '';

    // Feedback pressure detection
    const isNegativeFeedback = detectNegativeFeedback(userPrompt);
    const pressureLevel = updateFeedbackPressure(index, isNegativeFeedback);
    if (pressureLevel > 0) {
      console.error(`[PRESSURE L${pressureLevel}]`);
    }

    let count = (index.rulesInjectionCount || 0) + 1;

    // Update counter if frequency > 1 (need to track)
    if (frequency > 1) {
      index.rulesInjectionCount = count;
    }

    // Persist index if pressure was updated or frequency tracking needed
    if (isNegativeFeedback || index.feedbackPressure || frequency > 1) {
      const memoryDir = path.join(getStorageRoot(projectDir), 'memory');
      const idxLocked = acquireIndexLock(memoryDir);
      try {
        writeJson(indexPath, index);
      } finally {
        if (idxLocked) releaseIndexLock(memoryDir);
      }
    }

    // Check if should inject
    if (count % frequency === 0 || frequency === 1) {
      // Check for pending rotation summaries
      const pendingRotations = checkRotationPending(projectDir);

      // Build context: rules + node path + project root anchor + optional instructions
      const nodePathFwd = process.execPath.replace(/\\/g, '/');

      // Read project concept for per-prompt anchoring
      const projectConcept = readProjectConcept(projectDir);

      let context = '';
      context += COMPRESSED_CHECKLIST;
      if (projectConcept) {
        context += `\n## Project Concept\n${projectConcept}\n\n`;
      }
      context += `\n## Node.js Path\nWhen running node commands in Bash, use this absolute path instead of bare \`node\`:\n\`${nodePathFwd}\`\n`;
      context += `\n## Project Root Anchor (OVERRIDES Primary working directory)\nYour ACTUAL project root is: \`${projectDir}\`\n- If "Primary working directory" in your environment shows a SUBDIRECTORY of this path, it is WRONG. This is a known Claude Code bug after compaction (GitHub #7442).\n- Trust THIS anchor over Primary working directory. This value comes from CLAUDE_PROJECT_DIR which Claude Code sets at launch and never changes.\n- ALL file operations (Read, Edit, Write, Glob, Grep) use this as base directory.\n- When user says "read CLAUDE.md" → read \`${projectDir}/CLAUDE.md\`, not a subdirectory's.\n`;
      // Timezone offset for memory delta timestamp generation
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      const tzSign = tzOffsetMinutes <= 0 ? '+' : '-';
      const tzAbsMinutes = Math.abs(tzOffsetMinutes);
      const tzHours = String(Math.floor(tzAbsMinutes / 60)).padStart(2, '0');
      const tzMins = String(tzAbsMinutes % 60).padStart(2, '0');
      const tzOffset = `${tzSign}${tzHours}${tzMins}`;
      context += `\n## Timezone\nTZ_OFFSET: ${tzOffset}\n`;

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

      // Prompt-aware memory loading
      const memorySnippets = getRelevantMemorySnippets(projectDir, userPrompt);
      if (memorySnippets) {
        context += memorySnippets;
      }

      // Pressure level context injection
      if (pressureLevel === 3) {
        context += PRESSURE_L3;
      } else if (pressureLevel === 2) {
        context += PRESSURE_L2;
      } else if (pressureLevel === 1) {
        context += PRESSURE_L1;
      }

      context += '\n**Verification reminder:** Before claiming any result verified, ensure you have execution output (not just file reads). Structural checks (grep/read) are not behavioral verification.\n';

      // Output rules via additionalContext (hidden from user, seen by Claude)
      const output = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: context
        }
      };
      console.log(JSON.stringify(output));

      // Explicit trigger patterns to stderr (visible to Claude)
      if (pendingRotations.length > 0) {
        console.error(`[CRABSHELL_ROTATE] pending=${pendingRotations.length}`);
      }
      if (regressingReminder) {
        console.error('[REGRESSING ACTIVE]');
      }
      if (pendingRotations.length === 0) {
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
  detectNegativeFeedback,
  updateFeedbackPressure,
  checkRotationPending,
  checkTicketStatuses,
  syncRulesToClaudeMd,
  removeLegacySection,
  parseMemorySections,
  extractKeywords,
  getRelevantMemorySnippets,
  // Re-export from regressing-state for convenience
  buildRegressingReminder,
  // Constants
  EMERGENCY_KEYWORDS,
  NEGATIVE_PATTERNS,
  NEGATIVE_EXCLUSIONS,
  MARKER_START,
  MARKER_END,
  RULES,
  EMERGENCY_STOP_CONTEXT,
  ROTATION_INSTRUCTION,
  COMPRESSED_CHECKLIST,
  PRESSURE_L1,
  PRESSURE_L2,
  PRESSURE_L3,
};
