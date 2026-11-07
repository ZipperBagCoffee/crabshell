'use strict';

const { readStdin } = require('./transcript-utils');
const { getProjectDir } = require('./utils');
const { findProjectRoot } = require('./adapters/codex/hook-contract');
const { decideStop, noteSubagentStop, recordParentObservation, prepareParentCheck, interruptWork } = require('./core/completion-control');
const { commandObservation } = require('./core/command-observation');
const { contentIdentity } = require('./core/project-state');
const { isFileWrite, shellCommand } = require('./core/tool-shape');

if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

// Claude-only Stop checks, run in this process. sycophancy-guard and scope-guard
// left Stop dispatch in v21.113.0 (I083 R5: behavioral policing moved out of
// hooks) and were deleted in v21.130.0.
function legacyClaudeStopReasons(payload, projectDir = getProjectDir()) {
  if (payload.stop_hook_active === true) return [];
  try {
    const reason = require('./doc-watchdog').stopReason(payload, projectDir);
    return reason ? [reason] : [];
  } catch (error) {
    process.stderr.write(`[CRABSHELL] doc-watchdog Stop check skipped: ${error.message}\n`);
    return [];
  }
}

// One feature's failure leaves the others running (D143_T018: hooks are fail-open).
function attempt(feature, fallback = null) {
  try { return feature(); } catch (error) {
    process.stderr.write(`[CRABSHELL] skipped: ${error && error.message}\n`);
    return fallback;
  }
}

function handlePayload(payload, options = {}) {
  const eventName = payload?.hook_event_name;
  const projectDir = options.projectDir || (options.host === 'codex' ? findProjectRoot(payload?.cwd) : getProjectDir());
  if (eventName === 'Interrupt' || payload.is_interrupt === true || payload.tool_response?.interrupted === true) {
    return { eventName, result: interruptWork(projectDir, payload) };
  }
  if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(eventName)) {
    // Shell calls and file writes are known by their shape (core/tool-shape), whatever
    // the tool is named; a Codex call that is neither changes no record.
    const command = shellCommand(payload);
    const writes = isFileWrite(payload);
    if (options.host === 'codex' && !command && !writes) return { eventName, result: { recorded: false, reason: 'not-a-shell-call-or-write' } };
    const normalized = options.host === 'codex' && command ? { ...payload, tool_input: { ...payload.tool_input, command } } : payload;
    if (options.host === 'codex' && eventName !== 'PreToolUse') {
      let fingerprint;
      const evidence = { host: 'codex', observation: attempt(() => commandObservation(normalized, projectDir, { host: 'codex' })),
        getFingerprint: () => fingerprint ?? (fingerprint = contentIdentity(projectDir)) };
      // Only a declared check's result is recorded; an edit changes no record (D143_T013).
      if (evidence.observation) {
        attempt(() => require('./verification-sequence').recordVerification(normalized, projectDir, evidence));
      }
      // What to declare after a shell run (D143_T015), for the model's context.
      const context = command ? attempt(() => require('./core/declaration-guidance').afterRun(normalized, projectDir, { host: 'codex' })) : null;
      return { eventName, result: attempt(() => recordParentObservation(projectDir, normalized, evidence), { recorded: false, reason: 'skipped' }), context };
    }
    return { eventName, result: eventName === 'PreToolUse' ? prepareParentCheck(projectDir, normalized)
      : recordParentObservation(projectDir, normalized, { host: options.host || 'claude' }) };
  }
  if (eventName === 'SubagentStop') {
    return { eventName, result: noteSubagentStop(projectDir, payload) };
  }
  if (eventName !== 'Stop') return { eventName, result: { action: 'allow', reason: 'unsupported-event' } };
  const shared = decideStop(projectDir, payload);
  const legacyReasons = options.host === 'claude' ? legacyClaudeStopReasons(payload, projectDir) : [];
  const reasons = [shared.action === 'block' ? shared.reason : '', ...legacyReasons].filter(Boolean);
  if (reasons.length === 0) return { eventName, result: shared };
  return { eventName, result: { ...shared, action: 'block', reason: reasons.join('\n\n') } };
}

async function main(options = {}) {
  const payload = await readStdin(2000, { host: options.host || 'claude' });
  if (!payload || Object.keys(payload).length === 0) return;
  const handled = handlePayload(payload, options);
  if (handled.eventName !== 'Stop' || handled.result.action !== 'block') {
    const output = {};
    if (handled.result.systemMessage) output.systemMessage = handled.result.systemMessage;
    // Codex adds PostToolUse hookSpecificOutput.additionalContext to the model's context.
    if (handled.context && handled.eventName === 'PostToolUse') output.hookSpecificOutput = { hookEventName: 'PostToolUse', additionalContext: handled.context };
    if (Object.keys(output).length) process.stdout.write(JSON.stringify(output) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify({ decision: 'block', reason: handled.result.reason }) + '\n');
  if (options.host === 'claude') process.exitCode = 2;
}

if (require.main === module) {
  main({ host: 'claude' }).catch(() => {});
}

module.exports = { handlePayload, legacyClaudeStopReasons, main };
