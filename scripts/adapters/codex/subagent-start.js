'use strict';

const { readStdin } = require('../../transcript-utils');
const { buildSubagentContext, createSubagentOutput } = require('../../core/subagent-context');
const { normalizeSubagentStart } = require('./hook-contract');

async function main() {
  const normalized = normalizeSubagentStart(await readStdin(2000));
  if (!normalized) return;
  const context = buildSubagentContext(normalized.projectDir);
  process.stdout.write(JSON.stringify(createSubagentOutput(context)) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CODEX SUBAGENT START HOOK ERROR] ${error.message}\n`);
  });
}

module.exports = { main };
