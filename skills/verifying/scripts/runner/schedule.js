'use strict';
// When each chosen check starts (D143 §4): one at a time, or side by side within `jobs`,
// the CPUs and `memoryShare` (the share of memory in use above which no further check
// starts; one always runs), keeping an `exclusive` check alone, a `group` in turn, and a
// covered check after the check that covers it. After a stop no new check starts; the
// running ones finish.
//
// after.stopped() — a new failure stopped the run; after.skip(index) — not started;
// after.done(index, result) — finished. start(index) returns a result or its promise.

const os = require('os');

// How many checks may run at once: `jobs`, but never more than this machine can run in
// parallel (os.availableParallelism, or the CPU count on older Node).
function concurrencyLimit(jobs) {
  const machine = typeof os.availableParallelism === 'function' ? os.availableParallelism() : (os.cpus().length || 1);
  return Math.max(1, Math.min(jobs, machine));
}

function runInOrder({ order, start, after }) {
  for (const index of order) {
    if (after.stopped()) { after.skip(index); continue; }
    after.done(index, start(index));
  }
}

async function runSideBySide({ order, entries, start, after, jobs, memoryShare, waitsFor }) {
  const limit = concurrencyLimit(jobs);
  const pending = [...order];
  const running = new Map();
  const finished = new Set();
  const memoryInUse = () => 1 - os.freemem() / os.totalmem();
  const fits = index => {
    const entry = entries[index];
    const parent = waitsFor(index);
    if (parent !== undefined && !finished.has(parent)) return false;
    if (running.size === 0) return true;
    if (running.size >= limit || entry.exclusive === true) return false;
    for (const other of running.keys()) {
      if (entries[other].exclusive === true) return false;
      if (entry.group !== undefined && entries[other].group === entry.group) return false;
    }
    return memoryInUse() <= memoryShare;
  };
  const launch = index => {
    const value = start(index);
    running.set(index, Promise.resolve(value).then(result => ({ index, result })));
  };
  while (pending.length || running.size) {
    if (after.stopped()) {
      for (const index of pending.splice(0)) after.skip(index);
    } else {
      for (let position = 0; position < pending.length;) {
        if (fits(pending[position])) launch(pending.splice(position, 1)[0]);
        else position++;
      }
    }
    if (running.size === 0) {
      // Nothing could start (a covered check whose covering check is not in this run):
      // start the next one by itself rather than wait forever.
      if (pending.length && !after.stopped()) { launch(pending.shift()); }
      else break;
    }
    const { index, result } = await Promise.race(running.values());
    running.delete(index);
    finished.add(index);
    after.done(index, result);
  }
}

module.exports = { concurrencyLimit, runInOrder, runSideBySide };
