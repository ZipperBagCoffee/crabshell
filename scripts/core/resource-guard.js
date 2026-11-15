'use strict';
// D175_T002: declared work that must not overlap. PreToolUse judges a shell command that is a
// declared check or launch (verification manifest `entries` and `launches`):
// 1. it `uses` a resource another holder has — a live runner run's check that uses it or the
//    live process named in the resource's `lockFile`;
// 2. it measures time (`timing`) while heavy work runs — any live runner run, a held
//    resource, a declared heavy command or a `timingCompetitors` program anywhere;
// 3. it is heavy (`heavy` or `uses`) while a declared time measurement runs.
// The judgments live in skills/verifying/scripts/runner/overlap.js, shared with the runner.
// The process list is read only for 2 and 3. CRABSHELL_OVERLAP=1 runs anything anyway;
// CRABSHELL_OVERLAP=pid:<list> skips only those processes. A project with no such
// declaration costs one manifest read. Every failure means "no decision".

const path = require('path');
const { STORAGE_ROOT } = require('../constants');
const { shellCommand } = require('./tool-shape');
const { localTime } = require('./rerun-guard');
const { overrideSyntax, readJsonObject } = require('./overlap-text');

const RUNNER_DIR = '../../skills/verifying/scripts/runner';
const MANIFEST = path.join(STORAGE_ROOT, 'verification', 'manifest.json');
// How many running processes a refusal names before "and N more".
const MAX_LISTED = 5;

const runner = name => require(`${RUNNER_DIR}/${name}`);

// The override a command carries: { all } or { pids } or null.
function overrideOf(segments, variable) {
  for (const segment of segments) {
    const value = segment.env && segment.env[variable];
    if (value === '1') return { all: true };
    if (typeof value === 'string' && value.startsWith('pid:')) {
      return { pids: new Set(value.slice(4).split(',').map(Number).filter(pid => Number.isInteger(pid) && pid > 0)) };
    }
  }
  return null;
}

function describeHolder(holder) {
  if (holder.run) return `runner pid ${holder.run.pid}, which is running check ${holder.id}${holder.root ? ` in ${holder.root}` : ''}`;
  if (!holder.pid) return `an owner still writing \`${holder.file}\``;
  const since = Number.isFinite(holder.startedAt) ? `since ${localTime(new Date(holder.startedAt).toISOString())}` : '';
  const details = [holder.label, since].filter(Boolean).join(', ');
  return `pid ${holder.pid}${details ? ` (${details})` : ''} via \`${holder.file}\``;
}

const listing = items => {
  const shown = items.slice(0, MAX_LISTED);
  return `${shown.join('; ')}${items.length > MAX_LISTED ? `, and ${items.length - MAX_LISTED} more` : ''}`;
};

function resourceDecision(payload, projectDir) {
  try {
    const command = shellCommand(payload);
    if (!command || !projectDir) return null;
    const root = path.resolve(projectDir);
    const resources = runner('resources');
    const overlap = runner('overlap');
    const manifestPath = resources.manifestPathFor(root, MANIFEST);
    const manifest = manifestPath ? readJsonObject(manifestPath) : null;
    if (!manifest) return null;
    const declarations = overlap.declarationsOf(manifest, root);
    if (declarations.length === 0) return null;

    const runRecord = runner('run-record');
    const { shellSegments } = runner('command-match');
    const cwd = (payload.tool_input && payload.tool_input.workdir) || payload.cwd || root;
    const segments = shellSegments(command, cwd, { wrappers: manifest.wrappers });
    const override = overrideOf(segments, runRecord.OVERRIDE_ENV);
    if (override && override.all) return null;
    const skipped = override && override.pids ? override.pids : new Set();

    const roots = resources.worktrees(root);
    const here = overlap.rootFinder(roots)(cwd);
    const matches = overlap.matcher(roots, here);
    const matched = declarations.filter(item => segments.some(segment => matches(item, segment)));
    if (matched.length === 0) return null;
    const uses = [...new Set(matched.flatMap(overlap.usesOf))];
    const timing = matched.some(item => item.timing === true);
    const heavy = matched.some(overlap.isHeavy);

    const runs = overlap.liveRuns(roots, MANIFEST);
    let processes;
    const listProcesses = () => {
      if (processes === undefined) processes = resources.processList();
      return processes;
    };
    const mine = () => (Array.isArray(listProcesses()) ? resources.ancestorsOf(listProcesses(), process.pid) : new Set());

    // 1. A resource someone else holds.
    for (const name of uses) {
      const resource = resources.resourceOf(manifest, name);
      if (!resource) continue;
      let holders = overlap.holdersOf(manifest, name, { scopeRoots: resource.scope === 'repo' ? roots : [here], runs });
      if (holders.some(holder => holder.pid)) holders = holders.filter(holder => !holder.pid || resources.stillHolding(holder, listProcesses()));
      holders = holders.filter(holder => !skipped.has(holder.pid || (holder.run && holder.run.pid)));
      if (holders.length === 0) continue;
      const text = `\`${command}\` uses \`${name}\`, held by ${describeHolder(holders[0])}, which is still running.`;
      if (resource.onHeld === 'warn') return { context: `[CRABSHELL] ${text} It will wait for that holder, or fail if it does not wait.` };
      const pid = holders[0].pid || (holders[0].run && holders[0].run.pid);
      return { reason: `${text} Wait for it to end, or run it anyway with ${overrideSyntax(payload, command, runRecord.OVERRIDE_ENV, pid ? `pid:${pid}` : '1')}.` };
    }

    // 2. A time measurement beside heavy work.
    if (timing) {
      const list = listProcesses();
      const exclude = new Set([...skipped, ...mine()]);
      const blockers = overlap.timingBlockers({ manifest, declarations, runs, roots, processes: list, matches, exclude });
      if (blockers.length) {
        const shown = blockers.map(blocker => `pid ${blocker.pid}${blocker.argv ? ` \`${blocker.argv.slice(0, 3).join(' ')}\`` : ''} (${blocker.why})`);
        return { reason: `\`${command}\` measures time, and these are running: ${listing(shown)}. The numbers would include their load. Wait for them to end, or skip only these with ${overrideSyntax(payload, command, runRecord.OVERRIDE_ENV, `pid:${blockers.map(blocker => blocker.pid).join(',')}`)}.` };
      }
      if (list === null) return { context: '[CRABSHELL] Could not list processes; overlap with heavy work was not checked for this time measurement.' };
    }

    // 3. Heavy work while a declared time measurement runs.
    if (heavy && !timing) {
      const needsList = declarations.some(item => item.timing === true);
      const list = needsList ? listProcesses() : null;
      const found = overlap.measurements({ declarations, runs, roots, processes: list, matches, exclude: new Set([...skipped, ...(needsList ? mine() : [])]) });
      if (found.length) {
        return { reason: `\`${command}\` is heavy work, and pid ${found[0].pid} ${found[0].what} is measuring time; starting now would spoil that measurement. Wait for it to end, or run it anyway with ${overrideSyntax(payload, command, runRecord.OVERRIDE_ENV, `pid:${found.map(item => item.pid).join(',')}`)}.` };
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = { resourceDecision, overrideOf };
