'use strict';
// The runner's public names. forLauncher(dir) binds the ones that need a location
// (project root, manifest, results, the runner's own files) to the launcher's folder.

const { runnerLayout } = require('./layout');
const { parseArgs } = require('./args');
const { looksMachineAbsolute, resolveInside, validateEntry, expandEntries, selectEntries, globRegex } = require('./manifest');
const { readJsonPointer, evaluateAssertion, snapshotPaths } = require('./contract');
const { planRun } = require('./select');
const { runEntry } = require('./execute');
const { main } = require('./main');

function forLauncher(launcherDir) {
  const layout = runnerLayout(launcherDir);
  return {
    parseArgs,
    looksMachineAbsolute,
    resolveInside,
    validateEntry,
    readJsonPointer,
    evaluateAssertion,
    snapshotPaths,
    runEntry: (entry, options = {}) => runEntry(entry, { defaultProjectRoot: layout.defaultProjectRoot, ...options }),
    selectEntries,
    expandEntries,
    planRun,
    globRegex,
    main: (argv = process.argv.slice(2), options = {}) => main(argv, { layout, ...options }),
  };
}

module.exports = { forLauncher, runnerLayout };
