'use strict';

// Claude PreToolUse for Bash, Write, Edit, WebFetch and WebSearch: every guard in this one process
// (hooks.json starts one process instead of one per guard). All guards run even
// after one denies, because some record state (a declared check starting, the
// parent's check preparation). verify-guard runs the declared checks and records
// nothing, so it is skipped once another guard has already denied.
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const { readStdin } = require('../../transcript-utils');
const { emit, runChecks } = require('./dispatch');

const WRITES = ['Write', 'Edit'];

function controllerResult(payload, projectDir) {
  const handled = require('../../completion-controller').handlePayload(payload, { host: 'claude', projectDir });
  return handled && handled.result && handled.result.systemMessage ? { systemMessage: handled.result.systemMessage } : null;
}

const CHECKS = [
  { name: 'completion-controller', tools: ['Bash'], run: controllerResult },
  {
    name: 'path-guard',
    tools: ['Bash', ...WRITES],
    run: (payload, projectDir) => {
      const result = require('../../core/path-policy').evaluatePathPolicy(payload, projectDir);
      return result && { reason: result.reason, context: result.advisory, log: result.diagnostic };
    },
  },
  {
    name: 'web-guard',
    tools: ['WebFetch', 'WebSearch'],
    run: (payload, projectDir) => {
      const result = require('../../web-guard').evaluateWebGuard(payload, projectDir);
      return result && { reason: result.block, context: result.warn };
    },
  },
  { name: 'regressing-guard', tools: WRITES, run: (payload, projectDir) => require('../../regressing-guard').evaluateRegressingGuard(payload, projectDir) },
  { name: 'docs-guard', tools: WRITES, run: (payload, projectDir) => require('../../docs-guard').evaluateDocsGuard(payload, projectDir) },
  { name: 'log-guard', tools: WRITES, run: (payload, projectDir) => require('../../log-guard').evaluateLogGuard(payload, projectDir) },
  {
    // Commit gate and declared-check start. It has no effect on Write/Edit.
    name: 'verification-gate',
    tools: ['Bash'],
    run: (payload, projectDir) => {
      const gate = require('../../verification-sequence').gateVerification(payload, projectDir);
      const log = [gate.notice, gate.reason].filter(Boolean).map(text => `[VERIFICATION_SEQ] ${text}`).join('\n');
      return { reason: gate.reason, context: gate.notice ? `[CRABSHELL] ${gate.notice}` : undefined, log: log || undefined };
    },
  },
  { name: 'doc-watchdog', tools: WRITES, run: (payload, projectDir) => require('../../doc-watchdog').gateEdit(payload, projectDir) },
  {
    name: 'verify-guard',
    tools: WRITES,
    when: collected => collected.reasons.length === 0,
    run: (payload, projectDir) => require('../../verify-guard').evaluateVerifyGuard(payload, projectDir),
  },
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
