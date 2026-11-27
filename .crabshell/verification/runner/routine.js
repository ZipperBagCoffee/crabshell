'use strict';
// What a routine --changed run leaves out of, or brings into, the checks the Bazel rule
// chose (select.planRun). Named, --slow and full runs use neither rule.
//  - Heavy checks (select.isSlow) wait for --slow (D143), unless a changed file is under the
//    manifest's `riskPaths` (D151_T006): then the heavy checks whose own inputs changed run.
//  - A check that failed and then passed on the same inputs (flaky) is quarantined: left out
//    and named until its test file changes or its quarantine expires. A check
//    with a standing failure is never left out — the failure reruns it until a pass.
//  - A gate (D152 P11) is never left out: checks narrowed by their reports wait for it.

const { patternList, matchesInput, isSlow } = require('./select');
const { MISSING } = require('./snapshot');
const DEFAULT_QUARANTINE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// A riskPaths pattern: a file, a glob, or a folder (with or without its trailing '/').
function underRiskPath(pattern, file) {
  return matchesInput(pattern, file) || (!/[*?]/.test(pattern) && !pattern.endsWith('/') && file.startsWith(`${pattern}/`));
}

// The first changed file under the manifest's riskPaths, or null. changedFiles is called
// only when riskPaths is declared.
function changedRiskFile(manifest, changedFiles) {
  const patterns = patternList(manifest && manifest.riskPaths);
  if (patterns.length === 0) return null;
  return changedFiles().find(file => patterns.some(pattern => underRiskPath(pattern, file))) || null;
}

// The content identity of a check's test file, or null when it has none or it is gone.
function testIdentity(test, snapshot) {
  if (!test) return null;
  let hash = null;
  try { hash = snapshot.hash(test); } catch (_) {}
  return typeof hash === 'string' && hash !== MISSING ? hash : null;
}

// The quarantine mark a flaky verdict leaves in the record, or null without a test file
// (then there is nothing whose change could end it).
function quarantineMark(test, snapshot) {
  const testHash = testIdentity(test, snapshot);
  return testHash ? { at: new Date().toISOString(), test, testHash } : null;
}

// A mark holds while the check's test file has the content it had when it was marked.
function markHolds(mark, test, snapshot) {
  return Boolean(mark && typeof mark === 'object' && mark.test === test && mark.testHash)
    && testIdentity(test, snapshot) === mark.testHash;
}

function quarantineExpired(record, snapshot, quarantineDays = DEFAULT_QUARANTINE_DAYS) {
  return Boolean(record && markHolds(record.quarantine, record.test, snapshot))
    && Date.now() - Date.parse(record.quarantine.at) > quarantineDays * DAY_MS;
}

function isQuarantined(record, snapshot, quarantineDays = DEFAULT_QUARANTINE_DAYS) {
  return Boolean(record && !record.lastFailedAt) && markHolds(record.quarantine, record.test, snapshot)
    && Number.isFinite(Date.parse(record.quarantine.at)) && !quarantineExpired(record, snapshot, quarantineDays);
}

// The routine choice. selected: the ids planRun chose; records: the last run's records;
// stateOf(id): how a heavy check's inputs stand, for its listing; inputsChanged(id): whether
// its own inputs changed since it last passed. Returns the ids to run and what to name.
function routineChoice({ entries, selected, records, manifest, snapshot, stateOf, inputsChanged }) {
  const days = manifest.quarantineDays === undefined ? DEFAULT_QUARANTINE_DAYS : manifest.quarantineDays;
  const expired = entries.filter(entry => quarantineExpired(records[entry.id], snapshot, days))
    .map(entry => ({ id: entry.id, reason: `flaky quarantine expired after ${days} days` }));
  const quarantined = entries.filter(entry => entry.gate !== true && isQuarantined(records[entry.id], snapshot, days))
    .map(entry => ({ id: entry.id, test: records[entry.id].test }));
  const sidelined = new Set(quarantined.map(item => item.id));
  const heavy = entries.filter(entry => entry.gate !== true && !sidelined.has(entry.id) && isSlow(entry, records[entry.id], manifest));
  const changedHeavy = heavy.filter(entry => inputsChanged(entry.id));
  const riskFile = changedHeavy.length ? changedRiskFile(manifest, () => snapshot.changedFiles()) : null;
  const brought = new Set(riskFile ? changedHeavy.map(entry => entry.id) : []);
  const waiting = heavy.filter(entry => !brought.has(entry.id));
  for (const entry of waiting) sidelined.add(entry.id);
  // A heavy check keeps waiting for --slow, which runs it whatever its quarantine says.
  const returning = expired.filter(item => !sidelined.has(item.id));
  return {
    selected: [...new Set([...selected.filter(id => !sidelined.has(id)), ...returning.map(item => item.id)])],
    // Checks chosen for the changes that this rule leaves out (so an empty run is not
    // reported as "nothing changed").
    leftOut: selected.filter(id => sidelined.has(id)).length,
    slowSkipped: waiting.map(entry => entry.id),
    slowStates: Object.fromEntries(waiting.map(entry => [entry.id, stateOf(entry.id)])),
    slowHistory: waiting.map(entry => ({ id: entry.id, runs: (records[entry.id] || {}).runs || 0, lastFailure: (records[entry.id] || {}).lastFailure || null })),
    riskIncluded: riskFile ? { file: riskFile, ids: [...brought] } : null,
    quarantined,
    quarantineExpired: returning,
  };
}

module.exports = { changedRiskFile, quarantineMark, markHolds, quarantineExpired, isQuarantined, routineChoice };
