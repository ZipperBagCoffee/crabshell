'use strict';
// D151_T006: a check that failed only because a `contract.forbiddenChanges` path changed
// (its exit code and assertions passed) may have met another process writing that file
// while it ran. It runs once more. When that run passes and writes none of those paths,
// the result is that PASS and a notice names the files; otherwise the first FAIL stands.
// "Writes" is judged by each file's size and times, not its content, so a check that writes
// the same bytes on every run is still caught on the second run.

const fs = require('fs');
const path = require('path');
const { resolveInside } = require('./manifest');

// The forbidden paths a failed result changed when that change is its only reason, else [].
function forbiddenOnly(entry, result) {
  if (!result || result.status !== 'FAIL' || result.timedOut) return [];
  const observation = result.observation;
  const changed = observation && Array.isArray(observation.changedForbidden) ? observation.changedForbidden : [];
  if (changed.length === 0) return [];
  const contract = entry && entry.contract ? entry.contract : {};
  if (observation.exitCode !== contract.exitCode) return [];
  if (!Array.isArray(observation.assertions) || observation.assertions.some(item => !item || item.pass !== true)) return [];
  return changed;
}

// A path's write identity: a file's [size, mtime, ctime, inode]; a folder's names and the
// identity of each thing in it (its own times do not move when a file inside is rewritten);
// symbolic links are not followed.
function stampOf(target) {
  let stat;
  try { stat = fs.lstatSync(target); } catch (_) { return 'missing'; }
  if (stat.isDirectory()) {
    let names = [];
    try { names = fs.readdirSync(target).sort(); } catch (_) {}
    return names.map(name => [name, stampOf(path.join(target, name))]);
  }
  return [stat.size, stat.mtimeMs, stat.ctimeMs, Number(stat.ino) || 0];
}

function writeStamp(projectRoot, entry) {
  const paths = entry && entry.contract && Array.isArray(entry.contract.forbiddenChanges) ? entry.contract.forbiddenChanges : [];
  return JSON.stringify(paths.map(rel => {
    try { return [rel, stampOf(resolveInside(projectRoot, rel, 'contract.forbiddenChanges'))]; } catch (_) { return [rel, 'invalid']; }
  }));
}

// Run the check once more (run() returns its result, or a promise of it) and settle the
// failure: { result, cleared } — the second run's PASS and the files the first run saw
// change, or the first failure and null.
function recheckForbidden({ entry, projectRoot, failure, files, run }) {
  const before = writeStamp(projectRoot, entry);
  const settle = result => (result && result.status === 'PASS' && writeStamp(projectRoot, entry) === before
    ? { result, cleared: files }
    : { result: failure, cleared: null });
  const second = run();
  return second && typeof second.then === 'function' ? second.then(settle) : settle(second);
}

function clearedNotice(id, files) {
  return `${id}: ${files.join(', ')} changed while it ran but not when it ran again — another process wrote ${files.length === 1 ? 'it' : 'them'}; counted as PASS.`;
}

module.exports = { forbiddenOnly, writeStamp, recheckForbidden, clearedNotice };
