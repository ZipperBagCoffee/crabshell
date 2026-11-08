'use strict';
// When each chosen check starts (D143 §4, D151_T001): one at a time, or side by side
// within `jobs` and the CPUs, keeping an exclusive check alone, a `group` in turn, and a
// check after the checks it waits for (waitsFor: an index, a list of them, or undefined — the
// check that covers it, the gates of a check narrowed by its report). Side by side, checks
// start one at a time: the next one starts only after a check finishes or `startSpacingMs` has passed, and only
// while memoryAllows() — so the memory a started check takes is seen before the next start
// (starting several in one pass let all of them past the memory gate). One check always
// runs. After a stop no new check starts; the running ones finish.
//
// after.stopped() — a new failure stopped the run; after.skip(index) — not started;
// after.done(index, result) — finished. start(index) returns a result or its promise.

const os = require('os');
const { runsOnRunnerNode } = require('./fingerprint');

function machineParallelism() {
  return typeof os.availableParallelism === 'function' ? os.availableParallelism() : (os.cpus().length || 1);
}

// How many checks may run at once: `jobs`, but never more than this machine can run in
// parallel (os.availableParallelism, or the CPU count on older Node).
function concurrencyLimit(jobs) {
  return Math.max(1, Math.min(jobs, machineParallelism()));
}

// Side-by-side checks when a manifest sets no `jobs`: half of what this machine can run.
function defaultJobs() {
  return Math.max(1, Math.floor(machineParallelism() / 2));
}

// Whether a check runs alone (D151_T001): its entry's `exclusive` decides; with a declared
// `jobs` every check may share; otherwise only a check its last run traced completely as
// running on the runner's Node shares — a first run, declared inputs or another program runs alone.
function runsAlone(entry, record, jobsDeclared) {
  if (typeof entry.exclusive === 'boolean') return entry.exclusive;
  if (jobsDeclared) return false;
  // A check that reports what it used keeps the kind its trace gave it as `base` (D152).
  const traced = Boolean(record) && (record.kind === 'traced' || (record.kind === 'reported' && record.base === 'traced'));
  return !(traced && runsOnRunnerNode(entry.command));
}

function runInOrder({ order, start, after }) {
  for (const index of order) {
    if (after.stopped()) { after.skip(index); continue; }
    after.done(index, start(index));
  }
}

const pause = ms => new Promise(resolve => setTimeout(() => resolve(null), ms));

async function runSideBySide({ order, entries, start, after, jobs, waitsFor,
  memoryAllows = () => true, isExclusive = index => entries[index].exclusive === true, startSpacingMs = 0 }) {
  const limit = concurrencyLimit(jobs);
  const pending = [...order];
  const running = new Map();
  const finished = new Set();
  const ready = index => [].concat(waitsFor(index) === undefined ? [] : waitsFor(index)).every(parent => finished.has(parent));
  const fits = index => {
    const entry = entries[index];
    if (!ready(index)) return false;
    if (running.size === 0) return true;
    if (running.size >= limit || isExclusive(index)) return false;
    for (const other of running.keys()) {
      if (isExclusive(other)) return false;
      if (entry.group !== undefined && entries[other].group === entry.group) return false;
    }
    return memoryAllows();
  };
  const launch = index => {
    const value = start(index);
    running.set(index, Promise.resolve(value).then(result => ({ index, result })));
  };
  while (pending.length || running.size) {
    let launched = false;
    if (after.stopped()) {
      for (const index of pending.splice(0)) after.skip(index);
    } else {
      // The next check in order that can start. A check that must run alone and is ready
      // holds its place: later checks do not start ahead of it (the order puts likely
      // failures first), they wait until it has run.
      let position = -1;
      for (let at = 0; at < pending.length; at++) {
        if (fits(pending[at])) { position = at; break; }
        if (isExclusive(pending[at]) && ready(pending[at])) break;
      }
      if (position >= 0) { launch(pending.splice(position, 1)[0]); launched = true; }
    }
    if (running.size === 0) {
      // Nothing could start (a covered check whose covering check is not in this run):
      // start the next one by itself rather than wait forever.
      if (pending.length && !after.stopped()) { launch(pending.shift()); launched = true; }
      else break;
    }
    // Wait for a check to finish; after a start with room for more, also wake when the
    // spacing has passed, to measure memory again and maybe start the next one.
    const waits = [...running.values()];
    if (launched && pending.length && running.size < limit) waits.push(pause(startSpacingMs));
    const settled = await Promise.race(waits);
    if (!settled) continue;
    running.delete(settled.index);
    finished.add(settled.index);
    after.done(settled.index, settled.result);
  }
}

module.exports = { concurrencyLimit, defaultJobs, runsAlone, runInOrder, runSideBySide };
