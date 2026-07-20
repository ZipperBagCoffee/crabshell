'use strict';

const { main } = require('../../completion-controller');

if (require.main === module) {
  main({ host: 'codex' }).catch(error => {
    process.stderr.write(`[CODEX POST TOOL HOOK ERROR] ${error.message}\n`);
  });
}

module.exports = { main };
