'use strict';

const { readStdin } = require('../../transcript-utils');
const { evaluatePathPolicy } = require('../../core/path-policy');
const { denyOutput, normalizePreToolUse } = require('./hook-contract');

async function main() {
  const normalized = normalizePreToolUse(await readStdin());
  if (!normalized) return;
  const result = evaluatePathPolicy(normalized.hookData, normalized.projectDir);
  if (!result) return;
  process.stderr.write(result.diagnostic + '\n');
  console.log(JSON.stringify(denyOutput(result.reason)));
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[CODEX PATH GUARD ERROR] ${error.message}`);
  });
}

module.exports = { main };
