'use strict';

// Codex PreToolUse: the same check runner as Claude (core/dispatch, D143_T018) — each
// check loads its module inside run() and runs in its own try/catch, so a module that is
// missing or broken skips that check and the path guard still decides. The output keeps
// Codex's shape: a deny, or the notices as additionalContext.

const { readStdin } = require('../../transcript-utils');
const { denyOutput, normalizePreToolUse } = require('./hook-contract');
const { runChecks } = require('../../core/dispatch');
const { shellCommand } = require('../../core/tool-shape');

// A shell call by its shape, whatever the tool is named (D143 §6), with the command where
// the checks read it.
const isShell = payload => Boolean(shellCommand(payload));
const withCommand = payload => ({ ...payload, tool_input: { ...payload.tool_input, command: shellCommand(payload) } });
// A check after a deny stands down: a denied run never starts, so nothing is recorded for it.
const allowed = collected => collected.reasons.length === 0;

const CHECKS = [
  {
    name: 'path-guard',
    run: (payload, projectDir) => {
      const result = require('../../core/path-policy').evaluatePathPolicy(payload, projectDir);
      return result ? { reason: result.reason, context: result.advisory, log: result.diagnostic } : null;
    },
  },
  {
    // A rerun answered from the runner's record is denied before any start is recorded.
    name: 'rerun-guard',
    accepts: isShell,
    when: allowed,
    run: (payload, projectDir) => {
      const decision = require('../../core/rerun-guard').rerunDecision(withCommand(payload), projectDir);
      if (!decision) return null;
      return decision.reason ? { reason: decision.reason } : { context: decision.context };
    },
  },
  {
    name: 'verification-gate',
    accepts: isShell,
    when: allowed,
    run: (payload, projectDir) => {
      const gate = require('../../verification-sequence').gateVerification(withCommand(payload), projectDir);
      if (gate.reason) return { reason: gate.reason };
      return gate.notice ? { context: `[CRABSHELL] ${gate.notice}` } : null;
    },
  },
  {
    name: 'completion-controller',
    accepts: isShell,
    when: allowed,
    run: (payload, projectDir) => { require('../../core/completion-control').prepareParentCheck(projectDir, withCommand(payload)); return null; },
  },
  {
    // D151_T002: before a commit, one line when files changed since the checks last passed.
    name: 'commit-reminder',
    accepts: isShell,
    when: allowed,
    run: (payload, projectDir) => {
      const text = require('../../core/commit-reminder').commitReminder(withCommand(payload), projectDir);
      return text ? { context: text } : null;
    },
  },
  {
    // The project's files before an allowed declared run (D143_T015 after-run hints).
    name: 'declaration-before',
    accepts: isShell,
    when: allowed,
    run: (payload, projectDir) => require('../../core/declaration-guidance').beforeRun(withCommand(payload), projectDir),
  },
];

async function main() {
  const payload = await readStdin(500, { host: 'codex' });
  const normalized = normalizePreToolUse(payload);
  if (!normalized) return;
  // The whole payload: the later checks read its session, call and turn ids.
  const collected = await runChecks(CHECKS, payload, normalized.projectDir);
  if (collected.logs.length) process.stderr.write(collected.logs.join('\n') + '\n');
  if (collected.reasons.length) {
    console.log(JSON.stringify(denyOutput(collected.reasons.join('\n\n'))));
    return;
  }
  // Codex adds PreToolUse hookSpecificOutput.additionalContext to the model's context.
  if (collected.contexts.length) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: collected.contexts.join('\n') } }));
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[CODEX PATH GUARD ERROR] ${error.message}`);
  });
}

module.exports = { main, CHECKS };
