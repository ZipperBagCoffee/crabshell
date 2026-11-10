'use strict';
// Which checks a run needs (D143, the Bazel rule): a check runs when its inputs changed
// since it last passed, it failed last time, it is new, or it says reuse:false.
// Otherwise its pass is reused. Git plays no part in choosing.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { toPosix, globRegex, resolveInside, validateEntry } = require('./manifest');
const { entryFingerprint, programIdentity, runsOnRunnerNode } = require('./fingerprint');
const { insideRoot, contractPaths } = require('./trace');
const { mapPath, exemptPath } = require('./store');
const { isItemKey, pathOf, itemOf, itemKey, restKey, describeKey, hasCases, runItemIdentity, NO_ITEM } = require('./used-report');

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

// A path a pattern names: a file it matches, or a folder ("x/") the pattern names without
// its slash. Used for `exclude` and `outputs`.
function underPattern(pattern, rel) {
  return matchesInput(pattern, rel) || (rel.endsWith('/') && matchesInput(pattern, rel.slice(0, -1)));
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
    || declared.some(pattern => underPattern(pattern, rel));
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

// The kind of a check's inputs, decided in one place (D152 P5) for its record; the notices,
// --replay and the copy check read it back through inputsUnknown:
//   reported — the check reported what it used (used-report.js) inside its `reportScope`;
//              `base` keeps the kind it has without the report;
//   traced   — a Node check whose trace saw every program it started and at least one file;
//   declared — a check with `inputs` (any language); a Node check whose trace was incomplete
//              keeps what the trace saw beside its declared inputs;
//   project  — neither: every project file is an input until it declares `inputs`.
function recordKind({ entry, traced = false, files = [], incomplete = [], reported = false }) {
  if (reported) return 'reported';
  if (traced && files.length > 0 && incomplete.length === 0) return 'traced';
  if (inputPatterns(entry).length > 0) return 'declared';
  return 'project';
}

// Whether a record leaves every project file an input of its check.
function inputsUnknown(record) {
  return Boolean(record) && record.kind === 'project';
}

// Where a check's report decides what it used (D152 P3): `reportScope`, else its `inputs`.
// Files it reads outside stay its inputs.
function reportScope(entry) {
  return entry && Array.isArray(entry.reportScope) ? patternList(entry.reportScope) : inputPatterns(entry);
}
const scopeKey = entry => JSON.stringify(reportScope(entry));
// A file, a "folder/" or an item's file inside a scope.
function inScope(scope, key) {
  const rel = pathOf(key);
  return scope.some(pattern => matchesInput(pattern, rel) || (rel.endsWith('/') && matchesInput(pattern, rel.slice(0, -1))));
}

const own = (object, key) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);

// The project's `itemIdentity` answers for these files, asked once per run, and only when the
// caller may run project commands (the runner may; a hook may not, and then knows only the
// identities records hold).
function itemFacts(ctx, files) {
  if (!ctx.items) ctx.items = new Map();
  const ask = [...new Set(files)].filter(file => !ctx.items.has(file));
  if (ask.length) {
    const answers = ctx.runCommands && ctx.itemIdentity ? runItemIdentity(ctx.itemIdentity, ctx.projectRoot, ask) : new Map();
    for (const file of ask) ctx.items.set(file, answers.get(file) || null);
  }
  return new Map(files.map(file => [file, ctx.items.get(file)]));
}

// The item identities a record holds for the files whose content is what it was then.
function knownItems(record, ctx) {
  const known = {};
  const hashes = record && record.inputHashes;
  if (!hashes || typeof hashes !== 'object' || !Array.isArray(record.files)) return known;
  for (const key of record.files) {
    if (!isItemKey(key) || !own(hashes, key)) continue;
    let same = false;
    try { same = hashes[pathOf(key)] === ctx.snapshot.hash(pathOf(key)); } catch (_) {}
    if (same) known[key] = hashes[key];
  }
  return known;
}

// A reused record's input identities with its item files' current hashes (D152), or null when
// none changed: its fingerprint matched, so its items keep their identities; their files
// changed elsewhere. A hook, which cannot ask itemIdentity, then reads them as the runner does.
function refreshedItemHashes(record, ctx) {
  if (!record || record.kind !== 'reported' || !record.inputHashes || !Array.isArray(record.files)) return null;
  const hashes = { ...record.inputHashes };
  let changed = false;
  for (const key of record.files) {
    if (!isItemKey(key)) continue;
    let now;
    try { now = ctx.snapshot.hash(pathOf(key)); } catch (_) { continue; }
    if (record.inputHashes[pathOf(key)] === now && own(record.inputHashes, key)) continue;
    hashes[pathOf(key)] = now;
    hashes[key] = keyIdentity(ctx, key);
    changed = true;
  }
  return changed ? hashes : null;
}

// The content identity of one input key (D152 P2): a file's hash or a folder's names from the
// snapshot; an item's fingerprint (or its file's rest) as its record holds it while the file
// is unchanged (`known`), else from the project's `itemIdentity` command. An item key never
// goes to the snapshot, which would read it as a missing file — one constant that matches
// forever; a key nothing answers gets a value of its own, so it never matches a pass.
function keyIdentity(ctx, key, known = null) {
  if (own(known, key)) return known[key];
  if (!isItemKey(key)) return ctx.snapshot.hash(key);
  const file = pathOf(key);
  const item = itemOf(key);
  const facts = itemFacts(ctx, [file]).get(file);
  if (facts && item !== '') return facts.items.has(item) ? facts.items.get(item) : NO_ITEM;
  if (facts && facts.rest !== null) return facts.rest;
  if (!ctx.unknown) ctx.unknown = new Map();
  if (!ctx.unknown.has(key)) ctx.unknown.set(key, `unknown ${process.pid} ${Date.now()} ${ctx.unknown.size}`);
  return ctx.unknown.get(key);
}

// The identity of the project files outside a scope (paths, sizes and modification times, as
// snapshot.projectIdentity), for a check whose inputs are unknown outside its report's scope.
function projectOutside(ctx, scope) {
  const key = JSON.stringify(scope);
  if (!ctx.outside) ctx.outside = new Map();
  if (!ctx.outside.has(key)) {
    const digest = crypto.createHash('sha256');
    for (const rel of ctx.snapshot.list().filter(file => !inScope(scope, file)).sort()) {
      const stat = ctx.snapshot.stat(rel);
      digest.update(`${rel}\0${stat[0]}\0${stat[1]}\n`);
    }
    ctx.outside.set(key, digest.digest('hex'));
  }
  return ctx.outside.get(key);
}

// A check's inputs and how they are known (recordKind). A reported check's inputs are its
// report's keys, the files it read or declared outside its report's scope, and — when its
// inputs are otherwise unknown — the project outside that scope (`wholeProject`).
// `changed.global` patterns (an older manifest field) add their files to every check.
function inputSet(entry, record, ctx) {
  const program = programIdentity(entry.command, ctx.projectRoot);
  const declared = filesMatching(inputPatterns(entry), ctx.snapshot);
  if (!ctx.globalFiles) ctx.globalFiles = filesMatching(ctx.globals, ctx.snapshot);
  const extra = [...contractPaths(entry), ...(program.file ? [program.file] : []), ...ctx.globalFiles];
  const isNode = runsOnRunnerNode(entry.command);
  if (record && record.kind === 'reported' && Array.isArray(record.files)) {
    // A report decides only inside the scope it was made for: after the scope changes, the
    // whole project stands in until the check runs and reports again.
    if (record.scope !== scopeKey(entry)) return { kind: 'project', program: program.id, files: [...new Set(extra)] };
    const scope = reportScope(entry);
    const outside = declared.filter(file => !inScope(scope, file));
    const args = record.base === 'declared' ? argumentFiles(entry, ctx.projectRoot) : [];
    return { kind: 'reported', program: program.id, scope, wholeProject: record.base === 'project', known: knownItems(record, ctx),
      files: [...new Set([...record.files, ...outside, ...args, ...extra, ...(record.test ? [record.test] : [])])] };
  }
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
    // What an incomplete trace saw stays an input beside the declaration (D152 P5).
    const seen = record && record.kind === 'declared' && Array.isArray(record.files) ? record.files : [];
    return { kind: 'declared', program: program.id, files: [...new Set([...seen, ...declared, ...argumentFiles(entry, ctx.projectRoot), ...extra])] };
  }
  // The whole project stands in as one identity (snapshot.projectIdentity), plus the
  // files named outright, so nothing is listed or read per check.
  return { kind: 'project', program: program.id, files: [...new Set(extra)] };
}

function fingerprintOf(entry, set, ctx) {
  return entryFingerprint({ entry, files: set.files, identityOf: key => keyIdentity(ctx, key, set.known), program: set.program, decision: ctx.decision,
    project: set.kind === 'project' ? ctx.snapshot.projectIdentity() : set.wholeProject ? projectOutside(ctx, set.scope) : null });
}

// Why a check whose fingerprint is new runs: the first input that differs from its
// last pass, or the project file that changed for a check with unknown inputs.
const DECISION_CHANGED = 'runner decision code changed';
const OUTSIDE_SCOPE = 'outside its report scope';

// The kind of reason a check was chosen for (the runner's summary, the routine choice and the
// hooks' view of what --changed would run all group reasons the same way).
function reasonGroup(reason) {
  if (reason === DECISION_CHANGED) return 'after a runner change';
  return / changed( \((unknown inputs|outside its report scope)\))?$| is no longer an input$|^entry, program or runner changed$/.test(reason) ? 'with changed inputs'
    : reason === 'new check' ? 'new' : reason === 'failed in the last run' ? 'failed last time'
      : reason === 'record from an older runner' ? 'recorded by an older runner' : reason;
}

// The inputs whose identity differs from the one the record holds, in path order.
function changedKeys(set, record, ctx) {
  const hashes = record && record.inputHashes;
  if (!hashes || typeof hashes !== 'object') return [];
  return [...set.files].sort().filter(key => hashes[key] !== keyIdentity(ctx, key, set.known));
}

// Every input difference from the record, as reason text: each changed input, then each
// recorded input that is no longer one (D164: --explain names them all, not the first).
function inputDifferences(set, record, ctx) {
  if (set.kind === 'project' || !record || !record.inputHashes || typeof record.inputHashes !== 'object') return [];
  const differences = changedKeys(set, record, ctx).map(key => `${describeKey(key)} changed`);
  // An item's file is recorded with its items (its hash tells a hook the items still hold).
  const listed = new Set([...set.files, ...set.files.filter(isItemKey).map(pathOf)]);
  for (const key of Object.keys(record.inputHashes)) if (!listed.has(key)) differences.push(`${describeKey(key)} is no longer an input`);
  return differences;
}

function changeReason(set, record, ctx) {
  const differences = inputDifferences(set, record, ctx);
  if (differences.length) return differences[0];
  // The runner's own decision code (D143_T020): named so a release that changes it says why
  // every check runs once.
  if (record && record.decision && record.decision !== ctx.decision) return DECISION_CHANGED;
  if (set.kind === 'project' || set.wholeProject) {
    if (!ctx.projectChanged) ctx.projectChanged = ctx.snapshot.projectChanges();
    if (set.wholeProject) {
      const changed = ctx.projectChanged.find(file => !inScope(set.scope, file));
      if (changed) return `project file ${changed} changed (${OUTSIDE_SCOPE})`;
    } else {
      if (ctx.projectChanged.length) return `project file ${ctx.projectChanged[0]} changed (unknown inputs)`;
      return 'no pass recorded since the last project change (unknown inputs)';
    }
  }
  return 'entry, program or runner changed';
}

// The cases of a `{cases}` entry to run again (D152 P4), or null for every case: the cases
// that did not pass in the last run and those that used an input whose identity changed.
// Every case runs when anything else changed — an input no case used, the entry, its
// program or the runner: the record's identities then no longer give the fingerprint it
// last ran with.
function casesToRun(entry, record, set, ctx) {
  if (!hasCases(entry) || !record || record.kind !== 'reported' || !record.cases || !record.inputHashes) return null;
  const names = Object.keys(record.cases).sort();
  const hashes = record.inputHashes;
  if (names.length < 2 || !set.files.every(key => own(hashes, key))) return null;
  const then = fingerprintOf(entry, { ...set, known: hashes }, ctx);
  if (record.lastFailedAt ? record.failKey !== then : !(Array.isArray(record.passHistory) && record.passHistory.includes(then))) return null;
  const changed = new Set(changedKeys(set, record, ctx));
  const used = new Set(names.flatMap(name => record.cases[name].files || []));
  if ([...changed].some(key => !used.has(key))) return null;
  const run = names.filter(name => record.cases[name].result !== 'pass' || (record.cases[name].files || []).some(key => changed.has(key)));
  return run.length > 0 && run.length < names.length ? run : null;
}

// What a valid report (used-report.readReport) says a check used, as input keys with the
// identities it used (D152 P1, P2): an item of a file whose rest the itemIdentity command
// gives stays an item and brings the file's rest with it; without that command, when it
// fails or gives no rest, the item stands for its whole file. Returns the keys the whole
// check used (`shared`), each case's own keys, their identities (`known`) and each case's
// result. A `rest` line (item '') brings only the file's rest (D163).
function reportedInputs(report, ctx) {
  const facts = itemFacts(ctx, [...new Set(report.uses.filter(use => use.item !== null).map(use => use.path))]);
  const known = {};
  const shared = new Set();
  const cases = new Map();
  const add = (name, key, identity) => {
    if (name !== null && !cases.has(name)) cases.set(name, new Set());
    (name === null ? shared : cases.get(name)).add(key);
    if (identity !== undefined && !own(known, key)) known[key] = identity;
  };
  for (const use of report.uses) {
    const fileFacts = use.item === null ? null : facts.get(use.path);
    if (!fileFacts || fileFacts.rest === null) { add(use.case, use.path); continue; }
    if (use.item !== '') add(use.case, itemKey(use.path, use.item), use.fingerprint);
    add(use.case, restKey(use.path), fileFacts.rest);
  }
  for (const name of report.results.keys()) if (!cases.has(name)) cases.set(name, new Set());
  return { shared, cases, known, results: report.results };
}

// The item files reported checks' records name whose content changed since: the project's
// itemIdentity command answers them in one call before the checks are judged.
function prepareItems(entries, records, ctx) {
  if (!ctx.runCommands || !ctx.itemIdentity) return;
  const files = new Set();
  for (const entry of entries) {
    const record = records[entry.id];
    if (!record || record.kind !== 'reported' || !Array.isArray(record.files)) continue;
    const known = knownItems(record, ctx);
    for (const key of record.files) if (isItemKey(key) && !own(known, key)) files.add(pathOf(key));
  }
  if (files.size) itemFacts(ctx, [...files]);
}

// Whether another check's pass may stand for this one (its `coveredBy`): it names a covering
// check, it is not manual and was found, its record holds a run that did not fail and saw
// its inputs, and its contract is one its own run would accept — covering must not hide an
// invalid contract. The runner (main.js) and the hooks' view (project-state.js) share it.
function coverable(entry, record) {
  if (!entry || typeof entry.coveredBy !== 'string' || entry.type === 'manual' || entry.discoveryError) return false;
  if (!record || record.lastFailedAt || !Array.isArray(record.files) || record.files.length === 0) return false;
  try { validateEntry(entry); } catch (_) { return false; }
  return true;
}

// A check whose last run failed (its failure record stays until an executed pass clears it).
// --changed runs it first; --failed runs only these (D170).
function isFailing(record) {
  return Boolean(record && record.lastFailedAt);
}

// For each runnable entry: run (with the reason) or reuse its pass. gates: the gate entries
// (default: those among `entries`; a caller judging one check passes them all).
// everyTime: false judges a reuse:false or always check like any other — by whether its
// last passes hold the current inputs — for a caller that asks what has not passed on the
// current files rather than what a run would run (a hook before a commit, D155 P3).
function planRun({ entries, records, olderRecords, ctx, reuse, gates = null, everyTime = true }) {
  const plan = { selected: [], reasons: {}, changedInputs: {}, reused: [], sets: new Map(), fingerprints: new Map(), unknownInputs: [],
    cases: new Map(), gatesPending: [], awaitingGate: [] };
  prepareItems(entries, records, ctx);
  const judge = entry => {
    const record = records[entry.id];
    let set = null;
    if (!entry.discoveryError && entry.command) {
      try { set = inputSet(entry, record, ctx); } catch (_) { set = null; }
    }
    let reason = null;
    if (entry.discoveryError) reason = 'discovery found no file';
    else if (everyTime && entry.reuse === false) reason = 'reuse:false';
    else if (everyTime && entry.always === true) reason = 'always';
    else if (!reuse) reason = 'all checks requested (--no-reuse)';
    else if (!record) reason = olderRecords ? 'record from an older runner' : 'new check';
    else if (isFailing(record)) reason = 'failed in the last run';
    // The fingerprint is worked out only when a decision needs it: to compare with the
    // passes, or to tell a repeated failure from a new one.
    let fingerprint = null;
    if (set && record && (!reason || (record.lastFailedAt && record.failKey))) {
      try { fingerprint = fingerprintOf(entry, set, ctx); } catch (_) { fingerprint = null; } // An unreadable input cannot vouch for reuse.
    }
    if (!reason) {
      if (!fingerprint) reason = 'an input could not be read';
      else if (!Array.isArray(record.passHistory) || !record.passHistory.includes(fingerprint)) reason = changeReason(set, record, ctx);
    }
    return { record, set, fingerprint, reason };
  };
  for (const entry of entries) {
    if (entry.type === 'manual') continue;
    const { record, set, fingerprint, reason } = judge(entry);
    plan.sets.set(entry.id, set);
    // A Node check that never ran is traced on its first run; it is not "unknown" yet.
    const untracedNode = runsOnRunnerNode(entry.command) && !record;
    if (set && set.kind === 'project' && !untracedNode) plan.unknownInputs.push(entry.id);
    plan.fingerprints.set(entry.id, fingerprint);
    if (!reason) { plan.reused.push(entry.id); continue; }
    plan.selected.push(entry.id);
    plan.reasons[entry.id] = reason;
    if (set && reasonGroup(reason) === 'with changed inputs') {
      let differences = [];
      try { differences = inputDifferences(set, record, ctx); } catch (_) {}
      if (differences.length) plan.changedInputs[entry.id] = differences;
    }
    if (set && (reason === 'failed in the last run' || reasonGroup(reason) === 'with changed inputs')) {
      let cases = null;
      try { cases = casesToRun(entry, record, set, ctx); } catch (_) {}
      if (cases) plan.cases.set(entry.id, cases);
    }
  }
  // A changed file that no check reads or declares (D143 §1): the checks whose inputs
  // are not completely traced — declared ones; unknown-input checks see it already —
  // run once. This run's snapshot records the file, so the next run does not. A file
  // inside the scope of a check's report belongs to that check: not named there, not used.
  const owned = new Set();
  const scopes = [];
  for (const set of plan.sets.values()) {
    if (!set || set.kind === 'project') continue;
    for (const key of set.files) owned.add(pathOf(key));
    if (set.kind === 'reported') scopes.push(set.scope);
  }
  const ownerless = ctx.snapshot.changedFiles().filter(file => !owned.has(file) && !scopes.some(scope => inScope(scope, file)));
  if (ownerless.length) {
    for (const entry of entries) {
      const set = plan.sets.get(entry.id);
      if (!set || set.kind !== 'declared' || entry.slow === true || !plan.reused.includes(entry.id)) continue;
      plan.reused.splice(plan.reused.indexOf(entry.id), 1);
      plan.selected.push(entry.id);
      plan.reasons[entry.id] = `${ownerless[0]} changed and no check reads or declares it`;
      plan.changedInputs[entry.id] = ownerless.map(file => `${file} changed and no check reads or declares it`);
    }
    plan.selected.sort((a, b) => entries.findIndex(entry => entry.id === a) - entries.findIndex(entry => entry.id === b));
  }
  // D152 P11: a check narrowed by its report is reused only while every gate has passed on
  // the current files. While a gate must run, those checks wait for it (main.js): reused
  // when it passes, not run when it fails. A gate's fingerprint is not part of theirs.
  const isGate = entry => Boolean(entry) && entry.gate === true && entry.type !== 'manual';
  const pending = (gates || entries).filter(isGate).filter(gate => (entries.some(entry => entry.id === gate.id)
    ? !plan.reused.includes(gate.id) : Boolean(judge(gate).reason)));
  if (pending.length) {
    plan.gatesPending = pending.map(gate => gate.id);
    plan.awaitingGate = plan.reused.filter(id => {
      const set = plan.sets.get(id);
      return Boolean(set) && set.kind === 'reported' && !isGate(entries.find(entry => entry.id === id));
    });
  }
  return plan;
}

// D164 (Ninja's restat, Bazel's early cutoff): a check that reads a file another check of
// this run writes — its `outputs` — is judged after that writer ran, by what it wrote.
// running: the ids that run in this run; reusable: the ids whose passes could be reused.
// For each reader: the writers it waits for and the files it reads from them. A reused
// reader that runs after all may write too, so its own outputs count until nothing new is
// found. A check with unknown inputs never sees `outputs` (they are not project files).
function readersOf({ entries, sets, running, reusable }) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const writes = id => patternList(byId.has(id) ? byId.get(id).outputs : null);
  const candidates = [...running, ...reusable].filter(id => byId.has(id));
  const writers = new Set(running.filter(id => writes(id).length));
  const readers = new Map();
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of candidates) {
      const set = sets.get(id);
      if (!set || set.kind === 'project') continue;
      const files = [...new Set(set.files.map(pathOf))];
      for (const writer of writers) {
        if (writer === id || (readers.has(id) && readers.get(id).writers.includes(writer))) continue;
        const read = files.filter(file => writes(writer).some(pattern => underPattern(pattern, file)));
        if (!read.length) continue;
        const found = readers.get(id) || { writers: [], files: [] };
        found.writers.push(writer);
        found.files = [...new Set([...found.files, ...read])].sort();
        readers.set(id, found);
        if (!writers.has(id) && writes(id).length) writers.add(id);
        grew = true;
      }
    }
  }
  return readers;
}

// Files a check of this run wrote: their content and items are read again when next asked.
function forgetFiles(ctx, files) {
  ctx.snapshot.refresh(files);
  if (ctx.items) for (const file of files) ctx.items.delete(file);
}

// A reused check judged again after the checks that write what it reads ran (D164): why
// it must run now, or null while its inputs are still ones it passed with.
function reasonAfterWriters(entry, record, ctx) {
  let set;
  let fingerprint;
  try {
    set = inputSet(entry, record, ctx);
    fingerprint = fingerprintOf(entry, set, ctx);
  } catch (_) { return 'an input could not be read'; }
  if (record && Array.isArray(record.passHistory) && record.passHistory.includes(fingerprint)) return null;
  return changeReason(set, record, ctx);
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
  covers, patternList, inputPatterns, matchesInput, underPattern, inputsCover, crabshellState, exclusion, filesMatching, argumentFiles,
  declarationKey, medianDuration, isSlow, DEFAULT_SLOW_AFTER_SECONDS,
  recordKind, inputsUnknown, reportScope, scopeKey, inScope, keyIdentity, knownItems, refreshedItemHashes, itemFacts, casesToRun, reportedInputs,
  inputSet, fingerprintOf, changedKeys, inputDifferences, changeReason, DECISION_CHANGED, reasonGroup, coverable, isFailing, planRun,
  readersOf, forgetFiles, reasonAfterWriters, withoutRunnerFiles, gitChangedFiles, gitVisibleFiles, currentHead,
};
