'use strict';
// D151: what a routine run would have cost on past commits, from the records alone — nothing is
// executed. For each of the last N commits, the files it changed (git) are matched with each
// check's recorded inputs: a check runs when it has no record yet, when its inputs are unknown
// (it reads the whole project), when its recorded or declared inputs include a changed file, or
// when a module that decides results changed. A commit's file list cannot tell which items of
// a file changed, so an item a check reported stands for its file (D152). Heavy checks stay
// out, as in --changed. The time is the run's length with the chosen checks started side by side within `jobs` (their median
// pass times), plus the checks that run alone, one after another.

const { spawnSync } = require('child_process');
const { inputPatterns, matchesInput, medianDuration, isSlow, inputsUnknown, reportScope, inScope } = require('./select');
const { pathOf } = require('./used-report');

// The files each of the last `count` commits changed, newest first, and which of them it
// added or deleted (a folder that is only listed changes when its names change).
function commitChanges(projectRoot, count) {
  const marker = '@@commit ';
  const result = spawnSync('git', ['log', `-n${count}`, `--format=${marker}%h %s`, '--name-status', '--no-renames'],
    { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git log failed: ${(result.stderr || result.error || '').toString().trim()}`);
  const commits = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith(marker)) {
      const text = line.slice(marker.length);
      const space = text.indexOf(' ');
      commits.push({ commit: text.slice(0, space), subject: text.slice(space + 1), files: [], namesChanged: [] });
    } else if (line.trim() && commits.length) {
      const [status, ...rest] = line.trim().split('\t');
      const file = rest.join('\t').replace(/\\/g, '/');
      if (!file) continue;
      commits[commits.length - 1].files.push(file);
      if (/^[AD]/.test(status)) commits[commits.length - 1].namesChanged.push(file);
    }
  }
  return commits;
}

// namesChanged: the changed files that were added or deleted. A record made since D151_T007
// (folders: 'names') holds a folder it only listed for its names and lists the files of a
// folder it copied; an older record's folder stands for every file under it.
function wouldRun(entry, record, changed, namesChanged = changed) {
  if (!record) return true;
  if (inputsUnknown(record)) return changed.length > 0;
  const files = new Set(Array.isArray(record.files) ? record.files.map(pathOf) : []);
  if (record.test) files.add(record.test);
  // A report decides inside its scope: there only what it named counts; outside it, what the
  // check declared — or, with no other inputs known, every file.
  const scope = record.kind === 'reported' ? reportScope(entry) : null;
  if (scope && record.base === 'project' && changed.some(file => !inScope(scope, file))) return true;
  const declared = inputPatterns(entry);
  const namesOnly = record.folders === 'names';
  const parent = file => file.slice(0, file.lastIndexOf('/') + 1);
  const inFolder = file => [...files].some(input => input.endsWith('/')
    && (namesOnly ? namesChanged.includes(file) && parent(file) === input : file.startsWith(input)));
  return changed.some(file => files.has(file) || inFolder(file)
    || (declared.some(pattern => matchesInput(pattern, file)) && !(scope && inScope(scope, file))));
}

// Longest first onto `jobs` lanes; the run lasts as long as its busiest lane, then the checks
// that run alone follow one after another.
function runLength(sideBySideMs, aloneMs, jobs) {
  const lanes = new Array(Math.max(1, jobs)).fill(0);
  for (const ms of [...sideBySideMs].sort((a, b) => b - a)) {
    let least = 0;
    for (let lane = 1; lane < lanes.length; lane++) if (lanes[lane] < lanes[least]) least = lane;
    lanes[least] += ms;
  }
  return Math.max(...lanes) + aloneMs.reduce((sum, ms) => sum + ms, 0);
}

// entries: the expanded, runnable checks; records: test-map entries; decisionFiles: repo paths
// whose change reruns every check; isExclusive(entry): runs alone.
function replay({ commits, entries, records, manifest, jobs, isExclusive, decisionFiles = [] }) {
  const decision = new Set(decisionFiles);
  return commits.map(({ commit, subject, files, namesChanged }) => {
    const all = files.some(file => decision.has(file));
    const chosen = entries.filter(entry => all || wouldRun(entry, records[entry.id], files, namesChanged));
    const heavy = chosen.filter(entry => isSlow(entry, records[entry.id], manifest));
    const run = chosen.filter(entry => !heavy.includes(entry));
    const time = entry => { const ms = medianDuration(records[entry.id]); return Number.isFinite(ms) ? ms : 0; };
    const unknown = run.filter(entry => !Number.isFinite(medianDuration(records[entry.id]))).length;
    const ms = runLength(run.filter(entry => !isExclusive(entry)).map(time), run.filter(isExclusive).map(time), jobs);
    return { commit, subject, changed: files.length, selected: run.length, heavyLeftOut: heavy.length, unknownTimes: unknown, estimatedMs: Math.round(ms), everyCheck: all };
  });
}

// One line per commit, newest first, then the median and the longest estimate.
function replayLines(rows, jobs) {
  const seconds = ms => `${Math.round(ms / 1000)}s`;
  const lines = rows.map(row => `${row.commit}  ${row.selected} checks, ~${seconds(row.estimatedMs)}`
    + `${row.heavyLeftOut ? `, ${row.heavyLeftOut} heavy left out` : ''}${row.everyCheck ? ' (runner decision code changed: every check)' : ''}`
    + `${row.unknownTimes ? `, ${row.unknownTimes} without a recorded time` : ''}  ${row.subject}`);
  const times = rows.map(row => row.estimatedMs).sort((a, b) => a - b);
  if (times.length) {
    lines.push(`Estimated from the records, ${jobs} side by side: median ~${seconds(times[Math.floor(times.length / 2)])}, longest ~${seconds(times[times.length - 1])} per commit over ${rows.length} commits. Nothing was run.`);
  }
  return lines;
}

module.exports = { commitChanges, wouldRun, runLength, replay, replayLines };
