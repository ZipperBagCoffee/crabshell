'use strict';
// A runner run's public record (D175_T001): which checks the run chose and which it is
// running now, so another run and the PreToolUse hook can tell overlapping work apart
// without any manifest declaration. One file per runner process beside the manifest:
// .runs/<pid>.json (the folder holds a .gitignore of its own). The run removes its file when
// it ends or exits; a file whose process is gone (killed, interrupted) is stale, and whoever
// reads it removes it. No signal handler is installed: one would delay Ctrl+C in the
// runner's synchronous one-at-a-time path. Every failure means "no record": a run or a hook never stops on this file.

const fs = require('fs');
const path = require('path');

const SCHEMA = 1;
const DIR_NAME = '.runs';
// The runs a process descends from (comma-separated pids). A run adds its own pid for its
// checks; a nested run or a hook inside a check does not wait for these.
const CHAIN_ENV = 'CRABSHELL_RUN_CHAIN';
// The start of the outermost run a process descends from: a nested run takes its order from it,
// so it never waits for a run that started after its ancestor (which waits for that ancestor).
const ORIGIN_ENV = 'CRABSHELL_RUN_ORIGIN';
// "1": run anyway — no waiting for other runs here, no refusal in the hook.
const OVERRIDE_ENV = 'CRABSHELL_OVERLAP';

function recordDir(manifestPath) {
  return path.join(path.dirname(manifestPath), DIR_NAME);
}

// Whether a process with this pid exists (EPERM: it exists, owned by someone else).
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return Boolean(error) && error.code === 'EPERM'; }
}

function ancestorChain(env = process.env) {
  return String((env && env[CHAIN_ENV]) || '').split(',').map(Number).filter(pid => Number.isInteger(pid) && pid > 0);
}

// Blocks this thread for ms milliseconds (the runner's one-at-a-time path is synchronous).
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms)); } catch (_) {}
}

function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value) + '\n');
  fs.renameSync(temporary, file);
}

function readRecord(file) {
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    return record && typeof record === 'object' && record.schema === SCHEMA && Number.isInteger(record.pid) ? record : null;
  } catch (_) { return null; }
}

// The live runs of this manifest, other than this process and the runs it descends from.
// A record whose process is gone is removed; an unreadable one is skipped.
function liveRecords(manifestPath, { exclude = ancestorChain() } = {}) {
  const dir = recordDir(manifestPath);
  let names;
  try { names = fs.readdirSync(dir).filter(name => name.endsWith('.json')); } catch (_) { return []; }
  const skip = new Set([process.pid, ...exclude]);
  const live = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const record = readRecord(file);
    if (!record) continue;
    if (!pidAlive(record.pid)) { try { fs.unlinkSync(file); } catch (_) {} continue; }
    if (!skip.has(record.pid)) live.push(record);
  }
  return live;
}

// Whether run a comes before run b: by the start of its outermost run, then pid.
function startedBefore(a, b) {
  const at = String(a.orderAt || a.startedAt || '');
  const bt = String(b.orderAt || b.startedAt || '');
  return at < bt || (at === bt && a.pid < b.pid);
}

// The live runs that started before `me` and chose check `id` and have not ended. Waits go
// only from a later run to an earlier one, so two runs never wait for each other. With
// runningOnly, only the runs executing the check now (for a run that cannot use their pass:
// it waits only so the two executions do not overlap).
function earlierRunsChoosing(manifestPath, id, me, options = {}) {
  const ignore = options.ignore instanceof Set ? options.ignore : new Set();
  return liveRecords(manifestPath, options).filter(record => !ignore.has(record.pid) && startedBefore(record, me)
    && (options.runningOnly
      ? Array.isArray(record.running) && record.running.some(item => item && item.id === id)
      : Array.isArray(record.selected) && record.selected.includes(id)));
}

// The live runs running check `id` now.
function runsRunning(manifestPath, id, options) {
  return liveRecords(manifestPath, options).filter(record => Array.isArray(record.running)
    && record.running.some(item => item && item.id === id));
}

// Opens this run's record. The handle's start/finish keep `running` current; close removes
// the file and restores the environment. Children started meanwhile inherit CHAIN_ENV.
function open({ manifestPath, root, args = [], selected = [] }) {
  const dir = recordDir(manifestPath);
  const file = path.join(dir, `${process.pid}.json`);
  const ancestors = ancestorChain();
  const previousChain = process.env[CHAIN_ENV];
  const previousOrigin = process.env[ORIGIN_ENV];
  const startedAt = new Date().toISOString();
  const record = {
    schema: SCHEMA,
    pid: process.pid,
    processStartedAt: Math.round(Date.now() - process.uptime() * 1000),
    startedAt,
    orderAt: ancestors.length && previousOrigin ? previousOrigin : startedAt,
    root,
    args: [...args],
    selected: [...selected],
    running: [],
    done: [],
  };
  let openNow = true;
  const save = () => {
    if (!openNow) return;
    try { writeAtomic(file, record); } catch (_) {}
  };
  const remove = () => { try { fs.unlinkSync(file); } catch (_) {} };
  const onExit = () => remove();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const ignore = path.join(dir, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
  } catch (_) {}
  save();
  process.on('exit', onExit);
  process.env[CHAIN_ENV] = [...ancestors, process.pid].join(',');
  process.env[ORIGIN_ENV] = record.orderAt;
  return {
    record,
    ancestors,
    // details: what other runs and the hook need to know about the check (uses, timing, heavy).
    start(id, details = {}) {
      const item = { id, startedAt: new Date().toISOString() };
      if (Array.isArray(details.uses) && details.uses.length) item.uses = [...details.uses];
      if (details.timing === true) item.timing = true;
      if (details.heavy === true) item.heavy = true;
      record.running.push(item);
      save();
    },
    // A chosen check this run will not execute (reused, covered): later runs need not wait for it.
    skip(id) {
      if (!record.selected.includes(id)) return;
      record.selected = record.selected.filter(item => item !== id);
      save();
    },
    finish(id) {
      record.running = record.running.filter(item => item.id !== id);
      if (!record.done.includes(id)) record.done.push(id);
      save();
    },
    close() {
      if (!openNow) return;
      openNow = false;
      remove();
      process.removeListener('exit', onExit);
      if (previousChain === undefined) delete process.env[CHAIN_ENV]; else process.env[CHAIN_ENV] = previousChain;
      if (previousOrigin === undefined) delete process.env[ORIGIN_ENV]; else process.env[ORIGIN_ENV] = previousOrigin;
    },
  };
}

// Waits while pending() returns a non-empty list. Returns { waitedFor, timedOut } (waitedFor:
// the first item of the last list waited for, or null) — directly when sync, else as a
// promise. onWait(item) is called once, when waiting starts; a throwing pending() is empty.
function waitWhile(pending, { timeoutMs, stepMs = 1000, sync, onWait = () => {} }) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let waitedFor = null;
  const step = () => {
    let items = [];
    try { items = pending() || []; } catch (_) {}
    if (items.length === 0) return { done: true, value: { waitedFor, timedOut: false } };
    if (!waitedFor) { try { onWait(items[0]); } catch (_) {} }
    waitedFor = items[0];
    if (Date.now() >= deadline) return { done: true, value: { waitedFor, timedOut: true } };
    return { done: false };
  };
  if (sync) {
    for (;;) {
      const state = step();
      if (state.done) return state.value;
      sleepSync(Math.min(stepMs, Math.max(0, deadline - Date.now())));
    }
  }
  return new Promise(resolve => {
    const tick = () => {
      const state = step();
      if (state.done) resolve(state.value);
      else setTimeout(tick, Math.min(stepMs, Math.max(0, deadline - Date.now())));
    };
    tick();
  });
}

// Continue with fn once a value is ready: now, or when its promise settles.
const then = (value, fn) => (value && typeof value.then === 'function' ? value.then(fn) : fn(value));

// Waits while an earlier live run that chose check `id` has not ended (see waitWhile).
// confirm(records) → the records that still belong to the process that wrote them; it is asked
// once per run found, so a record whose pid another process took over is not waited for.
function waitForEarlierRuns({ manifestPath, id, me, ancestors, ignore, confirm, runningOnly = false, ...options }) {
  const genuine = new Map();
  const pending = () => {
    const runs = earlierRunsChoosing(manifestPath, id, me, { exclude: ancestors, ignore, runningOnly });
    const unseen = runs.filter(record => !genuine.has(record.pid));
    if (unseen.length) {
      let kept = unseen;
      try { if (typeof confirm === 'function') kept = confirm(unseen) || unseen; } catch (_) {}
      for (const record of unseen) genuine.set(record.pid, kept.includes(record));
    }
    return runs.filter(record => genuine.get(record.pid) !== false);
  };
  return waitWhile(pending, options);
}

module.exports = { SCHEMA, DIR_NAME, CHAIN_ENV, ORIGIN_ENV, OVERRIDE_ENV, recordDir, pidAlive, ancestorChain, sleepSync, liveRecords, earlierRunsChoosing, runsRunning, open, then, waitWhile, waitForEarlierRuns };
