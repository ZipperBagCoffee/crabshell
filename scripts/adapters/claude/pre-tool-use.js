'use strict';

// Claude PreToolUse for every tool: every guard in this one process (hooks.json starts
// one process instead of one per guard). Each guard is routed by the call's shape — a
// shell call or a file write (core/tool-shape) — whatever the tool is named; a call that
// is neither loads no guard module. All guards run even
// after one denies, because some record state (a declared check starting, the
// parent's check preparation). verify-guard is no longer wired (D143): writing a
// ticket's Final Verification ran the declared checks again.
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const { readStdin } = require('../../transcript-utils');
const { emit } = require('./dispatch');
const { runChecks } = require('../../core/dispatch');
const { isFileWrite, isShellCall } = require('../../core/tool-shape');

const shellOrWrite = payload => isShellCall(payload) || isFileWrite(payload);

function controllerResult(payload, projectDir) {
  const handled = require('../../completion-controller').handlePayload(payload, { host: 'claude', projectDir });
  return handled && handled.result && handled.result.systemMessage ? { systemMessage: handled.result.systemMessage } : null;
}

// A check after rerun-guard that records a start or resets evidence runs only when the
// call is allowed: a denied rerun never reaches PostToolUse, so its start would stay open.
const allowed = collected => collected.reasons.length === 0;

const CHECKS = [
  {
    // A manifest entry passed with the same inputs is answered from the runner's record
    // (D143_T014); an undeclared wrapper before a declared check gets a one-line hint.
    name: 'rerun-guard',
    accepts: isShellCall,
    run: (payload, projectDir) => {
      const decision = require('../../core/rerun-guard').rerunDecision(payload, projectDir);
      if (!decision) return null;
      return decision.reason ? { reason: decision.reason, log: `[RERUN_GUARD] answered from the runner record: ${decision.entryId}` } : { context: decision.context };
    },
  },
  { name: 'completion-controller', accepts: isShellCall, when: allowed, run: controllerResult },
  {
    name: 'path-guard',
    accepts: shellOrWrite,
    run: (payload, projectDir) => {
      const result = require('../../core/path-policy').evaluatePathPolicy(payload, projectDir);
      return result && { reason: result.reason, context: result.advisory, log: result.diagnostic };
    },
  },
  {
    // The user's rule forbids these two tools by name, so the name is the policy here.
    name: 'web-guard',
    tools: ['WebFetch', 'WebSearch'],
    run: (payload, projectDir) => {
      const result = require('../../web-guard').evaluateWebGuard(payload, projectDir);
      return result && { reason: result.block, context: result.warn };
    },
  },
  { name: 'regressing-guard', accepts: isFileWrite, run: (payload, projectDir) => require('../../regressing-guard').evaluateRegressingGuard(payload, projectDir) },
  { name: 'docs-guard', accepts: isFileWrite, run: (payload, projectDir) => require('../../docs-guard').evaluateDocsGuard(payload, projectDir) },
  { name: 'log-guard', accepts: isFileWrite, run: (payload, projectDir) => require('../../log-guard').evaluateLogGuard(payload, projectDir) },
  {
    // Declared-check start (recorded as completion evidence). Nothing is blocked.
    name: 'verification-gate',
    accepts: isShellCall,
    when: allowed,
    run: (payload, projectDir) => {
      const gate = require('../../verification-sequence').gateVerification(payload, projectDir);
      const log = [gate.notice, gate.reason].filter(Boolean).map(text => `[VERIFICATION_SEQ] ${text}`).join('\n');
      return { reason: gate.reason, context: gate.notice ? `[CRABSHELL] ${gate.notice}` : undefined, log: log || undefined };
    },
  },
  {
    // An allowed run of a declared entry: the project's files now, so the after-run hint can
    // name what the run wrote (D143_T015).
    name: 'declaration-before',
    accepts: isShellCall,
    when: allowed,
    run: (payload, projectDir) => require('../../core/declaration-guidance').beforeRun(payload, projectDir),
  },
  { name: 'doc-watchdog', accepts: isFileWrite, run: (payload, projectDir) => require('../../doc-watchdog').gateEdit(payload, projectDir) },
];

async function main() {
  const payload = await readStdin();
  if (!payload || !payload.tool_name) return;
  const projectDir = require('../../utils').getProjectDir();
  emit('PreToolUse', await runChecks(CHECKS, payload, projectDir));
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CRABSHELL PRE-TOOL-USE ERROR] ${error.message}\n`);
  });
}

module.exports = { CHECKS, main };
