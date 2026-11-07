'use strict';

// Crabshell verification runner — launcher. It sits beside
// .crabshell/verification/manifest.json; the runner's modules sit in the runner/
// folder next to it. This file only binds them to its own location: the manifest,
// the results file and the project root are found from here.

const fs = require('fs');
const path = require('path');

const moduleDir = path.join(__dirname, 'runner');
if (!fs.existsSync(path.join(moduleDir, 'index.js'))) {
  const message = `run-verify.js: its runner/ folder is missing beside it (${moduleDir}); copy skills/verifying/scripts/runner/ from the Crabshell plugin there.`;
  if (require.main === module) {
    console.error(message);
    process.exit(1);
  }
  throw new Error(message);
}

module.exports = require('./runner').forLauncher(__dirname);

// main returns the exit code, or a promise of it when checks run side by side (`jobs`).
if (require.main === module) Promise.resolve(module.exports.main()).then(code => process.exit(code));
