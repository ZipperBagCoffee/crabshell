'use strict';

// Keep the background fail-open guard before imports.
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const { readStdin } = require('./transcript-utils');
const { getProjectDir } = require('./utils');
const { buildSubagentContext, createSubagentOutput } = require('./core/subagent-context');

async function main(options = {}) {
  if (!options.hookData) {
    try { await readStdin(2000); } catch {}
  }
  const projectDir = options.projectDir || getProjectDir();
  const context = buildSubagentContext(projectDir);
  process.stdout.write(JSON.stringify(createSubagentOutput(context)));
  process.stderr.write(`[CRABSHELL] SubagentStart: additionalContext ${context.length} chars\n`);
  return context;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CRABSHELL] SubagentStart error: ${error.message}\n`);
    process.stdout.write(JSON.stringify(createSubagentOutput('')));
  });
}

module.exports = { main };
