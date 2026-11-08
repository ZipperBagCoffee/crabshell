'use strict';
// Which checks a run needs (D143, the Bazel rule): a check runs when its inputs changed
// since it last passed, it failed last time, it is new, or it says reuse:false.
// Otherwise its pass is reused. Git plays no part in choosing.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { toPosix, globRegex, resolveInside } = require('./manifest');
const { entryFingerprint, programIdentity, runsOnRunnerNode } = require('./fingerprint');
const { insideRoot, contractPaths } = require('./trace');
const { mapPath, exemptPath } = require('./store');

// A recorded path covers a changed file when it is the file or a folder that contains it.
function covers(recorded, file) {
  return recorded === file || (recorded.endsWith('/') && file.startsWith(recorded));
}

// Repo-relative files, folders ending in '/', or globs.
function patternList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.length > 0).map(toPosix) : [];
}

// The files a check declares it reads (`inputs`): any language, any tool.
function inputPatterns(entry) {
  return patternList(entry && entry.inputs);
}

const globCache = new Map();
function matchesInput(pattern, file) {
  if (pattern.endsWith('/')) return file.startsWith(pattern);
  if (/[*?]/.test(pattern)) {
    if (!globCache.has(pattern)) globCache.set(pattern, globRegex(pattern));
    return globCache.get(pattern).test(file);
  }
  return pattern === file;
}

function inputsCover(entry, file) {
  return inputPatterns(entry).some(pattern => matchesInput(pattern, file));
}

// What a run never treats as a project file: the runner's own records and modules,
// what Crabshell writes for itself — everything in its storage folder outside the
// verification folder (documents, knowledge, memory; v2 §1), or, for a launcher outside
// a storage folder, the memory folder beside it — and the manifest's `exclude` patterns.
// A traced check that reads such a file still has it as an input (the snapshot hashes
// paths it does not list). (Folders named .git are skipped by the snapshot itself.)
// Crabshell's own state in this project: its storage folder outside the verification
// folder (the runner folder and the folders above it stay). A same-named folder deeper in
// the project is not this project's storage.
function crabshellState({ projectRoot, layout }) {
  const storage = layout.storageDir && insideRoot(projectRoot, layout.storageDir);
  const launcher = insideRoot(projectRoot, layout.launcherDir);
  return rel => Boolean(storage && launcher) && rel.startsWith(`${storage}/`)
    && !rel.startsWith(`${launcher}/`) && !(rel.endsWith('/') && `${launcher}/`.startsWith(rel));
}

function exclusion({ projectRoot, layout, manifestPath, manifest }) {
  const own = [layout.storageDir ? null : path.join(path.dirname(path.dirname(manifestPath)), 'memory'), layout.moduleDir]
    .filter(Boolean).map(folder => insideRoot(projectRoot, folder)).filter(Boolean).map(folder => `${folder}/`);
  const crabshellOwn = crabshellState({ projectRoot, layout });
  const ownFilePrefixes = [mapPath(manifestPath), layout.resultsPath, path.join(layout.launcherDir, require('./ignored').RECORD_FILE)]
    .map(file => insideRoot(projectRoot, file)).filter(Boolean);
  // `exclude` (the project's) and every entry's `outputs` (files checks write — products,
  // not inputs; a check that reads one still hashes it as an input).
  const entries = manifest && Array.isArray(manifest.entries) ? manifest.entries : [];
  const declared = [...patternList(manifest && manifest.exclude), ...entries.flatMap(entry => patternList(entry && entry.outputs))];
  return rel => crabshellOwn(rel) || own.some(folder => rel === folder || rel.startsWith(folder))
    || ownFilePrefixes.some(prefix => rel === prefix || rel.startsWith(`${prefix}.`))
    || declared.some(pattern => matchesInput(pattern, rel) || (rel.endsWith('/') && matchesInput(pattern, rel.slice(0, -1))));
}

// The snapshot files a list of patterns names; a plain path that is not in the
// snapshot (an excluded or missing file) is kept, so its absence still counts.
function filesMatching(patterns, snapshot) {
  if (patterns.length === 0) return [];
  const all = snapshot.list();
  const found = new Set();
  for (const pattern of patterns) {
    if (pattern.endsWith('/') || /[*?]/.test(pattern)) {
      for (const file of all) if (matchesInput(pattern, file)) found.add(file);
    } else found.add(pattern);
  }
  return [...found];
}

// Command arguments that name an existing project file: extra inputs for a declared
// check (a hint, never the whole story).
function argumentFiles(entry, projectRoot) {
  const args = entry && entry.command && Array.isArray(entry.command.args) ? entry.command.args : [];
  const files = [];
  for (const arg of args) {
    if (typeof arg !== 'string' || !arg || arg.startsWith('-')) continue;
    try {
      const absolute = resolveInside(projectRoot, arg, 'command.args');
      if (fs.statSync(absolute).isFile()) files.push(toPosix(path.relative(projectRoot, absolute)));
    } catch (_) {}
  }
  return files;
}

// The declaration a distrust is tied to: when `inputs` change, the distrust ends.
function declarationKey(entry) {
  return JSON.stringify(inputPatterns(entry));
}

// The median pass time of a check, in milliseconds (older records: the last time).
function medianDuration(record) {
  const durations = record && Array.isArray(record.durations) ? record.durations.filter(Number.isFinite) : [];
  if (durations.length === 0) return record && Number.isFinite(record.lastDurationMs) ? record.lastDurationMs : undefined;
  const sorted = [...durations].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Heavy checks stay out of routine --changed runs (D143 §3): `slow: false` keeps a check
// light, `slow: true` makes it heavy; otherwise a median pass time over
// `slowAfterSeconds` (default 300 — above Bazel's "medium" test size limit, the sizes
// Bazel does not run on every change), or with no pass yet a declared timeout over it.
const DEFAULT_SLOW_AFTER_SECONDS = 300;
function isSlow(entry, record, manifest) {
  if (entry.slow === false) return false;
  if (entry.slow === true) return true;
  const limitMs = 1000 * (typeof (manifest && manifest.slowAfterSeconds) === 'number' ? manifest.slowAfterSeconds : DEFAULT_SLOW_AFTER_SECONDS);
  const median = medianDuration(record);
  if (Number.isFinite(median)) return median > limitMs;
  return Number.isFinite(entry.timeout) && entry.timeout > limitMs;
}

// A check's inputs and how they are known:
//   traced   — a Node check the runner traced reading at least one file;
//   declared — a check with `inputs` (any language);
//   project  — neither: every project file is an input until it declares `inputs`.
// `changed.global` patterns (an older manifest field) add their files to every check.
function inputSet(entry, record, ctx) {
  const program = programIdentity(entry.command, ctx.projectRoot);
  const declared = filesMatching(inputPatterns(entry), ctx.snapshot);
  if (!ctx.globalFiles) ctx.globalFiles = filesMatching(ctx.globals, ctx.snapshot);
  const extra = [...contractPaths(entry), ...(program.file ? [program.file] : []), ...ctx.globalFiles];
  const isNode = runsOnRunnerNode(entry.command);
  if (isNode && record && record.kind === 'traced' && Array.isArray(record.files) && record.files.length > 0) {
    // A record made before D151_T007 does not say whether a traced folder was listed or
    // copied, so its folders stand for their names and every file under them; a newer
    // record (folders: 'names') already lists the files of the folders it copied.
    const folders = record.folders === 'names' ? [] : record.files.filter(file => file.endsWith('/'));
    const inside = folders.length ? ctx.snapshot.list().filter(file => folders.some(folder => file.startsWith(folder))) : [];
    return { kind: 'traced', program: program.id, files: [...new Set([...record.files, ...inside, ...declared, ...extra, ...(record.test ? [record.test] : [])])] };
  }
  // A declaration that failed a check on inputs it passed with is not trusted until it
  // changes (D143 §2): the whole project is the input meanwhile.
  const distrusted = record && record.inputsDistrusted && record.inputsDistrusted === declarationKey(entry);
  if (inputPatterns(entry).length > 0 && !distrusted) {
    return { kind: 'declared', program: program.id, files: [...new Set([...declared, ...argumentFiles(entry, ctx.projectRoot), ...extra])] };
  }
  // The whole project stands in as one identity (snapshot.projectIdentity), plus the
  // files named outright, so nothing is listed or read per check.
  return { kind: 'project', program: program.id, files: [...new Set(extra)] };
}

function fingerprintOf(entry, set, ctx) {
  return entryFingerprint({ entry, files: set.files, identityOf: ctx.snapshot.hash, program: set.program, decision: ctx.decision,
    project: set.kind === 'project' ? ctx.snapshot.projectIdentity() : null });
}

// Why a check whose fingerprint is new runs: the first input that differs from its
// last pass, or the project file that changed for a check with unknown inputs.
const DECISION_CHANGED = 'runner decision code changed';

// The kind of reason a check was chosen for (the runner's summary, the routine choice and the
// hooks' view of what --changed would run all group reasons the same way).
function reasonGroup(reason) {
  if (reason === DECISION_CHANGED) return 'after a runner change';
  return / changed( \(unknown inputs\))?$| is no longer an input$|^entry, program or runner changed$/.test(reason) ? 'with changed inputs'
    : reason === 'new check' ? 'new' : reason === 'failed in the last run' ? 'failed last time'
      : reason === 'record from an older runner' ? 'recorded by an older runner' : reason;
}

function changeReason(set, record, ctx) {
  if (set.kind !== 'project' && record && record.inputHashes && typeof record.inputHashes === 'object') {
    for (const file of [...set.files].sort()) {
      if (record.inputHashes[file] !== ctx.snapshot.hash(file)) return `${file} changed`;
    }
    const gone = Object.keys(record.inputHashes).find(file => !set.files.includes(file));
    if (gone) return `${gone} is no longer an input`;
  }
  // The runner's own decision code (D143_T020): named so a release that changes it says why
  // every check runs once.
  if (record && record.decision && record.decision !== ctx.decision) return DECISION_CHANGED;
  if (set.kind === 'project') {
    if (!ctx.projectChanged) ctx.projectChanged = ctx.snapshot.projectChanges();
    if (ctx.projectChanged.length) return `project file ${ctx.projectChanged[0]} changed (unknown inputs)`;
    return 'no pass recorded since the last project change (unknown inputs)';
  }
  return 'entry, program or runner changed';
}

// For each runnable entry: run (with the reason) or reuse its pass.
function planRun({ entries, records, olderRecords, ctx, reuse }) {
  const plan = { selected: [], reasons: {}, reused: [], sets: new Map(), fingerprints: new Map(), unknownInputs: [] };
  for (const entry of entries) {
    if (entry.type === 'manual') continue;
    const record = records[entry.id];
    let set = null;
    if (!entry.discoveryError && entry.command) {
      try { set = inputSet(entry, record, ctx); } catch (_) { set = null; }
    }
    plan.sets.set(entry.id, set);
    // A Node check that never ran is traced on its first run; it is not "unknown" yet.
    const untracedNode = runsOnRunnerNode(entry.command) && !record;
    if (set && set.kind === 'project' && !untracedNode) plan.unknownInputs.push(entry.id);
    let reason = null;
    if (entry.discoveryError) reason = 'discovery found no file';
    else if (entry.reuse === false) reason = 'reuse:false';
    else if (entry.always === true) reason = 'always';
    else if (!reuse) reason = 'all checks requested (--no-reuse)';
    else if (!record) reason = olderRecords ? 'record from an older runner' : 'new check';
    else if (record.lastFailedAt) reason = 'failed in the last run';
    // The fingerprint is worked out only when a decision needs it: to compare with the
    // passes, or to tell a repeated failure from a new one.
    let fingerprint = null;
    if (set && record && (!reason || (record.lastFailedAt && record.failKey))) {
      try { fingerprint = fingerprintOf(entry, set, ctx); } catch (_) { fingerprint = null; } // An unreadable input cannot vouch for reuse.
    }
    plan.fingerprints.set(entry.id, fingerprint);
    if (!reason) {
      if (!fingerprint) reason = 'an input could not be read';
      else if (!Array.isArray(record.passHistory) || !record.passHistory.includes(fingerprint)) reason = changeReason(set, record, ctx);
    }
    if (reason) { plan.selected.push(entry.id); plan.reasons[entry.id] = reason; }
    else plan.reused.push(entry.id);
  }
  // A changed file that no check reads or declares (D143 §1): the checks whose inputs
  // are not completely traced — declared ones; unknown-input checks see it already —
  // run once. This run's snapshot records the file, so the next run does not.
  const owned = new Set();
  for (const set of plan.sets.values()) if (set && set.kind !== 'project') for (const file of set.files) owned.add(file);
  const ownerless = ctx.snapshot.changedFiles().filter(file => !owned.has(file));
  if (ownerless.length) {
    for (const entry of entries) {
      const set = plan.sets.get(entry.id);
      if (!set || set.kind !== 'declared' || entry.slow === true || !plan.reused.includes(entry.id)) continue;
      plan.reused.splice(plan.reused.indexOf(entry.id), 1);
      plan.selected.push(entry.id);
      plan.reasons[entry.id] = `${ownerless[0]} changed and no check reads or declares it`;
    }
    plan.selected.sort((a, b) => entries.findIndex(entry => entry.id === a) - entries.findIndex(entry => entry.id === b));
  }
  return plan;
}

// --- used by fail-before (opt-in), which compares changed tests with HEAD ---

// Generated results, the load map and exemptions are not changes to check.
function withoutRunnerFiles(files, projectRoot, manifestPath, layout) {
  const own = new Set([mapPath(manifestPath), exemptPath(manifestPath), layout.resultsPath].map(file => insideRoot(projectRoot, file)).filter(Boolean));
  return files.map(toPosix).filter(file => !own.has(file));
}

// Files changed in the working tree against HEAD, plus untracked files.
function gitChangedFiles(projectRoot) {
  const run = args => spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  const diff = run(['diff', '--name-only', '--no-renames', '--relative', 'HEAD']);
  if (diff.status !== 0) return { error: `git diff failed: ${(diff.stderr || diff.error && diff.error.message || '').trim()}` };
  const untracked = run(['ls-files', '--others', '--exclude-standard']);
  const files = new Set([...diff.stdout.split('\n'), ...(untracked.status === 0 ? untracked.stdout.split('\n') : [])].map(line => toPosix(line.trim())).filter(Boolean));
  return { files: [...files] };
}

// The commit the working tree is on, or null without git (D151_T002: runs are counted per
// commit; git still plays no part in choosing checks).
function currentHead(projectRoot) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  const head = result.status === 0 ? String(result.stdout || '').trim() : '';
  return head || null;
}

// Files git can report as changed (tracked, or untracked and not ignored), or null
// when git is unavailable.
function gitVisibleFiles(projectRoot) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 256 << 20 });
  if (result.status !== 0) return null;
  return new Set(result.stdout.split('\n').map(line => toPosix(line.trim())).filter(Boolean));
}

module.exports = {
  covers, patternList, inputPatterns, matchesInput, inputsCover, crabshellState, exclusion, filesMatching, argumentFiles,
  declarationKey, medianDuration, isSlow, DEFAULT_SLOW_AFTER_SECONDS,
  inputSet, fingerprintOf, changeReason, DECISION_CHANGED, reasonGroup, planRun, withoutRunnerFiles, gitChangedFiles, gitVisibleFiles, currentHead,
};
