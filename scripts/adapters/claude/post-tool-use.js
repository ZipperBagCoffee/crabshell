'use strict';

// Claude PostToolUse (every tool) and PostToolUseFailure (Bash): all observers in
// this one process instead of one process per script.
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const { readStdin } = require('../../transcript-utils');
const { emit, runChecks } = require('./dispatch');

const WRITES = ['Write', 'Edit'];

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
  { name: 'completion-controller', tools: ['Bash', ...WRITES], run: controllerResult },
  { name: 'doc-watchdog', tools: WRITES, run: (payload, projectDir) => { require('../../doc-watchdog').recordEdit(payload, projectDir); return null; } },
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
    name: 'path-advisory',
    tools: ['Read', 'Grep', 'Glob'],
    run: (payload, projectDir) => {
      const result = require('../../core/path-policy').evaluatePathPolicy(payload, projectDir);
      return result && result.advisory ? { context: result.advisory, log: result.diagnostic } : null;
    },
  },
];

const FAILURE_CHECKS = [
  { name: 'verification-record', tools: ['Bash'], run: recordVerification },
  { name: 'completion-controller', tools: ['Bash'], run: controllerResult },
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
