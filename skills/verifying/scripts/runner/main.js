'use strict';
// One run: read the manifest, look at the project once, choose the checks (the Bazel
// rule in select.js), run or reuse each, record and print.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runnerLayout, MODULE_DIR, DECISION_MODULES } = require('./layout');
const { parseArgs } = require('./args');
const { toPosix, validateEntry, entryTestFile, expandEntries } = require('./manifest');
const { validateManifestSettings } = require('./settings');
const { copyNotices } = require('./test-hygiene');
const { hashBuffer, runsOnRunnerNode } = require('./fingerprint');
const { TRACER_SOURCE, insideRoot, readTrace, readDeep, filesUnder, readChildren, incompleteChildren, contractPaths } = require('./trace');
const { mapPath, writeMap } = require('./store');
const { selectionView } = require('./project-state');
const { patternList, inputPatterns, matchesInput, filesMatching, inputSet, fingerprintOf, planRun, gitChangedFiles, medianDuration, declarationKey, crabshellState, DECISION_CHANGED, currentHead, reasonGroup } = require('./select');
const { routineChoice, quarantineMark, markHolds } = require('./routine');
const { forbiddenOnly, recheckForbidden, clearedNotice } = require('./recheck');
const { runEntry, runEntryAsync } = require('./execute');
const { runInOrder, runSideBySide, defaultJobs, runsAlone } = require('./schedule');
const { commitChanges, replay, replayLines } = require('./replay');
const { failBeforeTargets, failBeforeExemptions, matchingExemption, failBeforeChecks } = require('./fail-before');
const { printResults } = require('./output');
const { classify } = require('./classify');

const DEFAULT_PASS_HISTORY = 10;
// A failure on inputs a check passed with runs once more by default (Rare).
const DEFAULT_RETRIES = 1;
// Side by side (D151_T001): a further check starts only while this much memory is free —
// free memory, not the machine's usage share, because other programs on a shared machine
// would otherwise hold every run to one at a time. A manifest `memoryShare` still applies.
const DEFAULT_MIN_FREE_MEMORY_MB = 2048;
// Pause between two starts, so the memory a started check takes is seen before the next.
const DEFAULT_START_SPACING_MS = 250;
// Runs kept in the record map (for the count of runs since the last commit).
const RUN_LOG_LIMIT = 50;

// Continue with fn once a value is ready: now, or when its promise settles.
const then = (value, fn) => (value && typeof value.then === 'function' ? value.then(fn) : fn(value));

// Top-level manifest fields the runner reads.
// options.layout (or options.launcherDir) says where the launcher sits; the launcher
// passes its own folder.
function main(argv = process.argv.slice(2), options = {}) {
  const started = process.hrtime.bigint();
  const layout = options.layout || runnerLayout(options.launcherDir || path.join(__dirname, '..'));
  const args = parseArgs(argv);
  const failRunner = (id, error) => printResults([
    { id, status: 'FAIL', error, output: '', durationMs: 0, failureClass: classify(error, '') }
  ], { args, started, resultsPath: layout.resultsPath });
  if (args.error) return failRunner('RUNNER_ARGS', args.error);
  // A check that starts this project's whole verification again would recurse. The
  // running runner names its project root; a runner for another project (a fixture in a
  // temporary folder) is not nested (D143_T006). "1" is what older runners set.
  const projectRoot = path.resolve(options.projectRoot || process.env.PROJECT_ROOT || layout.defaultProjectRoot);
  const running = process.env.CRABSHELL_VERIFY_RUNNING;
  const nested = running === '1' || (Boolean(running) && path.resolve(running).toLowerCase() === projectRoot.toLowerCase());
  const named = args.targetIds.length > 0;
  if (nested && !named && !args.dryRun) {
    return failRunner('RUNNER_RECURSION', 'Nested full-manifest verification is blocked. Pass an explicit entry id.');
  }
  const manifestPath = options.manifestPath || layout.manifestPath;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, ''));
    validateManifestSettings(manifest);
  } catch (error) {
    return failRunner('RUNNER_MANIFEST', `Cannot read manifest: ${error.message}`);
  }
  let expanded;
  try {
    expanded = expandEntries(manifest, projectRoot);
  } catch (error) {
    return failRunner('RUNNER_DISCOVERY', error.message);
  }
  if (args.files) console.error('[VERIFY] --files is no longer used: checks are chosen by the content of their inputs.');
  const unknownIds = args.targetIds.filter(id => !expanded.some(entry => entry.id === id));
  if (unknownIds.length) return failRunner('RUNNER_TARGET', `Unknown entry id: ${unknownIds.join(', ')}`);

  // Records of this schema (an older map counts as none: every check runs once), the
  // snapshot and the selection context — built by project-state, as for the hooks.
  const { previousMap, records: previousRecords, olderRecords, snapshot, ctx } = selectionView({ projectRoot, layout, manifestPath, manifest });
  const runnable = expanded.filter(entry => entry.type !== 'manual');
  // D151_T001: side by side by default. With no `jobs` setting only recorded traced Node
  // checks share the machine; any other check (a first run, declared inputs, another
  // program such as a game engine that may share a cache) runs alone unless its entry says
  // `exclusive: false`. A manifest that sets `jobs` keeps the older rule: every check may share.
  const jobsDeclared = Number.isInteger(manifest.jobs);
  const jobs = jobsDeclared ? manifest.jobs : defaultJobs();
  // D151: --replay N estimates past commits' routine runs from the records; nothing runs.
  if (args.replay) {
    const moduleDir = path.join(path.dirname(layout.launcherFile), MODULE_DIR);
    const decisionFiles = DECISION_MODULES.map(name => insideRoot(projectRoot, path.join(moduleDir, name))).filter(Boolean);
    let commits;
    try { commits = commitChanges(projectRoot, args.replay); } catch (error) { return failRunner('RUNNER_REPLAY', error.message); }
    const rows = replay({ commits, entries: runnable, records: previousRecords, manifest, jobs, decisionFiles,
      isExclusive: entry => runsAlone(entry, previousRecords[entry.id], jobsDeclared) });
    console.log(args.json ? JSON.stringify(rows) : replayLines(rows, jobs).join('\n'));
    return 0;
  }
  const planned = planRun({ entries: runnable, records: previousRecords, olderRecords, ctx, reuse: args.reuse });
  const total = runnable.length;

  // fail-before (opt-in) compares changed tests with HEAD, so it needs git's change list.
  let changedList = [];
  let changesKnown = false;
  const earlyNotices = [];
  if (args.failBefore) {
    const changed = gitChangedFiles(projectRoot);
    changedList = changed.files || [];
    changesKnown = !changed.error;
    if (changed.error) earlyNotices.push(`Fail-before: ${changed.error.split('\n')[0]}; no changed test was compared with HEAD.`);
  }
  const changedTests = new Set(changedList.map(toPosix));
  const comparedWithHead = entry => args.failBefore && changedTests.has(entryTestFile(entry, projectRoot));

  let entries;
  let plan = null;
  if (named) {
    entries = expanded.filter(entry => args.targetIds.includes(entry.id));
  } else if (args.changed) {
    const chosen = new Set(planned.selected);
    // A changed test compared with HEAD always gets a real execution.
    for (const entry of runnable) if (comparedWithHead(entry)) chosen.add(entry.id);
    plan = { mode: 'changed', selected: runnable.filter(entry => chosen.has(entry.id)).map(entry => entry.id), total, reasons: planned.reasons };
    // D143: heavy checks (declared slow, or a median pass time over slowAfterSeconds)
    // stay out of routine --changed runs; --slow, an entry id argument or a full run includes them. Each
    // is named with whether its inputs changed, how often it ran and when it last failed.
    // D151_T006 (routine.js): a changed file under `riskPaths` brings in the heavy checks whose
    // inputs changed, and quarantined flaky checks are left out and named.
    const inputsChanged = id => Boolean(planned.reasons[id]) && reasonGroup(planned.reasons[id]) === 'with changed inputs';
    const slowState = id => {
      if (!planned.reasons[id]) return 'unchanged';
      const group = reasonGroup(planned.reasons[id]);
      return group === 'with changed inputs' ? 'inputs changed' : group;
    };
    if (!args.slow) {
      Object.assign(plan, routineChoice({ entries: runnable, selected: plan.selected, records: previousRecords, manifest, snapshot, stateOf: slowState, inputsChanged }));
      plan.slowCommand = `node ${insideRoot(projectRoot, layout.launcherFile) || layout.launcherFile} --slow`;
    }
    const keep = new Set(plan.selected);
    entries = runnable.filter(entry => keep.has(entry.id));
  } else {
    entries = runnable;
  }
  const reusable = new Set(planned.reused);
  const selectedIndex = new Map(entries.map((entry, index) => [entry.id, index]));
  const coveringIndex = entry => {
    if (!args.reuse || named || entry.type === 'manual' || entry.discoveryError || comparedWithHead(entry)) return undefined;
    const record = previousRecords[entry.id];
    if (!record || record.lastFailedAt || !Array.isArray(record.files) || record.files.length === 0) return undefined;
    // Covering must not hide an invalid contract that ordinary execution rejects.
    try { validateEntry(entry); } catch (_) { return undefined; }
    return selectedIndex.get(entry.coveredBy);
  };
  const canReuse = entry => args.reuse && !named && reusable.has(entry.id) && !comparedWithHead(entry);
  const executionOrder = [];
  const ordered = new Set();
  const order = index => {
    if (ordered.has(index)) return;
    ordered.add(index);
    const parent = coveringIndex(entries[index]);
    if (parent !== undefined) order(parent);
    executionOrder.push(index);
  };
  // D143: a routine --changed run starts with the check that failed last time, then
  // checks with no record, then the quickest by median pass time, and stops at a new
  // failure; a full run keeps the manifest order and runs them all. Results are still
  // listed in manifest order.
  const runOrder = entries.map((_, index) => index);
  if (args.changed) {
    const rank = index => {
      const record = previousRecords[entries[index].id];
      if (record && record.lastFailedAt) return [0, 0];
      if (!record) return [1, 0];
      const median = medianDuration(record);
      return [2, Number.isFinite(median) ? median : 0];
    };
    runOrder.sort((a, b) => { const x = rank(a); const y = rank(b); return x[0] - y[0] || x[1] - y[1] || a - b; });
  }
  runOrder.forEach(index => order(index));

  if (args.dryRun) {
    if (!plan) plan = { mode: named ? 'id' : 'full', selected: entries.filter(entry => !canReuse(entry)).map(entry => entry.id), total, reasons: planned.reasons };
    let estimatedMs = 0;
    // Checks that would run with no recorded time add nothing to the estimate; they are
    // counted so the estimate does not read as the whole run (D143_T006).
    let runWithoutTime = 0;
    let runCount = 0;
    plan.wouldReuse = 0;
    plan.wouldCover = 0;
    const covered = new Set();
    const reused = new Set();
    for (const index of executionOrder) {
      const entry = entries[index];
      const parent = coveringIndex(entry);
      // This estimate assumes the covering command passes. A covered result is
      // not itself execution evidence for another check in a coverage chain.
      if (parent !== undefined && !covered.has(parent) && entries[parent].type !== 'manual' && !entries[parent].discoveryError
        && (!(entry.reuse === false || entry.always === true) || !reused.has(parent))) {
        covered.add(index);
        plan.wouldCover++;
        continue;
      }
      if (parent === undefined && canReuse(entry)) { reused.add(index); plan.wouldReuse++; }
      else {
        const duration = (previousRecords[entry.id] || {}).lastDurationMs;
        runCount++;
        if (Number.isFinite(duration) && duration >= 0) estimatedMs += duration;
        else runWithoutTime++;
      }
    }
    // A --changed run lists only the checks it runs; the passes it reuses are the rest.
    if (args.changed) {
      const listed = new Set(entries.map(entry => entry.id));
      plan.wouldReuse += planned.reused.filter(id => !listed.has(id)).length;
    }
    plan.failBeforeTargets = 0;
    if (args.changed && args.failBefore) {
      const exemptions = failBeforeExemptions(manifestPath);
      for (const { entry, test } of failBeforeTargets({ entries, records: previousRecords,
        changedFiles: changedList, expanded, projectRoot, manifestPath, layout })) {
        try {
          if (matchingExemption(exemptions[test], hashBuffer(fs.readFileSync(path.join(projectRoot, test))))) continue;
        } catch (_) {} // An unreadable test cannot authorize an exemption.
        plan.failBeforeTargets++;
        // ls-tree resolves paths from this project even inside a larger repo.
        // Only a successful empty lookup proves there is no HEAD baseline.
        const head = spawnSync('git', ['ls-tree', 'HEAD', '--', test], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
        const runs = !head.error && head.status === 0 && head.stdout.trim() === '' ? 1 : 2;
        const duration = (previousRecords[entry.id] || {}).lastDurationMs;
        if (Number.isFinite(duration) && duration >= 0) estimatedMs += duration * runs;
      }
    }
    plan.full = plan.selected.length === total && total > 0;
    plan.reason = summaryReason(plan, planned);
    plan.unknownInputs = planned.unknownInputs;
    plan.estimatedSeconds = Math.round(estimatedMs / 100) / 10;
    plan.withoutRecordedTime = runWithoutTime;
    if (runWithoutTime) plan.estimateNote = `${runWithoutTime} of the ${runCount} checks that would run have no recorded time and are not in estimatedSeconds`;
    if (args.explain) {
      if (plan.selected.length) console.log(`Estimated ${plan.estimatedSeconds}s${runWithoutTime ? ` for the checks with a recorded time; ${plan.estimateNote.replace(' and are not in estimatedSeconds', '')}` : ''}.`);
      // One line per check a --changed run would run: its id and the first reason.
      const risky = new Set(plan.riskIncluded ? plan.riskIncluded.ids : []);
      const lines = plan.selected.map(id => `${id}: ${planned.reasons[id] || 'selected'}${risky.has(id) ? `; heavy, runs because ${plan.riskIncluded.file} changed (riskPaths)` : ''}`);
      console.log(lines.length ? lines.join('\n') : 'No check would run for the current changes.');
      if (plan.slowSkipped && plan.slowSkipped.length) console.log(`Slow checks left to --slow: ${plan.slowSkipped.map(id => `${id} (${plan.slowStates[id]})`).join(', ')}`);
      if (plan.quarantined && plan.quarantined.length) console.log(`Left out as flaky: ${plan.quarantined.map(item => `${item.id} (until ${item.test} changes)`).join(', ')}`);
      if (plan.selected.some(id => planned.reasons[id] === DECISION_CHANGED)) console.log("The runner's decision code changed: every non-slow check runs once; slow checks wait for --slow.");
      return 0;
    }
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }

  let traceDir = null;
  let tracer = null;
  const ensureTracer = () => {
    if (tracer) return;
    traceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-verify-trace-'));
    tracer = path.join(traceDir, 'tracer.js');
    fs.writeFileSync(tracer, TRACER_SOURCE);
  };
  const startedAt = new Date().toISOString();
  const records = { ...previousRecords };
  const pendingPasses = new Map();
  const results = new Array(entries.length);
  const generated = new Set([mapPath(manifestPath), layout.resultsPath].map(file => insideRoot(projectRoot, file)));
  const historyLimit = Number.isInteger(manifest.passHistory) ? manifest.passHistory : DEFAULT_PASS_HISTORY;
  const retries = Number.isInteger(manifest.retries) ? manifest.retries : DEFAULT_RETRIES;
  const minFreeMemoryMB = typeof manifest.minFreeMemoryMB === 'number' ? manifest.minFreeMemoryMB : DEFAULT_MIN_FREE_MEMORY_MB;
  const memoryShare = typeof manifest.memoryShare === 'number' ? manifest.memoryShare : null;
  const startSpacingMs = typeof manifest.startSpacingMs === 'number' ? manifest.startSpacingMs : DEFAULT_START_SPACING_MS;
  const memoryAllows = () => os.freemem() / (1024 * 1024) >= minFreeMemoryMB
    && (memoryShare === null || 1 - os.freemem() / os.totalmem() <= memoryShare);
  const isExclusive = index => runsAlone(entries[index], previousRecords[entries[index].id], jobsDeclared);
  const notices = [...earlyNotices];
  const distrusted = new Set();
  // A covered or reused check needs no run.
  const decide = (entry, index) => {
    const parent = coveringIndex(entry);
    if (parent !== undefined && results[parent] && results[parent].status === 'PASS' && !results[parent].coveredBy
      && (!(entry.reuse === false || entry.always === true) || !results[parent].reused)) {
      // Keep its record as it is: the passes it holds came from real executions, and a
      // command that did not run adds none.
      const record = { ...previousRecords[entry.id] };
      if (!record.test) record.test = entryTestFile(entry, projectRoot);
      records[entry.id] = record;
      return { id: entry.id, type: entry.type, status: 'PASS', coveredBy: entry.coveredBy, durationMs: 0,
        message: `Covered by ${entry.coveredBy}`, output: '', error: null, failureClass: null };
    }
    // If the selected covering check failed (or was only covered itself), get fresh
    // evidence from this command even when it has an older pass.
    if (parent === undefined && canReuse(entry)) {
      return { id: entry.id, type: entry.type, status: 'PASS', reused: true, durationMs: 0,
        message: 'Unchanged since it passed', output: '', error: null, failureClass: null };
    }
    return null;
  };
  const traceFor = (entry, index, attempt) => {
    if (!runsOnRunnerNode(entry.command)) return null;
    ensureTracer();
    return { tracer, file: path.join(traceDir, `trace-${index}-${attempt}.jsonl`) };
  };
  // D143 §2: a check that fails on inputs it passed with runs again, up to `retries`
  // times. runFn(trace) returns the result, or a promise of it when checks run side by side.
  const attempts = (entry, index, runFn) => {
    const previous = previousRecords[entry.id] || {};
    let before = null;
    if (Array.isArray(previous.passHistory)) {
      try { before = fingerprintOf(entry, inputSet(entry, previous, ctx), ctx); } catch (_) {}
    }
    const retriable = Boolean(before) && previous.passHistory.includes(before);
    const step = (attempt, firstFailure) => then(runFn(traceFor(entry, index, attempt)), result => {
      // D151_T006 (recheck.js): a failure that is only a forbidden-file change runs once
      // more, in place of a retry; its outcome is never a flaky verdict.
      const forbidden = forbiddenOnly(entry, result);
      if (forbidden.length) {
        return then(recheckForbidden({ entry, projectRoot, failure: result, files: forbidden, run: () => runFn(traceFor(entry, index, attempt + 1)) }),
          ({ result: settled, cleared }) => ({ result: settled, runs: attempt + 2, firstFailure, trace: traceFor(entry, index, cleared ? attempt + 1 : attempt), retriable, cleared }));
      }
      if (result.status === 'FAIL' && retriable && attempt < retries) return step(attempt + 1, firstFailure || result);
      return { result, runs: attempt + 1, firstFailure, trace: traceFor(entry, index, attempt), retriable };
    });
    return step(0, null);
  };
  // What a run leaves in the record: its inputs, its time, its passes and failures.
  const complete = (entry, index, outcome) => {
    const { result, trace } = outcome;
    if (entry.type === 'manual' || entry.discoveryError) return result;
    const test = entryTestFile(entry, projectRoot);
    const previous = previousRecords[entry.id] || {};
    const record = { test };
    if (trace) {
      // What it read (its own `outputs` are products, not inputs) and whether the trace
      // saw everything: a started program that works in the project unseen makes the
      // whole project its input.
      const outputs = patternList(entry.outputs);
      // A folder it copied or listed recursively stands for every file under it; one it only
      // listed or probed, for its names (D151_T007) — `folders: 'names'` marks the format.
      const deepFolders = [...readDeep(trace.file, projectRoot)].filter(item => item.endsWith('/'));
      const files = new Set([...readTrace(trace.file, projectRoot), ...filesUnder(deepFolders, () => snapshot.list()),
        ...contractPaths(entry), ...filesMatching(inputPatterns(entry), snapshot)]);
      record.folders = 'names';
      record.files = [...files].filter(file => !generated.has(file) && !outputs.some(pattern => matchesInput(pattern, file))).sort();
      const incomplete = incompleteChildren(readChildren(trace.file), projectRoot);
      record.kind = record.files.length > 0 && incomplete.length === 0 ? 'traced' : 'project';
      if (incomplete.length) record.incomplete = incomplete.slice(0, 3);
    } else {
      record.files = filesMatching(inputPatterns(entry), snapshot).sort();
      record.kind = inputPatterns(entry).length > 0 ? 'declared' : 'project';
    }
    const duration = result.timedOut ? previous.lastDurationMs : result.durationMs;
    if (duration !== undefined) record.lastDurationMs = duration;
    if (Array.isArray(previous.passHistory)) record.passHistory = previous.passHistory;
    if (previous.passedAt) record.passedAt = previous.passedAt;
    // Pass times (for the median that ranks checks and finds heavy ones; a time-out
    // says nothing about the check's speed), runs, and the last failure, which a
    // later pass does not erase.
    const durations = Array.isArray(previous.durations) ? previous.durations : [];
    record.durations = result.status === 'PASS' && !result.timedOut ? [...durations, result.durationMs].slice(-historyLimit) : durations;
    record.runs = (previous.runs || 0) + outcome.runs;
    if (result.status === 'FAIL') record.lastFailure = new Date().toISOString();
    else if (previous.lastFailure) record.lastFailure = previous.lastFailure;
    // A distrust of declared inputs holds until the declaration changes.
    if (previous.inputsDistrusted && previous.inputsDistrusted === declarationKey(entry)) record.inputsDistrusted = previous.inputsDistrusted;
    // A quarantine (routine.js) holds until the test file changes.
    if (markHolds(previous.quarantine, test, snapshot)) record.quarantine = previous.quarantine;
    if (outcome.firstFailure && result.status === 'PASS') {
      result.flaky = true;
      const mark = quarantineMark(test, snapshot);
      if (mark) record.quarantine = mark;
      notices.push(`Flaky: ${entry.id} failed and then passed on the same inputs.${mark ? ` It is left out of --changed runs until ${test} changes.` : ''}`);
    }
    if (outcome.cleared && result.status === 'PASS') {
      result.forbiddenRechecked = outcome.cleared;
      notices.push(clearedNotice(entry.id, outcome.cleared));
    }
    if (outcome.retriable && outcome.runs > 1 && result.status === 'FAIL' && record.kind === 'declared' && inputPatterns(entry).length > 0) {
      record.inputsDistrusted = declarationKey(entry);
      distrusted.add(entry.id);
      notices.push(`${entry.id} failed on inputs it passed with: its "inputs" miss something, so it uses the whole project until they change.`);
    }
    // The fingerprint of what it ran on, from the look taken before the run.
    let set = null;
    let fingerprint = null;
    try {
      set = inputSet(entry, record, ctx);
      fingerprint = fingerprintOf(entry, set, ctx);
    } catch (_) {}
    if (set && fingerprint) {
      record.fingerprint = fingerprint;
      // Which decision code judged it, so a later change of that code is named (D143_T020).
      record.decision = ctx.decision;
      if (set.kind !== 'project') record.inputHashes = Object.fromEntries(set.files.map(file => [file, snapshot.hash(file)]));
      if (result.status === 'PASS' && !result.timedOut) pendingPasses.set(entry.id, { fingerprint, set });
    }
    records[entry.id] = record;
    return result;
  };
  // D143: a --changed run stops at a new failure — a check that passed last time, is new,
  // or whose inputs (files, entry, program, runner) changed since it last failed. A check
  // failing again on the inputs it failed with is reported and the run goes on. After a
  // stop no new check starts (one already running finishes and is recorded); the rest are
  // reported as not run, keep their earlier records, and are selected again by the next
  // --changed run. A failure record without a failure key counts as new.
  const failedOnSameInputs = entry => {
    const previous = previousRecords[entry.id];
    const fingerprint = planned.fingerprints.get(entry.id);
    return Boolean(previous && previous.lastFailedAt && previous.failKey && fingerprint && previous.failKey === fingerprint);
  };
  let stoppedAt = null;
  const notRun = [];
  const stillFailing = [];
  const sameInputs = new Map();
  const startOne = (index, runFn) => {
    const entry = entries[index];
    // Judged before the run: a check may write its own inputs.
    sameInputs.set(index, args.changed && failedOnSameInputs(entry));
    const decided = decide(entry, index);
    if (decided) return decided;
    return then(attempts(entry, index, runFn), outcome => complete(entry, index, outcome));
  };
  const after = {
    stopped: () => Boolean(stoppedAt),
    skip: index => {
      const entry = entries[index];
      notRun.push(entry.id);
      results[index] = { id: entry.id, type: entry.type, status: 'NOT_RUN', durationMs: 0,
        message: `Not run: ${stoppedAt} failed first`, output: '', error: null, failureClass: null };
    },
    done: (index, result) => {
      results[index] = result;
      if (args.changed && result.status === 'FAIL') {
        if (sameInputs.get(index)) stillFailing.push(entries[index].id);
        else if (!stoppedAt) stoppedAt = entries[index].id;
      }
    },
  };
  // D143 §4: `jobs` above 1 runs checks side by side (schedule.js); otherwise one at a time.
  const scheduled = jobs > 1
    ? runSideBySide({ order: executionOrder, entries, after, jobs, memoryAllows, isExclusive, startSpacingMs,
      waitsFor: index => coveringIndex(entries[index]),
      start: index => startOne(index, trace => runEntryAsync(entries[index], { projectRoot, trace })) })
    : runInOrder({ order: executionOrder, after, start: index => startOne(index, trace => runEntry(entries[index], { projectRoot, trace })) });
  const conclude = () => {
  const failBefore = args.failBefore && !named
    ? failBeforeChecks({ entries, results, records, changedFiles: changedList, expanded, projectRoot, manifestPath, layout })
    : [];
  const checkFailedIds = new Set(results.filter(result => result && result.status === 'FAIL').map(result => result.id));
  const failedIds = new Set(checkFailedIds);
  for (const result of failBefore) if (result.status === 'FAIL') failedIds.add(result.id.slice('FAIL_BEFORE:'.length));
  const comparisonEnabled = Boolean(args.failBefore && changesKnown);
  const comparisonTargets = new Set(comparisonEnabled ? failBeforeTargets({ entries, records,
    changedFiles: changedList, expanded, projectRoot, manifestPath, layout }).map(({ entry }) => entry.id) : []);
  const comparisonPassed = new Set(failBefore.filter(result => result.status === 'PASS').map(result => result.id.slice('FAIL_BEFORE:'.length)));
  // A pass counts only if none of its inputs was written while checks ran (another
  // worker's edit, or the check writing what it reads): its result may come from
  // content the fingerprint does not describe.
  // Only the inputs of pending passes are looked at again, unless one of them reads the
  // whole project.
  const pending = [...pendingPasses.values()];
  const writtenDuringRun = pending.length === 0 ? new Set()
    : pending.some(pass => pass.set.kind === 'project') ? snapshot.restat()
      : snapshot.restat([...new Set(pending.flatMap(pass => pass.set.files))]);
  // Inputs written while checks ran, which kept a pass from being recorded.
  const blockedBy = new Set();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const result = results[index];
    const record = records[entry.id];
    if (!record || !result || result.reused || result.coveredBy || result.status === 'NOT_RUN' || entry.type === 'manual') continue;
    const previous = previousRecords[entry.id] || {};
    if (failedIds.has(entry.id)) {
      // A failing run's trace may stop early; keep the dependencies the last full run saw.
      const failed = { ...previous, ...record, files: Array.isArray(previous.files) && previous.files.length ? previous.files : record.files,
        lastFailedAt: new Date().toISOString(), lastFailedKind: checkFailedIds.has(entry.id) ? 'check' : 'fail-before' };
      // The failure key covers the same inputs the next run will read from this record.
      let failKey = null;
      try { failKey = fingerprintOf(entry, inputSet(entry, failed, ctx), ctx); } catch (_) {}
      if (failKey) failed.failKey = failKey; else delete failed.failKey;
      // D143: name checks that fail on inputs they passed with (flaky).
      if (checkFailedIds.has(entry.id) && !distrusted.has(entry.id) && record.fingerprint && Array.isArray(previous.passHistory) && previous.passHistory.includes(record.fingerprint)) {
        notices.push(`Flaky: ${entry.id} passed and failed on the same inputs.`);
      }
      delete failed.fingerprint;
      records[entry.id] = failed;
      continue;
    }
    delete record.fingerprint;
    if (result.status !== 'PASS') continue;
    if (previous.lastFailedKind === 'fail-before' && (!comparisonEnabled
      || (comparisonTargets.has(entry.id) && !comparisonPassed.has(entry.id)))) {
      // An ordinary PASS cannot resolve a failed HEAD comparison. Keep its dependencies
      // and its mark until the comparison succeeds or no longer applies.
      const pending = { ...previous, test: previous.test || record.test,
        files: Array.isArray(previous.files) ? previous.files : record.files };
      if (record.lastDurationMs !== undefined) pending.lastDurationMs = record.lastDurationMs;
      records[entry.id] = pending;
      failedIds.add(entry.id);
      continue;
    }
    const pass = pendingPasses.get(entry.id);
    if (!pass) continue;
    // A check with unknown inputs reads the whole project, so any write counts.
    const touched = pass.set.kind === 'project' ? [...writtenDuringRun]
      : pass.set.files.filter(file => writtenDuringRun.has(file)
        || (file.endsWith('/') && [...writtenDuringRun].some(written => written.startsWith(file))));
    if (touched.length) { for (const file of touched) blockedBy.add(file); continue; }
    record.passHistory = [pass.fingerprint, ...(record.passHistory || []).filter(key => key !== pass.fingerprint)].slice(0, historyLimit);
    record.passedAt = new Date().toISOString();
  }
  // D151_T002: one line per run — the commit it ran on, checks run, milliseconds — so
  // runs repeated on work in progress show as a count (a guard run is not counted).
  const head = args.guardRun ? null : currentHead(projectRoot);
  const runs = previousMap && Array.isArray(previousMap.runs) ? [...previousMap.runs] : [];
  if (!args.guardRun) runs.push({ head, at: startedAt, ran: entries.length, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6) });
  const runsSinceCommit = head ? runs.filter(item => item.head === head).length : 0;
  const runLine = runsSinceCommit ? `Check run ${runsSinceCommit} since the last commit${runsSinceCommit > 1 ? ' — run checks once, after the last edit, before committing' : ''}.` : null;
  writeMap({ manifestPath, startedAt, snapshot: snapshot.serialize(), records, ids: expanded.map(entry => entry.id), runs: runs.slice(-RUN_LOG_LIMIT) });
  if (failedIds.size) console.error(`[VERIFY] ${failedIds.size} failed check(s) will run again on the next --changed: ${[...failedIds].join(', ')}`);
  if (traceDir) { try { fs.rmSync(traceDir, { recursive: true, force: true }); } catch (_) {} }
  if (plan) {
    plan.full = plan.selected.length === total && total > 0;
    plan.reason = summaryReason(plan, planned);
  }
  // Checks that ran and still have no known inputs (a non-Node check without `inputs`, a
  // Node check whose trace saw no project file, or one that starts a program the trace
  // cannot follow — named in brackets).
  const unknownRan = results.filter(result => result && !result.reused && !result.coveredBy && result.status !== 'NOT_RUN'
    && records[result.id] && records[result.id].kind === 'project')
    .map(result => `${result.id}${Array.isArray(records[result.id].incomplete) ? ` (${records[result.id].incomplete.join('; ')})` : ''}`);
  if (unknownRan.length) notices.push(`Unknown inputs (whole project used): ${unknownRan.join(', ')} — declare "inputs" in the manifest so they run only when their files change. Files git ignores are not watched; declare them in "inputs" if a check reads them.`);
  // D143_T017: a check that read a file of Crabshell's own state reruns whenever that state
  // changes; the file stays its input, and the check is named (its first such file).
  const isState = crabshellState({ projectRoot, layout });
  for (const result of results) {
    if (!result || result.reused || result.coveredBy || result.status === 'NOT_RUN' || !records[result.id]) continue;
    const stateFile = (records[result.id].files || []).find(file => !file.endsWith('/') && isState(file));
    if (stateFile) notices.push(`${result.id} read Crabshell state ${stateFile} — give it a temporary project so the state does not rerun it.`);
  }
  // D151_T004: a changed test that ran and holds its inputs' text word for word is named.
  const ranTests = results.filter(result => result && !result.reused && !result.coveredBy && result.status !== 'NOT_RUN'
    && records[result.id] && records[result.id].test).map(result => result.id);
  if (ranTests.length) {
    notices.push(...copyNotices({ ran: ranTests, records, changed: snapshot.changedFiles(), minChars: manifest.copyLiteralMinChars,
      read: file => fs.readFileSync(path.join(projectRoot, file), 'utf8') }));
  }
  if (blockedBy.size) {
    const files = [...blockedBy].sort();
    notices.push(`Inputs written while checks ran (their passes were not recorded): ${files.slice(0, 5).join(', ')}${files.length > 5 ? `, … (${files.length})` : ''} — if a check writes them, declare them in its "outputs".`);
  }
  results.push(...failBefore);
  return printResults(results, { args, started, resultsPath: layout.resultsPath, plan, selected: entries.length, failBefore, stoppedAt, notRun, stillFailing, notices, runLine });
  };
  return then(scheduled, conclude);
}

// "N with changed inputs, M new, …; R reused" for the summary line.
function summaryReason(plan, planned) {
  const groups = new Map();
  for (const id of plan.selected) {
    const group = reasonGroup(planned.reasons[id] || 'requested');
    groups.set(group, (groups.get(group) || 0) + 1);
  }
  const parts = [...groups].map(([group, count]) => `${count} ${group}`);
  const reused = planned.reused.length;
  const none = plan.leftOut ? `${plan.leftOut} left out` : 'nothing changed';
  return `${parts.length ? parts.join(', ') : none}${reused ? `; ${reused} reused` : ''}`;
}

module.exports = { main };
