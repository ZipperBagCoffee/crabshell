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
const { readStdin } = require('./transcript-utils');
const { MEMORY_DIR, BEHAVIOR_VERIFIER_STATE_FILE } = require('./constants');

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

  // Length bypass — skip trivial / no-substance turns.
  if (assistantText.length < 50) process.exit(0);

  // Clarification-only turns: nothing to verify.
  if (isClarificationOnly(assistantText)) process.exit(0);

  // Compose state-file path under .crabshell/memory/ (storage root).
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
  const storageRoot = getStorageRoot(projectDir);
  const stateFilePath = path.join(storageRoot, MEMORY_DIR, BEHAVIOR_VERIFIER_STATE_FILE);

  const taskId = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nowIso = new Date().toISOString();
  const state = {
    taskId,
    lastResponseId: hookData.session_id || null,
    status: 'pending',
    launchedAt: nowIso,
    verdicts: null,
    lastUpdatedAt: nowIso
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

module.exports = { isClarificationOnly, stripCodeBlocks };
