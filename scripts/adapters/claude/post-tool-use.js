'use strict';

// Claude PostToolUse and PostToolUseFailure (every tool): all observers in this one
// process instead of one process per script, routed by the call's shape
// (core/tool-shape), not by the tool's name.
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const { readStdin } = require('../../transcript-utils');
const { emit } = require('./dispatch');
const { runChecks } = require('../../core/dispatch');
const { isFileWrite, isShellCall } = require('../../core/tool-shape');

const shellOrWrite = payload => isShellCall(payload) || isFileWrite(payload);

function recordVerification(payload, projectDir) {
  require('../../verification-sequence').recordVerification(payload, projectDir);
  return null;
}

function controllerResult(payload, projectDir) {
  const handled = require('../../completion-controller').handlePayload(payload, { host: 'claude', projectDir });
  return handled && handled.result && handled.result.systemMessage ? { systemMessage: handled.result.systemMessage } : null;
}

const POST_CHECKS = [
  {
    // Tool-call counter: periodic L1 refresh and memory delta extraction.
    name: 'counter',
    run: async payload => {
      const notices = await require('../../counter').check(payload);
      return notices && notices.length ? { log: notices.join('\n') } : null;
    },
  },
  { name: 'verification-record', run: recordVerification },
  { name: 'completion-controller', accepts: shellOrWrite, run: controllerResult },
  {
    // What to declare after a shell run (D143_T015): inputs, slow or outputs for a declared
    // entry; the manifest for an undeclared slow command that repeated on the same files.
    name: 'declaration-after',
    accepts: isShellCall,
    run: (payload, projectDir) => {
      const hint = require('../../core/declaration-guidance').afterRun(payload, projectDir, { host: 'claude' });
      return hint ? { context: hint } : null;
    },
  },
  { name: 'doc-watchdog', accepts: isFileWrite, run: (payload, projectDir) => { require('../../doc-watchdog').recordEdit(payload, projectDir); return null; } },
  {
    name: 'skill-tracker',
    tools: ['Skill'],
    run: (payload, projectDir) => {
      const log = require('../../skill-tracker').trackSkill(payload, projectDir);
      return log ? { log } : null;
    },
  },
  {
    // Reading another project's .crabshell is allowed; the model is told after the read.
    // A read = a call with a path that is neither a shell call nor a write (a shell
    // read was already advised before it ran).
    name: 'path-advisory',
    accepts: payload => !shellOrWrite(payload),
    run: (payload, projectDir) => {
      const result = require('../../core/path-policy').evaluatePathPolicy(payload, projectDir);
      return result && result.advisory ? { context: result.advisory, log: result.diagnostic } : null;
    },
  },
];

const FAILURE_CHECKS = [
  { name: 'verification-record', accepts: isShellCall, run: recordVerification },
  { name: 'completion-controller', accepts: isShellCall, run: controllerResult },
];

async function main() {
  const payload = await readStdin(2000);
  if (!payload || !payload.tool_name) return;
  const projectDir = require('../../utils').getProjectDir();
  const failure = payload.hook_event_name === 'PostToolUseFailure';
  const collected = await runChecks(failure ? FAILURE_CHECKS : POST_CHECKS, payload, projectDir);
  emit(failure ? 'PostToolUseFailure' : 'PostToolUse', collected);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CRABSHELL POST-TOOL-USE ERROR] ${error.message}\n`);
  });
}

module.exports = { FAILURE_CHECKS, POST_CHECKS, main };
