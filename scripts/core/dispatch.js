'use strict';

// Runs a host event's checks in one process, for both hosts (D143_T018). Each check loads
// its module inside run() and runs inside its own try/catch: a check that fails to load or
// throws is skipped (fail-open) and the others still run and decide. Building the host's
// output stays with each adapter — the hosts' output contracts differ.

// checks: [{ name, accepts?(hookData), tools?: [toolName], when?(collected), run(hookData, projectDir) }].
// `accepts` reads the payload's shape (core/tool-shape: a shell call, a file write);
// `tools` names tools only where the name itself is the policy (web-guard); `when` sees
// what earlier checks returned (a check after a deny can stand down). A check returns
// null, or any of { reason, context, systemMessage, log }. What a check sent is also kept in
// collected.fired ({ guard, channel, text }) so the adapter can record it after its output
// (D178, core/guard-fires); nothing here writes a file. A check named in CRABSHELL_GUARDS_OFF
// is skipped (D187_T004, core/guards-off).
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

function appliesTo(check, hookData) {
  if (check.accepts) return check.accepts(hookData);
  if (check.tools) return check.tools.includes(hookData.tool_name);
  return true;
}

const { guardsOff } = require('./guards-off');

const FIRED_CHANNELS = ['reason', 'context', 'systemMessage'];

// options.env: where the switch is read (the process's environment unless given).
async function runChecks(checks, hookData, projectDir, options = {}) {
  const collected = { reasons: [], contexts: [], systemMessages: [], logs: [], fired: [] };
  const off = guardsOff(options.env || process.env);
  await withStdoutToStderr(async () => {
    for (const check of checks) {
      try {
        if (off.includes(check.name)) continue;
        if (!appliesTo(check, hookData)) continue;
        if (check.when && !check.when(collected)) continue;
        const result = await check.run(hookData, projectDir);
        if (!result) continue;
        if (result.reason) collected.reasons.push(result.reason);
        if (result.context) collected.contexts.push(result.context);
        if (result.systemMessage) collected.systemMessages.push(result.systemMessage);
        if (result.log) collected.logs.push(result.log);
        for (const channel of FIRED_CHANNELS) {
          if (result[channel]) collected.fired.push({ guard: check.name, channel, text: result[channel] });
        }
      } catch (error) {
        collected.logs.push(`[CRABSHELL] ${check.name} skipped: ${error && error.message}`);
      }
    }
  });
  return collected;
}

module.exports = { appliesTo, runChecks, withStdoutToStderr };
