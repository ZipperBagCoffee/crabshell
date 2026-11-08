'use strict';
// The manifest's own run settings, each with the kind of value it takes. They decide how a
// run goes (how many checks side by side, retries, notices), not whether a check passes, so
// they live outside the modules that make up the runner identity (layout.js): adding one
// does not rerun every check. The verifying skill must document every name (D145_T002).

const { validateSettings } = require('./manifest');

const MANIFEST_SETTINGS = {
  exclude: 'paths', wrappers: 'names', passHistory: 'count', jobs: 'count', retries: 'whole',
  slowAfterSeconds: 'seconds', suggestAfterSeconds: 'seconds', memoryShare: 'share',
  minFreeMemoryMB: 'whole', startSpacingMs: 'whole', copyLiteralMinChars: 'count', riskPaths: 'paths',
  // D152: the project command that prints the fingerprint of every item in the files it is given.
  itemIdentity: 'command',
};

function validateManifestSettings(manifest) {
  validateSettings(manifest, MANIFEST_SETTINGS, 'manifest', 'manifest');
}

module.exports = { MANIFEST_SETTINGS, validateManifestSettings };
