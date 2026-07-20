'use strict';

const { readStdin } = require('../../transcript-utils');
const { buildCompactionContext, createCompactionOutput } = require('../../core/compaction-context');
const { normalizeCompaction } = require('./hook-contract');
const { runPostCompactEffects } = require('./post-compact-effects');

async function main() {
  const normalized = normalizeCompaction(await readStdin(2000), 'PostCompact');
  if (!normalized) return;
  const result = runPostCompactEffects(normalized.projectDir);
  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`[CRABSHELL] PostCompact: ${diagnostic}\n`);
  }
  const context = buildCompactionContext(normalized.projectDir);
  process.stdout.write(JSON.stringify(createCompactionOutput('PostCompact', context)) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CODEX POST-COMPACT HOOK ERROR] ${error.message}\n`);
  });
}

module.exports = { main };
