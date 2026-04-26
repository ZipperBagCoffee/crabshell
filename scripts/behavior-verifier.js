'use strict';

/**
 * behavior-verifier.js — Stop hook handler for D102/P132 sub-agent dispatch.
 *
 * Pattern: B-2 (trigger). At Stop, this hook writes a 'pending' state file and
 * emits a [CRABSHELL_BEHAVIOR_VERIFY] sentinel to stderr. The next-turn
 * UserPromptSubmit hook (T002 scope) consumes the sentinel and instructs Claude
 * to dispatch the verifier sub-agent via the Task tool with run_in_background.
 *
 * Exits 0 ALWAYS (fail-open) — this hook never blocks the user workflow.
 *
 * Skipped when:
 *   - CRABSHELL_BACKGROUND=1 (memory pipeline subprocess)
 *   - CRABSHELL_AGENT=behavior-verifier (the verifier sub-agent's own Stop)
 *   - hookData.stop_hook_active=true (continuation from prior block)
 *   - assistantText.length < 50 (trivial response)
 *   - assistantText is clarification-only (only ?-terminated sentences)
 *
 * Ticket: P132_T001
 */

const fs = require('fs');
const path = require('path');
const { writeJson, getStorageRoot } = require('./utils');
const { readStdin, getRecentTaskCalls } = require('./transcript-utils');
const { MEMORY_DIR, BEHAVIOR_VERIFIER_STATE_FILE, RING_BUFFER_SIZE, VERIFIER_INTERVAL } = require('./constants');

// D104 IA-1 (b) workflow-active force layer — reuse exports from regressing-loop-guard.
// Fail-open: require failure → workflowActive=false fallback (handled in main()).
let isRegressingActive, isLightWorkflowActive;
try {
  ({ isRegressingActive, isLightWorkflowActive } = require('./regressing-loop-guard'));
} catch (_) {
  isRegressingActive = () => false;
  isLightWorkflowActive = () => false;
}

// Skip during background memory summarization (recursion guard, fail-open early)
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

// Skip when the verifier sub-agent itself is the source (recursion guard)
if (process.env.CRABSHELL_AGENT === 'behavior-verifier') process.exit(0);

/**
 * Strip fenced code blocks before sentence inspection so that question marks
 * inside code samples (e.g., ternary "?:") do not falsely classify a turn as
 * clarification-only.
 */
function stripCodeBlocks(text) {
  if (!text) return '';
  return String(text)
    .replace(/```[\s\S]*?```/g, ' ')   // fenced code blocks
    .replace(/`[^`\n]*`/g, ' ');       // inline code spans
}

/**
 * Return true if the response (after code-block stripping) consists only of
 * question-terminated sentences. Such turns are clarification questions and
 * have nothing for the verifier to evaluate.
 */
function isClarificationOnly(text) {
  const cleaned = stripCodeBlocks(text).trim();
  if (!cleaned) return false;
  // Split on sentence terminators; keep the terminator with the sentence by
  // checking whether the last char of each chunk is a question mark.
  const sentences = cleaned.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  if (sentences.length === 0) return false;
  return sentences.every(s => /\?$/.test(s));
}

/**
 * D104 IA-2 — turn classification 5-class detection cascade.
 * Returns one of: 'clarification' | 'trivial' | 'notification' |
 *                 'workflow-internal' | 'user-facing'.
 *
 * Cascade order (first match wins):
 *   clarification → trivial → notification → workflow-internal → user-facing
 *
 * notification detection: hookData.prompt with line-start <task-notification>
 * anchor (line-start required to avoid false positives when assistantText
 * mentions the literal token in body).
 *
 * workflow-internal detection: workflowActive flag (regressing-state.active OR
 * skill-active TTL fresh) OR ticket-id pattern (\b[TPI]\d{3}(?:_T\d{3})?\b).
 *
 * fail-open: any regex/exception → 'user-facing' (most strict default).
 */
function classifyTurnType({ assistantText, hookData, workflowActive }) {
  try {
    const text = String(assistantText || '');
    if (isClarificationOnly(text)) return 'clarification';
    if (text.length < 50) return 'trivial';
    const promptText = (hookData && (hookData.prompt || hookData.input)) || '';
    if (typeof promptText === 'string' && /^<task-notification>/m.test(promptText)) {
      return 'notification';
    }
    if (workflowActive === true) return 'workflow-internal';
    if (/\b[TPI]\d{3}(?:_T\d{3})?\b/.test(text)) return 'workflow-internal';
    return 'user-facing';
  } catch (_) {
    return 'user-facing';
  }
}

async function main() {
  let hookData;
  try {
    hookData = await readStdin(1000);
  } catch (e) {
    process.exit(0);
  }
  if (!hookData || typeof hookData !== 'object') process.exit(0);

  // stop_hook_active = continuation from a previous block; do not re-fire.
  if (hookData.stop_hook_active) process.exit(0);

  const assistantText = hookData.stop_response || hookData.last_assistant_message || '';
  if (!assistantText || typeof assistantText !== 'string') process.exit(0);

  // D104 IA-1 (b) — workflow-active force layer detection. Fail-open: any
  // exception in detection → workflowActive=false (least-privilege default).
  let workflowActive = false;
  try {
    workflowActive = !!(isRegressingActive() || isLightWorkflowActive());
  } catch (_) { workflowActive = false; }

  // Length + clarification bypass cascade. workflowActive=true ignores both
  // (D104 IA-1 b: regressing/light-workflow active = force fire even for
  // length<50 / clarification-only turns).
  if (!workflowActive) {
    if (assistantText.length < 50) process.exit(0);
    if (isClarificationOnly(assistantText)) process.exit(0);
  }

  // Compose state-file path under .crabshell/memory/ (storage root).
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
  const storageRoot = getStorageRoot(projectDir);
  const stateFilePath = path.join(storageRoot, MEMORY_DIR, BEHAVIOR_VERIFIER_STATE_FILE);
  const indexPath = path.join(storageRoot, MEMORY_DIR, 'memory-index.json');

  // P135_T001 AC-2/AC-3 — read prior state BEFORE writing the new one.
  // If the prior state was 'pending' AND the response is substantive (the
  // length<50 + clarification-only bypasses above already filtered trivial
  // turns) AND no Task tool_use was invoked since the prior launchedAt,
  // flag the new state with dispatchOverdue=true so the next-turn consumer
  // (inject-rules.js) can prepend a [DISPATCH OVERDUE] marker.
  let priorState = null;
  try {
    if (fs.existsSync(stateFilePath)) {
      priorState = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    }
  } catch (e) { priorState = null; }

  // D104 IA-1 (a) — periodic skip. Read verifierCounter from memory-index.json
  // (counter.js maintains this on PostToolUse). Skip when:
  //   workflowActive=false AND priorState.lastFiredTurn != null AND
  //   verifierCounter < priorState.lastFiredTurn + VERIFIER_INTERVAL.
  // workflowActive=true ignores the periodic gate (force fire layer).
  let verifierCounter = 0;
  try {
    if (fs.existsSync(indexPath)) {
      const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (typeof idx.verifierCounter === 'number') verifierCounter = idx.verifierCounter;
    }
  } catch (_) { verifierCounter = 0; }

  if (!workflowActive
      && priorState
      && typeof priorState.lastFiredTurn === 'number'
      && priorState.lastFiredTurn !== null
      && verifierCounter < (priorState.lastFiredTurn + VERIFIER_INTERVAL)) {
    process.exit(0);
  }

  let dispatchOverdue = false;
  try {
    if (priorState && priorState.status === 'pending' && priorState.launchedAt) {
      // The length<50 + clarification-only bypasses earlier in main() already
      // exit before reaching this point — by now we know the current response
      // is substantive. Only check Task tool calls since the prior launchedAt.
      const transcriptPath = hookData.transcript_path || null;
      const recentTasks = getRecentTaskCalls(transcriptPath, priorState.launchedAt);
      // recentTasks === null means transcript unreadable → fail-open (do NOT
      // flag overdue to avoid false positive). [] means readable but empty.
      if (Array.isArray(recentTasks) && recentTasks.length === 0) {
        dispatchOverdue = true;
      }
    }
  } catch (e) { dispatchOverdue = false; }

  // D104 IA-1 (c) — missedCount streak + escalationLevel transition.
  //   Task call detected since priorState.launchedAt → reset missedCount=0
  //   No Task call (dispatchOverdue=true) → priorState.missedCount + 1
  //   escalationLevel = min(2, missedCount). 0=L0, 1=L0 marker, 2=L1 marker.
  let missedCount = 0;
  try {
    const prevMissed = (priorState && typeof priorState.missedCount === 'number')
      ? priorState.missedCount : 0;
    if (dispatchOverdue) {
      missedCount = prevMissed + 1;
    } else {
      missedCount = 0;
    }
  } catch (_) { missedCount = 0; }
  const escalationLevel = Math.min(2, missedCount);

  // D104 IA-1 (d) — verdict ring buffer carry-over from priorState. Hook only
  // carries; sub-agent prompt pushes new entries (FIFO N=8, see Step 4 in
  // prompts/behavior-verifier-prompt.md).
  let ringBuffer = [];
  try {
    if (priorState && Array.isArray(priorState.ringBuffer)) {
      ringBuffer = priorState.ringBuffer.slice(-RING_BUFFER_SIZE);
    }
  } catch (_) { ringBuffer = []; }

  // D104 IA-2 — turn classification (state field for prompt-side conditional
  // gating). fail-open default = 'user-facing'.
  let turnType = 'user-facing';
  try {
    turnType = classifyTurnType({ assistantText, hookData, workflowActive });
  } catch (_) { turnType = 'user-facing'; }

  // D104 IA-1 (a) — triggerReason classification for trace + audit.
  let triggerReason = 'stop';
  try {
    if (workflowActive) triggerReason = 'workflow-active';
    else if (escalationLevel >= 1) triggerReason = 'escalation';
    else if (typeof priorState?.lastFiredTurn === 'number'
             && verifierCounter >= (priorState.lastFiredTurn + VERIFIER_INTERVAL)) {
      triggerReason = 'periodic';
    }
  } catch (_) { triggerReason = 'stop'; }

  const taskId = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nowIso = new Date().toISOString();
  const state = {
    taskId,
    lastResponseId: hookData.session_id || null,
    status: 'pending',
    launchedAt: nowIso,
    verdicts: null,
    dispatchOverdue,
    lastUpdatedAt: nowIso,
    // D104 IA-1 + IA-2 — 7 new fields.
    triggerReason,
    lastFiredAt: nowIso,
    lastFiredTurn: verifierCounter,
    missedCount,
    escalationLevel,
    ringBuffer,
    turnType
  };

  try {
    writeJson(stateFilePath, state);
  } catch (e) {
    // utils.writeJson already includes Windows EPERM fallback; if even that
    // fails, log and exit 0 (fail-open — never block the user).
    try { process.stderr.write(`[CRABSHELL_BEHAVIOR_VERIFY] state write failed: ${e && e.message}\n`); } catch (_) {}
    process.exit(0);
  }

  // Emit sentinel to stderr — next-turn UserPromptSubmit (T002 scope) consumes
  // this and dispatches the verifier sub-agent.
  try {
    process.stderr.write(`[CRABSHELL_BEHAVIOR_VERIFY] file=${BEHAVIOR_VERIFIER_STATE_FILE} taskId=${taskId}\n`);
  } catch (_) {}

  process.exit(0);
}

if (require.main === module) {
  main().catch(() => process.exit(0)); // fail-open on any error
}

module.exports = { isClarificationOnly, stripCodeBlocks, classifyTurnType };
