'use strict';
// The manifest's own run settings, each with the kind of value it takes. They decide how a
// run goes (how many checks side by side, retries, notices), not whether a check passes, so
// they live outside the modules that make up the runner identity (layout.js): adding one
// does not rerun every check. The verifying skill must document every name (D145_T002).

const { validateSettings } = require('./manifest');
const { checkedRegex } = require('./checked-names');

const MANIFEST_SETTINGS = {
  exclude: 'paths', wrappers: 'names', passHistory: 'count', jobs: 'count', retries: 'whole',
  slowAfterSeconds: 'seconds', suggestAfterSeconds: 'seconds', memoryShare: 'share',
  minFreeMemoryMB: 'whole', startSpacingMs: 'whole', copyLiteralMinChars: 'count', riskPaths: 'paths',
  // D152: the project command that prints the fingerprint of every item in the files it is given.
  itemIdentity: 'command',
  // D171: when the wide-selection notice prints (the share of all checks the changes pulled
  // in, and the fewest such checks).
  wideSelectionShare: 'share', wideSelectionMinChecks: 'count',
  // D175: work that must not overlap — declared resources (who holds them), commands that are
  // not checks (`launches`), programs that spoil a time measurement wherever they run, and how
  // long a check waits for a resource or for another run.
  resources: 'other', launches: 'other', timingCompetitors: 'names', resourceWaitSeconds: 'whole',
  // D175_T003: what PreToolUse does when another worktree has changes to the inputs of a
  // command that makes files (`outputs`): warn (default) or refuse.
  pendingInputs: 'other',
  checkedPattern: 'other', quarantineDays: 'count',
};
const MANIFEST_CHOICES = { pendingInputs: ['warn', 'refuse'] };

const RESOURCE_SETTINGS = { lockFile: 'paths', pidKey: 'name', staleAfterSeconds: 'seconds' };
const RESOURCE_CHOICES = { scope: ['worktree', 'repo'], onHeld: ['refuse', 'warn'] };
const LAUNCH_SETTINGS = { name: 'name', command: 'command', whenArgs: 'names', uses: 'names', heavy: 'flag', timing: 'flag', inputs: 'paths', outputs: 'paths' };

function validateChoices(object, choices, label) {
  for (const [field, allowed] of Object.entries(choices)) {
    if (object[field] !== undefined && !allowed.includes(object[field])) throw new Error(`${label} ${field} must be one of ${allowed.join(', ')}`);
  }
}

// D175: each declared resource and launch, and every `uses` naming a declared resource.
function validateOverlapSettings(manifest) {
  validateChoices(manifest, MANIFEST_CHOICES, 'manifest');
  const resources = manifest.resources === undefined ? {} : manifest.resources;
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) throw new Error('manifest resources must be an object of named resources');
  for (const [name, resource] of Object.entries(resources)) {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) throw new Error(`manifest resources.${name} must be an object`);
    validateSettings({ ...resource, lockFile: resource.lockFile === undefined ? undefined : [resource.lockFile] }, RESOURCE_SETTINGS, `resources.${name}:`, `resources.${name}`);
    validateChoices(resource, RESOURCE_CHOICES, `resources.${name}:`);
  }
  const declared = new Set(Object.keys(resources));
  const usesKnown = (uses, label) => {
    for (const name of uses || []) if (!declared.has(name)) throw new Error(`${label} uses ${name}, which manifest resources does not declare`);
  };
  if (manifest.launches !== undefined && !Array.isArray(manifest.launches)) throw new Error('manifest launches must be an array');
  for (const [index, launch] of (manifest.launches || []).entries()) {
    const label = `launches[${index}]${launch && launch.name ? ` (${launch.name})` : ''}:`;
    if (!launch || typeof launch !== 'object' || Array.isArray(launch)) throw new Error(`${label} must be an object`);
    if (launch.name === undefined || launch.command === undefined) throw new Error(`${label} needs a name and a command`);
    validateSettings(launch, LAUNCH_SETTINGS, label, `launches[${index}]`);
    usesKnown(launch.uses, label);
  }
  for (const entry of Array.isArray(manifest.entries) ? manifest.entries : []) {
    if (entry && Array.isArray(entry.uses)) usesKnown(entry.uses, `${entry.id}:`);
  }
}

function validateManifestSettings(manifest) {
  validateSettings(manifest, MANIFEST_SETTINGS, 'manifest', 'manifest');
  checkedRegex(manifest.checkedPattern, 'manifest checkedPattern');
  for (const entry of Array.isArray(manifest.entries) ? manifest.entries : []) {
    if (entry) checkedRegex(entry.checkedPattern, `${entry.id} checkedPattern`);
  }
  validateOverlapSettings(manifest);
}

module.exports = { MANIFEST_SETTINGS, validateManifestSettings };
