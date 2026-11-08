'use strict';
// The project as the runner sees it, for hooks (D143_T013): the same snapshot and the same
// exclusion rule, so "did the project change" and "is this a project file" have one
// definition. It only reads; the runner alone writes its records.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { runnerLayout } = require('./layout');
const { exclusion, patternList, planRun, reasonGroup } = require('./select');
const { routineChoice } = require('./routine');
const { expandEntries } = require('./manifest');
const { takeSnapshot } = require('./snapshot');
const { ignoredFolders } = require('./ignored');
const { mapPath, readMap, currentRecords } = require('./store');
const { insideRoot } = require('./trace');

// The runner's view for a run or a question about one check, built the same way for the
// runner (main.js) and the hooks: the last records (only this schema's count), the
// project's snapshot (hashes reused from the last run) and the selection context.
// runCommands: the runner may run the manifest's itemIdentity command; a hook may not (it
// then knows an item's identity only while its file is unchanged since a record).
function selectionView({ projectRoot, layout, manifestPath, manifest, runCommands = false }) {
  const previousMap = readMap(manifestPath);
  const trusted = currentRecords(previousMap);
  const snapshot = takeSnapshot({
    projectRoot,
    previous: trusted ? previousMap.snapshot : null,
    isExcluded: exclusion({ projectRoot, layout, manifestPath, manifest }),
    ignored: ignoredFolders({ projectRoot, layout }),
  });
  const ctx = { projectRoot, snapshot, decision: layout.decisionHash(), globals: patternList(manifest.changed && manifest.changed.global),
    runCommands, itemIdentity: manifest.itemIdentity || null };
  return { previousMap, trusted, records: trusted || {}, olderRecords: Boolean(previousMap) && !trusted, snapshot, ctx };
}

// The runner's record of a manifest entry when the runner would not run it now: it passed
// with the same inputs (D143 Bazel rule) — or null when it failed last time, has no record
// of this schema, says reuse:false, or its inputs changed. A hook answers a rerun with it.
// A caller that already holds this project's selection view passes it (one walk per hook).
function entryUpToDate(projectRoot, launcherDir, entryId, view = null) {
  const state = projectState(projectRoot, launcherDir);
  let entries;
  try { entries = expandEntries(state.manifest, state.root); } catch (_) { return null; }
  const entry = entries.find(item => item.id === entryId);
  if (!entry || entry.type === 'manual' || entry.reuse === false) return null;
  if (!view) view = selectionView({ projectRoot: state.root, layout: state.layout, manifestPath: state.layout.manifestPath, manifest: state.manifest });
  const record = view.records[entryId];
  if (!view.trusted || !record || !Array.isArray(record.passHistory) || record.passHistory.length === 0) return null;
  // A check narrowed by its report is up to date only while every gate passed on the current files.
  const plan = planRun({ entries: [entry], records: view.records, olderRecords: false, ctx: view.ctx, reuse: true, gates: entries });
  return plan.selected.length === 0 && !plan.awaitingGate.includes(entryId) ? { entry, record, recordPath: mapPath(state.layout.manifestPath) } : null;
}

// D151_T002: the checks a routine --changed run would run now (heavy checks left out, as
// that run leaves them), or null when the manifest cannot be read. A hook asks before a
// commit whether the files to commit were checked.
function pendingChecks(projectRoot, launcherDir, view = null) {
  const state = projectState(projectRoot, launcherDir);
  let entries;
  try { entries = expandEntries(state.manifest, state.root).filter(entry => entry.type !== 'manual'); } catch (_) { return null; }
  if (!entries.length) return [];
  if (!view) view = selectionView({ projectRoot: state.root, layout: state.layout, manifestPath: state.layout.manifestPath, manifest: state.manifest });
  const plan = planRun({ entries, records: view.records, olderRecords: view.olderRecords, ctx: view.ctx, reuse: true });
  // The same routine choice as --changed (routine.js): heavy checks wait unless a risk path
  // changed, quarantined flaky checks stay out.
  const inputsChanged = id => Boolean(plan.reasons[id]) && reasonGroup(plan.reasons[id]) === 'with changed inputs';
  return routineChoice({ entries, selected: plan.selected, records: view.records, manifest: state.manifest,
    snapshot: view.snapshot, stateOf: () => null, inputsChanged }).selected;
}

// A missing or unreadable manifest leaves only the runner's own exclusions.
function readManifest(manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
    return manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : {};
  } catch (_) { return {}; }
}

// launcherDir: the folder of the project's runner launcher and manifest.
function projectState(projectRoot, launcherDir) {
  const root = path.resolve(projectRoot);
  const layout = runnerLayout(launcherDir);
  const manifest = readManifest(layout.manifestPath);
  const isExcluded = exclusion({ projectRoot: root, layout, manifestPath: layout.manifestPath, manifest });
  let snapshot = null;
  let records;
  return {
    root,
    layout,
    manifest,
    isExcluded,
    // One walk of the project's files (sizes and times), taken when first asked for.
    snapshot: () => snapshot || (snapshot = takeSnapshot({ projectRoot: root, isExcluded, ignored: ignoredFolders({ projectRoot: root, layout }) })),
    // The runner's records of this schema, or null (none yet, or an older runner's).
    records: () => (records === undefined ? (records = currentRecords(readMap(layout.manifestPath))) : records),
  };
}

// The identity of the project's files (paths, sizes, modification times), with the
// runner's exclusions: what a check with unknown inputs depends on.
function projectIdentity(projectRoot, launcherDir) {
  return projectState(projectRoot, launcherDir).snapshot().projectIdentity();
}

// The identity of the project's files by content, for evidence that must survive a file
// rewritten with the same bytes. Like git's index, a file whose size and times match the
// cache (and that was last written before the cache was taken) keeps its cached hash;
// only the rest is read. The cache is the caller's file (hooks keep theirs in Crabshell's
// memory folder, outside every snapshot); losing it costs one full read, never a result.
function contentIdentity(projectRoot, launcherDir, cacheFile) {
  const state = projectState(projectRoot, launcherDir);
  let previous = null;
  try { previous = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (_) {}
  const snapshot = takeSnapshot({ projectRoot: state.root, previous, isExcluded: state.isExcluded, ignored: ignoredFolders({ projectRoot: state.root, layout: state.layout }) });
  const digest = crypto.createHash('sha256');
  for (const rel of snapshot.list().sort()) digest.update(`${rel}\0${snapshot.hash(rel)}\n`);
  const identity = digest.digest('hex');
  try {
    const temp = `${cacheFile}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(snapshot.serialize()));
    fs.renameSync(temp, cacheFile);
  } catch (_) {}
  return identity;
}

// A file the runner treats as part of the project: inside it, not in .git, not excluded.
function isProjectInput(projectRoot, launcherDir, file, state = null) {
  const current = state || projectState(projectRoot, launcherDir);
  const rel = insideRoot(current.root, path.resolve(current.root, String(file)));
  return Boolean(rel) && !current.isExcluded(rel);
}

module.exports = { contentIdentity, entryUpToDate, isProjectInput, pendingChecks, projectIdentity, projectState, selectionView };
