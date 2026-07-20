'use strict';

const { readStdin } = require('./transcript-utils');

// F1 mitigation: keep the host wrapper fail-open during background summarization.
if (process.env.CRABSHELL_BACKGROUND === '1') process.exit(0);

const { getProjectDir } = require('./utils');
const pathPolicy = require('./core/path-policy');

async function main() {
  const hookData = await readStdin();
  const result = pathPolicy.evaluatePathPolicy(hookData, getProjectDir());
  if (!result) return;
  process.stderr.write(result.diagnostic + '\n');
  console.log(JSON.stringify({ decision: 'block', reason: result.reason }));
  process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[PATH GUARD ERROR] ${error.message}`);
    process.exitCode = 0;
  });
}

module.exports = pathPolicy;
