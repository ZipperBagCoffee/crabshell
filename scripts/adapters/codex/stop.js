'use strict';

const { main } = require('../../completion-controller');

if (require.main === module) {
  main({ host: 'codex' }).catch(error => {
    process.stderr.write(`[CODEX STOP HOOK ERROR] ${error.message}\n`);
  });
}

module.exports = { main };
