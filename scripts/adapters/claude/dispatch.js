'use strict';

// Claude's output for a host event's checks. The checks themselves run in
// core/dispatch.js (shared with Codex): each loads its module and runs in its own
// try/catch, so a failing check is skipped and the others still decide.

// One JSON object for the host: a deny with every reason, and the model context.
function hostOutput(eventName, collected) {
  const specific = { hookEventName: eventName };
  if (collected.reasons.length) {
    specific.permissionDecision = 'deny';
    specific.permissionDecisionReason = collected.reasons.join('\n\n');
  }
  if (collected.contexts.length) specific.additionalContext = collected.contexts.join('\n\n');
  const output = {};
  if (Object.keys(specific).length > 1) output.hookSpecificOutput = specific;
  if (collected.systemMessages.length) output.systemMessage = collected.systemMessages.join('\n');
  return Object.keys(output).length ? output : null;
}

// source: { payload, projectDir } — after the output, what it carried is recorded (D178);
// Claude's output carries every reason, context and systemMessage the checks returned.
function emit(eventName, collected, source = {}) {
  if (collected.logs.length) process.stderr.write(collected.logs.join('\n') + '\n');
  const output = hostOutput(eventName, collected);
  if (output) process.stdout.write(JSON.stringify(output) + '\n');
  if (!output || !source.projectDir) return;
  try {
    require('../../core/guard-fires').recordFires(source.projectDir,
      { host: 'claude', event: eventName, fired: collected.fired, payload: source.payload });
  } catch {} // Recording never changes the hook's result.
}

module.exports = { emit, hostOutput };
