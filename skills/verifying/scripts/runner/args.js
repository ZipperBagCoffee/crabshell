'use strict';
// Command-line flags of the runner.

function parseArgs(argv) {
  const parsed = {
    // Entry ids named on the command line (D151_T001: several in one call).
    targetIds: [],
    flat: process.env.CRABSHELL_VERIFY_FLAT === '1',
    changed: false,
    dryRun: false,
    json: process.env.CRABSHELL_VERIFY_JSON === '1',
    reuse: true,
    files: null,
    slow: false,
    // D143: comparing a changed test with HEAD ran it twice more on every change; it
    // is opt-in now (--fail-before), for a test written to catch a bug.
    failBefore: false,
    error: null
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--flat' || arg === '-f') parsed.flat = true;
    else if (arg === '--changed') parsed.changed = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    // D143_T015: what a --changed run would run and why, in plain lines; nothing runs.
    else if (arg === '--explain') { parsed.explain = true; parsed.changed = true; parsed.dryRun = true; }
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--no-reuse') parsed.reuse = false;
    // Guards pass --no-fail-before; the flag still marks a guard run (no saved results,
    // array printed) now that the comparison itself is off by default.
    else if (arg === '--no-fail-before') { parsed.failBefore = false; parsed.guardRun = true; }
    else if (arg === '--fail-before') parsed.failBefore = true;
    else if (arg === '--slow') parsed.slow = true;
    // D151: what routine runs would have cost on the last N commits, from the records.
    else if (arg === '--replay') {
      const count = Number(argv[++index]);
      if (!Number.isInteger(count) || count < 1) { parsed.error = '--replay needs a number of commits (1 or more)'; break; }
      parsed.replay = count;
    }
    else if (arg === '--files') {
      const value = argv[++index];
      if (!value) { parsed.error = '--files needs a comma-separated list'; break; }
      parsed.files = value.split(',').map(item => item.trim()).filter(Boolean);
    } else if (arg.startsWith('-')) {
      parsed.error = `Unknown flag: ${arg}`;
      break;
    } else parsed.targetIds.push(arg);
  }
  return parsed;
}

module.exports = { parseArgs };
