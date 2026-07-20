'use strict';

const { readStdin } = require('../../transcript-utils');
const { main: runSharedUserPromptHook } = require('../../inject-rules');
const { normalizeUserPromptSubmit } = require('./hook-contract');

async function main() {
  const normalized = normalizeUserPromptSubmit(await readStdin(2000));
  if (!normalized) return;
  await runSharedUserPromptHook({
    hookData: normalized.hookData,
    projectDir: normalized.projectDir,
    host: 'codex',
    pluginDataDir: process.env.PLUGIN_DATA,
  });
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CODEX USER PROMPT HOOK ERROR] ${error.message}\n`);
  });
}

module.exports = { main };
