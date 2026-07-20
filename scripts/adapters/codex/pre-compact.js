'use strict';

const { readStdin } = require('../../transcript-utils');
const { buildCompactionContext, createCompactionOutput } = require('../../core/compaction-context');
const { normalizeCompaction } = require('./hook-contract');

async function main() {
  const normalized = normalizeCompaction(await readStdin(2000), 'PreCompact');
  if (!normalized) return;
  const context = buildCompactionContext(normalized.projectDir);
  process.stdout.write(JSON.stringify(createCompactionOutput('PreCompact', context)) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CODEX PRE-COMPACT HOOK ERROR] ${error.message}\n`);
  });
}

module.exports = { main };
