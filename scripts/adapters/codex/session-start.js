'use strict';

const { readStdin } = require('../../transcript-utils');
const { buildMemoryContext, createSessionStartOutput } = require('../../core/memory-context');
const { normalizeSessionStart } = require('./hook-contract');

async function main() {
  const normalized = normalizeSessionStart(await readStdin(2000));
  if (!normalized) return;
  const context = buildMemoryContext(normalized.projectDir, { source: normalized.source });
  process.stdout.write(JSON.stringify(createSessionStartOutput(context)) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CODEX SESSION START HOOK ERROR] ${error.message}\n`);
  });
}

module.exports = { main };
