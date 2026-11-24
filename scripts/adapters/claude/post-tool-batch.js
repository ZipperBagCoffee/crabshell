'use strict';

// Claude PostToolBatch (D186): once after every batch of tool calls, before the next model call. The
// skill check reads the whole batch, so it sees a Skill call anywhere in a Code Mode script.
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const { readStdin } = require('../../transcript-utils');
const { emit } = require('./dispatch');
const { runChecks } = require('../../core/dispatch');

const CHECKS = [
  {
    name: 'skill-check',
    run: (payload, projectDir) => {
      const text = require('../../skill-check').batchReminder(payload, projectDir);
      return text ? { context: text } : null;
    },
  },
];

async function main() {
  const payload = await readStdin(2000);
  if (!payload || payload.hook_event_name !== 'PostToolBatch') return;
  const projectDir = require('../../utils').getProjectDir();
  emit('PostToolBatch', await runChecks(CHECKS, payload, projectDir), { payload, projectDir });
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CRABSHELL POSTTOOLBATCH ERROR] ${error.message}\n`);
  });
}

module.exports = { CHECKS, main };
