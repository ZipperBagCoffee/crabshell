'use strict';

const { readStdin } = require('./transcript-utils');
const { getProjectDir } = require('./utils');
const { findProjectRoot } = require('./adapters/codex/hook-contract');
const { decideStop, noteSubagentStop, recordParentObservation, prepareParentCheck, interruptWork } = require('./core/completion-control');
const { commandObservation } = require('./core/command-observation');
const { contentIdentity } = require('./core/project-state');
const { isFileWrite, shellCommand } = require('./core/tool-shape');
const bestAnswer = require('./best-answer');
const { isGuardOff } = require('./core/guards-off');
const path = require('path');

// Names in the guard-fire record (D178): this controller and the best-answer module by their
// file names; the after-run hint by the name its Claude check carries (adapters/claude/post-tool-use.js).
const SELF = path.basename(__filename, '.js');
const BEST_ANSWER = path.basename(require.resolve('./best-answer'), '.js');
const AFTER_RUN_HINT = 'declaration-after';
// The Codex result recorder, by the name its Claude check carries (adapters/claude/post-tool-use.js).
const VERIFICATION_RECORD = 'verification-record';

// D187_T004: a name in CRABSHELL_GUARDS_OFF is skipped here as in core/dispatch.js; what the
// skipped part would have decided is left undecided, and the other parts run as before.
const on = name => !isGuardOff(name);
const SKIPPED = Object.freeze({ recorded: false, reason: 'guard-off' });
const ALLOWED = Object.freeze({ action: 'allow', reason: 'guard-off' });

if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

// Claude-only Stop checks, run in this process; one check's failure skips only that
// check. sycophancy-guard was removed in v21.180.0 (D179: most of its keyword blocks were
// false alarms; the best-answer question asks "agree without checking?" instead);
// scope-guard stays deleted.
const CLAUDE_STOP_CHECKS = [
  ['doc-watchdog', (payload, projectDir) => require('./doc-watchdog').stopReason(payload, projectDir)],
];

// [{ guard, text }]: each Stop check that blocks, by name (D178 records which one blocked).
function claudeStopBlocks(payload, projectDir = getProjectDir()) {
  if (payload.stop_hook_active === true) return [];
  const blocks = [];
  for (const [name, check] of CLAUDE_STOP_CHECKS) {
    if (!on(name)) continue;
    try {
      const reason = check(payload, projectDir);
      if (reason) blocks.push({ guard: name, text: reason });
    } catch (error) {
      process.stderr.write(`[CRABSHELL] ${name} Stop check skipped: ${error.message}\n`);
    }
  }
  return blocks;
}

function legacyClaudeStopReasons(payload, projectDir = getProjectDir()) {
  return claudeStopBlocks(payload, projectDir).map(block => block.text);
}

// One feature's failure leaves the others running (D143_T018: hooks are fail-open).
function attempt(feature, fallback = null) {
  try { return feature(); } catch (error) {
    process.stderr.write(`[CRABSHELL] skipped: ${error && error.message}\n`);
    return fallback;
  }
}

function projectDirFor(payload, options = {}) {
  return options.projectDir || (options.host === 'codex' ? findProjectRoot(payload?.cwd) : getProjectDir());
}

function handlePayload(payload, options = {}) {
  const eventName = payload?.hook_event_name;
  const projectDir = projectDirFor(payload, options);
  if (eventName === 'Interrupt' || payload.is_interrupt === true || payload.tool_response?.interrupted === true) {
    return { eventName, result: on(SELF) ? interruptWork(projectDir, payload) : SKIPPED };
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
      if (evidence.observation && on(VERIFICATION_RECORD)) {
        attempt(() => require('./verification-sequence').recordVerification(normalized, projectDir, evidence));
      }
      // What to declare after a shell run (D143_T015), for the model's context.
      const context = command && on(AFTER_RUN_HINT) ? attempt(() => require('./core/declaration-guidance').afterRun(normalized, projectDir, { host: 'codex' })) : null;
      const result = on(SELF) ? attempt(() => recordParentObservation(projectDir, normalized, evidence), { recorded: false, reason: 'skipped' }) : SKIPPED;
      return { eventName, result, context };
    }
    if (!on(SELF)) return { eventName, result: SKIPPED };
    return { eventName, result: eventName === 'PreToolUse' ? prepareParentCheck(projectDir, normalized)
      : recordParentObservation(projectDir, normalized, { host: options.host || 'claude' }) };
  }
  if (eventName === 'SubagentStop') {
    return { eventName, result: on(SELF) ? noteSubagentStop(projectDir, payload) : SKIPPED };
  }
  if (eventName !== 'Stop') return { eventName, result: { action: 'allow', reason: 'unsupported-event' } };
  // D177 (Claude only): the other checks first; the best-answer question once per prompt when
  // none of them blocks, else at the next Stop. After the question, the checks run once more.
  const claude = options.host === 'claude';
  const asks = claude && on(BEST_ANSWER);
  const checked = asks && attempt(() => bestAnswer.othersMayRun(payload, projectDir), false)
    ? { ...payload, stop_hook_active: false } : payload;
  const shared = on(SELF) ? decideStop(projectDir, checked) : ALLOWED;
  const blockedBy = [shared.action === 'block' ? { guard: SELF, text: shared.reason } : null,
    ...(claude ? claudeStopBlocks(checked, projectDir) : [])].filter(block => block && block.text);
  const reasons = blockedBy.map(block => block.text);
  const question = asks ? attempt(() => bestAnswer.stopStep(payload, projectDir, reasons.length > 0)) : null;
  if (reasons.length === 0) return { eventName, result: question ? { ...shared, question } : shared };
  return { eventName, result: { ...shared, action: 'block', reason: reasons.join('\n\n'), blockedBy } };
}

// What main actually sent, after it was sent (D178). handlePayload stays free of file writes.
function recordSent(handled, payload, options, sent) {
  try {
    require('./core/guard-fires').recordFires(projectDirFor(payload, options),
      { host: options.host || 'claude', event: handled.eventName, fired: sent, payload });
  } catch {} // Recording never changes the hook's result.
}

async function main(options = {}) {
  const payload = await readStdin(2000, { host: options.host || 'claude' });
  if (!payload || Object.keys(payload).length === 0) return;
  const handled = handlePayload(payload, options);
  if (handled.eventName !== 'Stop' || handled.result.action !== 'block') {
    const output = {};
    // D177: the question continues the turn as Stop hook feedback, not as a hook error.
    if (handled.eventName === 'Stop' && handled.result.question) output.hookSpecificOutput = { hookEventName: 'Stop', additionalContext: handled.result.question };
    if (handled.result.systemMessage) output.systemMessage = handled.result.systemMessage;
    // Codex adds PostToolUse hookSpecificOutput.additionalContext to the model's context.
    if (handled.context && handled.eventName === 'PostToolUse') output.hookSpecificOutput = { hookEventName: 'PostToolUse', additionalContext: handled.context };
    if (Object.keys(output).length) {
      process.stdout.write(JSON.stringify(output) + '\n');
      const sent = [];
      if (output.hookSpecificOutput && handled.eventName === 'Stop') sent.push({ guard: BEST_ANSWER, channel: 'context', text: handled.result.question });
      if (output.hookSpecificOutput && handled.eventName === 'PostToolUse') sent.push({ guard: AFTER_RUN_HINT, channel: 'context', text: handled.context });
      if (output.systemMessage) sent.push({ guard: SELF, channel: 'systemMessage', text: output.systemMessage });
      recordSent(handled, payload, options, sent);
    }
    return;
  }
  process.stdout.write(JSON.stringify({ decision: 'block', reason: handled.result.reason }) + '\n');
  if (options.host === 'claude') process.exitCode = 2;
  recordSent(handled, payload, options, (handled.result.blockedBy || []).map(block => ({ ...block, channel: 'reason' })));
}

if (require.main === module) {
  main({ host: 'claude' }).catch(() => {});
}

const STOP_CHECK_NAMES = CLAUDE_STOP_CHECKS.map(([name]) => name);

// Every name this controller writes into the guard-fire record besides the Stop checks.
const RECORDED_NAMES = [SELF, BEST_ANSWER, AFTER_RUN_HINT];

module.exports = { handlePayload, claudeStopBlocks, legacyClaudeStopReasons, main, STOP_CHECK_NAMES, RECORDED_NAMES };
