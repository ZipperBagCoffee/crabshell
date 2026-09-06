'use strict';

const { readStdin } = require('../../transcript-utils');
const { evaluatePathPolicy } = require('../../core/path-policy');
const { denyOutput, normalizePreToolUse } = require('./hook-contract');
const { prepareParentCheck } = require('../../core/completion-control');
const { gateVerification } = require('../../verification-sequence');

async function main() {
  const payload = await readStdin(500, { host: 'codex' });
  const normalized = normalizePreToolUse(payload);
  if (!normalized) return;
  const result = evaluatePathPolicy(normalized.hookData, normalized.projectDir);
  if (!result) {
    if (normalized.hookData.tool_name === 'Bash') {
      const commandPayload = { ...payload, tool_name: 'Bash',
        tool_input: { ...payload.tool_input, command: payload.tool_input?.command || payload.tool_input?.cmd } };
      const gate = gateVerification(commandPayload, normalized.projectDir);
      if (gate.reason) { console.log(JSON.stringify(denyOutput(gate.reason))); return; }
      prepareParentCheck(normalized.projectDir, commandPayload);
    }
    return;
  }
  process.stderr.write(result.diagnostic + '\n');
  console.log(JSON.stringify(denyOutput(result.reason)));
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[CODEX PATH GUARD ERROR] ${error.message}`);
  });
}

module.exports = { main };
