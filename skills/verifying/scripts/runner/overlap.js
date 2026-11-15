'use strict';
// Overlap judgments shared by the runner and the PreToolUse hook (D175_T002): which declared
// checks and launches take part, whether a command or a running process is one of them, who
// holds a declared resource, and what would spoil a time measurement. The facts come from
// resources.js (lock files, processes, worktrees) and run-record.js (live runs); this module
// only decides. Every function is pure over its inputs and safe on bad ones.

const path = require('path');
const resources = require('./resources');
const runRecord = require('./run-record');
const { matchesCommand, programMatches } = require('./command-match');

// How far a process's start time may sit from the one its run record wrote (clock reads differ).
const PID_START_TOLERANCE_MS = 5000;

const takesPart = item => Boolean(item) && ((Array.isArray(item.uses) && item.uses.length > 0) || item.heavy === true || item.timing === true);

// The checks (`entries`) and `launches` that take part: those with uses, heavy or timing. A
// manifest that declares none of these is not expanded (discovery walks the files, and the
// hook asks on every shell call).
function declarationsOf(manifest, root) {
  if (!manifest || typeof manifest !== 'object') return [];
  const raw = Array.isArray(manifest.entries) ? manifest.entries : [];
  const launches = Array.isArray(manifest.launches) ? manifest.launches : [];
  if (!raw.some(takesPart) && !launches.some(takesPart)) return [];
  let entries = raw;
  try { entries = require('./manifest').expandEntries(manifest, root); } catch (_) {}
  return [...entries.map(entry => ({ ...entry, label: entry.id })), ...launches.map(launch => ({ ...launch, label: launch.name }))]
    .filter(item => item && item.command && typeof item.command === 'object' && !Array.isArray(item.command) && takesPart(item));
}

const usesOf = item => (item && Array.isArray(item.uses) ? item.uses : []);
const isHeavy = item => Boolean(item) && (item.heavy === true || usesOf(item).length > 0);

// The worktree root a folder is in: one of roots when they are known (git listed them), else
// the nearest folder holding a `.git` entry (files only, no git process), else the folder.
function rootFinder(roots) {
  if (!Array.isArray(roots)) return folder => resources.gitFolderAbove(folder) || folder;
  return folder => roots.find(root => {
    const relative = path.relative(root, path.resolve(folder));
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }) || folder;
}

// Whether a live run's record still belongs to the process that wrote it: a pid another
// process took over (it started at another time) does not count. Unknown times count.
function runStillLive(run, processes) {
  if (!Array.isArray(processes)) return true;
  const item = processes.find(entry => entry.pid === run.pid);
  if (!item) return false;
  return !(Number.isFinite(item.startedAt) && Number.isFinite(run.processStartedAt) && Math.abs(item.startedAt - run.processStartedAt) > PID_START_TOLERANCE_MS);
}

// (declaration, segment) => whether the segment runs it, paths read from each side's
// worktree root; a segment with no folder is read from `here`.
function matcher(roots, here) {
  const rootOf = rootFinder(roots);
  return (item, segment) => matchesCommand(item.command, segment, {
    declaredCwd: path.resolve(segment && segment.cwd ? rootOf(segment.cwd) : here, item.command.cwd || '.'),
    rootOf,
    whenArgs: Array.isArray(item.whenArgs) ? item.whenArgs : [],
  });
}

// The live runs of every worktree (each worktree's records sit beside its manifest).
function liveRuns(roots, manifestRelative, exclude) {
  return roots.flatMap(root => runRecord.liveRecords(path.join(root, manifestRelative), exclude ? { exclude } : undefined)
    .map(run => ({ run, root })));
}

// Who holds resource `name` within scopeRoots: a live run's check that uses it
// ({ run, id, root }) or the live process named in the resource's lock file.
function holdersOf(manifest, name, { scopeRoots, runs }) {
  const resource = resources.resourceOf(manifest, name);
  if (!resource) return [];
  const found = [];
  for (const { run, root } of runs) {
    if (!scopeRoots.includes(root)) continue;
    for (const item of Array.isArray(run.running) ? run.running : []) {
      if (item && usesOf(item).includes(name)) found.push({ run, id: item.id, root });
    }
  }
  for (const root of scopeRoots) {
    const holder = resources.lockHolder(root, resource);
    if (holder && !holder.unknown) found.push(holder);
  }
  return found;
}

// A listed process as a command segment: its folder is the worktree an absolute argument is in.
function processSegment(item, roots) {
  const rootOf = rootFinder(roots);
  const absolute = item.argv.map(token => token.replace(/\\/g, '/')).find(token => path.isAbsolute(token) && rootOf(token) !== token);
  return { tokens: item.argv, cwd: absolute ? rootOf(absolute) : null, env: {} };
}

// Whether a listed process runs a declaration. A declared command is known by its arguments
// (its interpreter, such as node or python, runs much else), so a process whose arguments
// cannot be read is not one; programs named in `timingCompetitors` are matched by name alone.
function processRuns(item, declaration, roots, matches) {
  return !item.unknownArgs && matches(declaration, processSegment(item, roots));
}

// What would spoil a time measurement now: live runs executing a check (a run that only waits
// is no load, and counting it would make two runs wait for each other), held declared
// resources, and running declared heavy commands or `timingCompetitors` programs.
// exclude: pids to leave out.
function timingBlockers({ manifest, declarations, runs, roots, processes, matches, exclude = new Set() }) {
  const blockers = [];
  for (const { run, root } of runs) {
    const busy = Array.isArray(run.running) && run.running.length > 0;
    if (busy && runStillLive(run, processes)) blockers.push({ pid: run.pid, why: `runner run in ${root}` });
  }
  for (const name of Object.keys((manifest && manifest.resources) || {})) {
    for (const holder of holdersOf(manifest, name, { scopeRoots: roots, runs: [] })) {
      if (holder.pid) blockers.push({ pid: holder.pid, why: `holds \`${name}\` via \`${holder.file}\`` });
    }
  }
  const heavy = declarations.filter(isHeavy);
  const competitors = Array.isArray(manifest && manifest.timingCompetitors) ? manifest.timingCompetitors : [];
  for (const item of Array.isArray(processes) ? processes : []) {
    if (exclude.has(item.pid)) continue;
    const declared = heavy.find(declaration => processRuns(item, declaration, roots, matches));
    const glob = declared ? null : competitors.find(pattern => programMatches(pattern, item.name) || programMatches(pattern, item.argv[0] || ''));
    if (declared) blockers.push({ pid: item.pid, why: `declared heavy command ${declared.label}`, argv: item.argv });
    else if (glob) blockers.push({ pid: item.pid, why: `timing competitor \`${glob}\``, argv: item.argv });
  }
  return [...new Map(blockers.filter(blocker => !exclude.has(blocker.pid)).map(blocker => [blocker.pid, blocker])).values()];
}

// The time measurements running now: a live run's timing check, or a running declared
// timing command. exclude: pids to leave out.
function measurements({ declarations, runs, roots, processes, matches, exclude = new Set() }) {
  const found = [];
  for (const { run } of runs) {
    if (!runStillLive(run, processes)) continue;
    for (const item of Array.isArray(run.running) ? run.running : []) {
      if (item && item.timing === true && !exclude.has(run.pid)) found.push({ pid: run.pid, what: `runner check ${item.id}` });
    }
  }
  const timing = declarations.filter(item => item.timing === true);
  for (const item of Array.isArray(processes) ? processes : []) {
    if (exclude.has(item.pid)) continue;
    const declared = timing.find(declaration => !item.unknownArgs && matches(declaration, processSegment(item, roots)));
    if (declared) found.push({ pid: item.pid, what: `\`${item.argv.slice(0, 3).join(' ')}\` (${declared.label})` });
  }
  return found;
}

// The name a wait for heavy work (before a time measurement) is kept under.
const TIMING = Symbol('timing');

function describeWait(item) {
  if (item.name === TIMING) return `heavy work to end (pid ${item.blocker.pid}: ${item.blocker.why})`;
  const holder = item.holder;
  const who = holder.run ? `runner pid ${holder.run.pid} running ${holder.id}` : holder.pid ? `pid ${holder.pid} via ${holder.file}` : `an owner still writing ${holder.file}`;
  return `\`${item.name}\` (held by ${who})`;
}

// The runner's waits (D175_T002): freeAt(entry) waits while a declared resource the check uses
// is held elsewhere (another live run's check, or a lock file's live process that is not this
// run's ancestor), or — for a timing check — while heavy work runs (another live run anywhere,
// a held resource, a declared heavy command or a timing competitor). It returns null when the
// check may start, or the reason it is not run after waitLimitMs (then later checks of the same
// resource are not run without waiting again). Directly when sync, else as a promise.
function runnerWaits({ manifest, manifestPath, projectRoot, run, entries, sync, waitLimitMs, log = message => console.error(message) }) {
  if (!entries.some(entry => usesOf(entry).length || entry.timing === true)) return () => null;
  const declarations = declarationsOf(manifest, projectRoot);
  const manifestRelative = path.relative(projectRoot, manifestPath);
  let roots = null;
  const rootsNow = () => roots || (roots = resources.worktrees(projectRoot));
  const runsNow = () => liveRuns(rootsNow(), manifestRelative, run.ancestors);
  const ownTree = list => (Array.isArray(list) ? resources.ancestorsOf(list, process.pid) : new Set([process.pid]));
  const gaveUp = new Set();
  const seconds = Math.round(waitLimitMs / 1000);

  const resourceWaits = name => {
    const resource = resources.resourceOf(manifest, name);
    if (!resource) return [];
    let holders = holdersOf(manifest, name, { scopeRoots: resource.scope === 'repo' ? rootsNow() : [path.resolve(projectRoot)], runs: runsNow() });
    if (holders.length) {
      // Only when there is something to wait for: confirm each holder against the processes.
      const list = resources.processList();
      const mine = ownTree(list);
      holders = holders.filter(holder => (holder.run ? runStillLive(holder.run, list)
        : !holder.pid || (!mine.has(holder.pid) && !run.ancestors.includes(holder.pid) && resources.stillHolding(holder, list))));
    }
    return holders.map(holder => ({ name, holder }));
  };
  const timingWaits = () => {
    const list = resources.processList();
    const exclude = new Set([...ownTree(list), ...run.ancestors]);
    return timingBlockers({ manifest, declarations, runs: runsNow(), roots: rootsNow(), processes: list, matches: matcher(rootsNow(), path.resolve(projectRoot)), exclude })
      .map(blocker => ({ name: TIMING, blocker }));
  };

  return entry => {
    const names = usesOf(entry);
    const timing = entry.timing === true;
    if (!names.length && !timing) return null;
    const over = names.find(name => gaveUp.has(name)) || (timing && gaveUp.has(TIMING) ? TIMING : undefined);
    if (over !== undefined) return `Not run: an earlier check of this run waited ${seconds}s for ${over === TIMING ? 'heavy work to end' : `\`${over}\``} and gave up.`;
    const pending = () => [...names.flatMap(resourceWaits), ...(timing ? timingWaits() : [])];
    const waited = runRecord.waitWhile(pending, { timeoutMs: waitLimitMs, stepMs: timing ? 2000 : 1000, sync,
      onWait: item => log(`[VERIFY] Waiting for ${describeWait(item)} before ${entry.id}.`) });
    return runRecord.then(waited, ({ waitedFor, timedOut }) => {
      if (!timedOut) return null;
      gaveUp.add(waitedFor.name);
      return `Not run: waited ${seconds}s for ${describeWait(waitedFor)}.`;
    });
  };
}

module.exports = { declarationsOf, usesOf, isHeavy, rootFinder, matcher, liveRuns, holdersOf, runStillLive, processSegment, processRuns, timingBlockers, measurements, runnerWaits };
