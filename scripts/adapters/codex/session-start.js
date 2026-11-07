'use strict';

const { readStdin } = require('../../transcript-utils');
const { buildMemoryContext, createSessionStartOutput } = require('../../core/memory-context');
const { normalizeSessionStart } = require('./hook-contract');

async function main() {
  const normalized = normalizeSessionStart(await readStdin(2000, { host: 'codex' }));
  if (!normalized) return;
  // The project's runner copy follows the installed plugin (D143_T016).
  let notices = [];
  try { notices = [require('../../core/runner-sync').runnerSyncNotice(normalized.projectDir)]; } catch {}
  const context = buildMemoryContext(normalized.projectDir, { source: normalized.source, sessionId: normalized.hookData.session_id, notices });
  process.stdout.write(JSON.stringify(createSessionStartOutput(context)) + '\n');
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CODEX SESSION START HOOK ERROR] ${error.message}\n`);
  });
}

module.exports = { main };
