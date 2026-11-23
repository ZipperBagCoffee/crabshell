'use strict';
// The runner's records beside the manifest: test-map.json (each check's inputs, the
// fingerprints it passed with, its last failure and duration, and the project snapshot)
// and the fail-before exemptions.

const fs = require('fs');
const path = require('path');
const { SCHEMA_VERSION } = require('./fingerprint');
const { pidAlive, sleepSync } = require('./run-record');

const MAP_FILE = 'test-map.json';
// Tests that may pass on HEAD too (a refactor that keeps behavior), each with the
// sha256 of the test content it covers and a reason.
const EXEMPT_FILE = 'fail-before-exempt.json';

function mapPath(manifestPath) {
  return path.join(path.dirname(manifestPath), MAP_FILE);
}

function exemptPath(manifestPath) {
  return path.join(path.dirname(manifestPath), EXEMPT_FILE);
}

function readMap(manifestPath) {
  try {
    const map = JSON.parse(fs.readFileSync(mapPath(manifestPath), 'utf8'));
    return map && typeof map === 'object' && !Array.isArray(map) ? map : null;
  } catch (_) { return null; }
}

// The records a run can trust: only this schema's. An older map reads as no records
// (every check runs once, then follows its inputs).
function currentRecords(map) {
  return map && map.schema === SCHEMA_VERSION && map.entries && typeof map.entries === 'object' ? map.entries : null;
}

// How long a run tries for the map's write lock before writing without merging.
const LOCK_WAIT_MS = 5000;
const LOCK_STEP_MS = 50;
// A lock file younger than this with no readable owner is being written, not abandoned.
const LOCK_FRESH_MS = 2000;
// The lock is held for milliseconds; one older than this is abandoned whoever it names
// (a crashed writer whose pid another process took over).
const LOCK_STALE_MS = 30000;

// The map's short write lock (D175_T001): created exclusively, holding the writer's pid.
// A lock whose owner is gone, or that is older than LOCK_STALE_MS, is taken over. Returns
// whether this process holds it.
function takeLock(file) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      return true;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') return false;
    }
    if (Date.now() >= deadline) return false;
    let abandoned = false;
    try {
      const owner = Number(fs.readFileSync(file, 'utf8').trim());
      const ageMs = Date.now() - fs.statSync(file).mtimeMs;
      abandoned = ageMs > LOCK_STALE_MS || (Number.isInteger(owner) && owner > 0 ? !pidAlive(owner) : ageMs > LOCK_FRESH_MS);
    } catch (_) { continue; } // removed meanwhile: try again
    if (abandoned) { try { fs.unlinkSync(file); } catch (_) {} } else sleepSync(LOCK_STEP_MS);
  }
}

function releaseLock(file) {
  try {
    if (Number(fs.readFileSync(file, 'utf8').trim()) === process.pid) fs.unlinkSync(file);
  } catch (_) {}
}

const runKey = run => `${run && run.at}|${run && run.head}|${run && run.ran}|${run && run.ms}`;
const sameRecord = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

// A map's write identity: new on every write, so a run tells "another run wrote the map since
// I read it" apart from the map's snapshot time (createdAt), which a merge may keep.
function newWriteId() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// D175_T001: another run may have written the map since this run read it (two runs at once).
// A check this run executed keeps this run's record. Any other check keeps the record on disk
// when that differs from the one this run read at its start (another run wrote it), else this
// run's (which may carry refreshed hashes). The run logs are joined; the earlier snapshot is
// kept with its time (it shows more changes, never fewer). An unchanged map is replaced as before.
function mergeWithDisk({ disk, readWriteId, entries, records, previousRecords, executed, ids, snapshot, startedAt, runs, runLimit }) {
  const changed = disk && disk.writeId !== readWriteId;
  if (!changed) return { entries, snapshot, createdAt: startedAt, runs };
  const merged = {};
  for (const id of ids) {
    const theirs = disk.entries[id];
    const chosen = executed.has(id) ? records[id]
      : theirs !== undefined && !sameRecord(theirs, previousRecords[id]) ? theirs : records[id];
    if (chosen) merged[id] = chosen;
  }
  const earlierDisk = typeof disk.createdAt === 'string' && disk.createdAt < startedAt && disk.snapshot;
  let joined = runs;
  if (Array.isArray(runs) || Array.isArray(disk.runs)) {
    const byKey = new Map();
    for (const run of [...(Array.isArray(disk.runs) ? disk.runs : []), ...(Array.isArray(runs) ? runs : [])]) byKey.set(runKey(run), run);
    joined = [...byKey.values()].sort((a, b) => String(a && a.at).localeCompare(String(b && b.at)));
    if (Number.isInteger(runLimit) && runLimit > 0) joined = joined.slice(-runLimit);
  }
  return { entries: merged, snapshot: earlierDisk ? disk.snapshot : snapshot, createdAt: earlierDisk ? disk.createdAt : startedAt, runs: joined };
}

// Replace the map in one rename: the records of the checks that still exist, updated by
// this run, and the snapshot taken before it. With previousRecords (the records this run
// read at its start), readWriteId (that map's writeId) and executed (the checks this run
// ran), a map another run wrote meanwhile is merged under a short lock instead of overwritten.
// Returns the records it wrote, or null when it could not write the map.
function writeMap({ manifestPath, startedAt, snapshot, records, ids, runs = null, previousRecords = null, readWriteId, runLimit, executed = new Set() }) {
  const target = mapPath(manifestPath);
  const lock = `${target}.lock`;
  const locked = previousRecords ? takeLock(lock) : false;
  try {
    let entries = {};
    for (const id of ids) if (records[id]) entries[id] = records[id];
    let createdAt = startedAt;
    let keptSnapshot = snapshot;
    let keptRuns = runs;
    if (locked) {
      const map = readMap(manifestPath);
      const disk = map && currentRecords(map) ? map : null;
      ({ entries, snapshot: keptSnapshot, createdAt, runs: keptRuns } = mergeWithDisk({ disk, readWriteId, entries, records,
        previousRecords, executed, ids, snapshot, startedAt, runs, runLimit }));
    }
    const map = { schema: SCHEMA_VERSION, createdAt, writeId: newWriteId(), snapshot: keptSnapshot, entries };
    // D151_T002: the latest runs (the commit each ran on, checks run, milliseconds).
    if (Array.isArray(keptRuns)) map.runs = keptRuns;
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(map) + '\n');
    fs.renameSync(temporary, target);
    return entries;
  } catch (error) {
    console.error(`[VERIFY] WARN: load map not written: ${error.message}`);
    return null;
  } finally {
    if (locked) releaseLock(lock);
  }
}

module.exports = { MAP_FILE, EXEMPT_FILE, mapPath, exemptPath, readMap, currentRecords, writeMap };
