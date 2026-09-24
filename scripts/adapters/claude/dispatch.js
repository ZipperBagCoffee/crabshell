'use strict';

// Runs a host event's checks in one process. Each check loads its module and runs
// inside its own try/catch: a check that fails to load or throws is skipped
// (fail-open) and the others still run and decide.

// checks: [{ name, tools?: [toolName], run(hookData, projectDir) }]. A check returns
// null, or any of { reason, context, systemMessage, log }.
// The host reads stdout as one JSON object; any other line in front of it turns the
// whole output into plain text and drops the decision and context. While checks run,
// whatever a module prints to stdout goes to stderr instead.
async function withStdoutToStderr(fn) {
  const write = process.stdout.write;
  process.stdout.write = (chunk, encoding, callback) => process.stderr.write(chunk, encoding, callback);
  try {
    return await fn();
  } finally {
    process.stdout.write = write;
  }
}

async function runChecks(checks, hookData, projectDir) {
  const collected = { reasons: [], contexts: [], systemMessages: [], logs: [] };
  await withStdoutToStderr(async () => {
    for (const check of checks) {
      if (check.tools && !check.tools.includes(hookData.tool_name)) continue;
      if (check.when && !check.when(collected)) continue;
      try {
        const result = await check.run(hookData, projectDir);
        if (!result) continue;
        if (result.reason) collected.reasons.push(result.reason);
        if (result.context) collected.contexts.push(result.context);
        if (result.systemMessage) collected.systemMessages.push(result.systemMessage);
        if (result.log) collected.logs.push(result.log);
      } catch (error) {
        collected.logs.push(`[CRABSHELL] ${check.name} skipped: ${error && error.message}`);
      }
    }
  });
  return collected;
}

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

function emit(eventName, collected) {
  if (collected.logs.length) process.stderr.write(collected.logs.join('\n') + '\n');
  const output = hostOutput(eventName, collected);
  if (output) process.stdout.write(JSON.stringify(output) + '\n');
}

module.exports = { emit, hostOutput, runChecks };
