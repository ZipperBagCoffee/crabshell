'use strict';

// Claude UserPromptExpansion (D186): a /command the user typed, before it reaches the model. Recorded so the
// skill check after the first batch counts the typed skill as opened; prints nothing.
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const { readStdin } = require('../../transcript-utils');
const { emit } = require('./dispatch');
const { runChecks } = require('../../core/dispatch');

const CHECKS = [
  {
    name: 'skill-check-expansion',
    run: (payload, projectDir) => {
      require('../../skill-check').noteExpansion(payload, projectDir);
      return null;
    },
  },
];

async function main() {
  const payload = await readStdin(2000);
  if (!payload || payload.hook_event_name !== 'UserPromptExpansion') return;
  const projectDir = require('../../utils').getProjectDir();
  emit('UserPromptExpansion', await runChecks(CHECKS, payload, projectDir), { payload, projectDir });
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`[CRABSHELL USERPROMPTEXPANSION ERROR] ${error.message}\n`);
  });
}

module.exports = { CHECKS, main };
