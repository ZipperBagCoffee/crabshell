'use strict';
// Where the runner lives and what it derives from that place. The launcher
// (run-verify.js) sits beside the manifest; its modules sit in runner/ next to it.
// Every location the runner uses comes from here, never from a module's own folder.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LAUNCHER_FILE = 'run-verify.js';
const MODULE_DIR = 'runner';
const RESULTS_FILE = 'last-run.json';
// Crabshell's own storage folder, which holds the verification folder (as git's is .git).
const STORAGE_FOLDER = '.crabshell';
// The runner's own modules that decide a check's result: how it runs (execute, trace —
// the tracer is loaded into the checked process), how it is judged (contract), what an
// entry means (manifest) and what counts as the same input (fingerprint, snapshot).
// Output, records, selection and the launcher do not change a result, so editing them
// reruns nothing.
const DECISION_MODULES = ['contract.js', 'execute.js', 'fingerprint.js', 'manifest.js', 'snapshot.js', 'trace.js'];

function runnerLayout(launcherDir) {
  const dir = path.resolve(launcherDir);
  const moduleDir = path.join(dir, MODULE_DIR);
  // The launcher and every module file, in a fixed order.
  const runnerFiles = () => {
    let modules = [];
    try {
      modules = fs.readdirSync(moduleDir).filter(name => name.endsWith('.js')).sort().map(name => path.join(moduleDir, name));
    } catch (_) {}
    return [path.join(dir, LAUNCHER_FILE), ...modules];
  };
  // One hash over every runner file's name and content: a change to any of them is a
  // change to the runner.
  const runnerHash = () => {
    const hash = crypto.createHash('sha256');
    for (const file of runnerFiles()) {
      hash.update(path.relative(dir, file).replace(/\\/g, '/'));
      hash.update('\0');
      try { hash.update(fs.readFileSync(file)); } catch (_) { hash.update('MISSING'); }
      hash.update('\0');
    }
    return hash.digest('hex');
  };
  // One hash over the modules that decide results (their names and code text): a release
  // that only changes their comments does not rerun every check (D143_T020).
  const decisionHash = () => {
    const hash = crypto.createHash('sha256');
    for (const name of DECISION_MODULES) {
      hash.update(name);
      hash.update('\0');
      try { hash.update(codeText(fs.readFileSync(path.join(moduleDir, name), 'utf8'))); } catch (_) { hash.update('MISSING'); }
      hash.update('\0');
    }
    return hash.digest('hex');
  };
  return {
    launcherDir: dir,
    launcherFile: path.join(dir, LAUNCHER_FILE),
    moduleDir,
    manifestPath: path.join(dir, 'manifest.json'),
    resultsPath: path.join(dir, RESULTS_FILE),
    defaultProjectRoot: path.resolve(dir, '../..'),
    // The storage folder around the verification folder, or null when the launcher sits
    // anywhere else (then nothing beyond the runner's own files counts as Crabshell's).
    storageDir: path.basename(path.dirname(dir)) === STORAGE_FOLDER ? path.dirname(dir) : null,
    runnerFiles,
    runnerHash,
    decisionHash,
  };
}

// A module's code without the lines that cannot change what it does: lines that are only
// a `//` comment, `/* … */` blocks that start a line (a closing line with code after the
// `*/` stays), blank lines, and trailing spaces. Lines inside a template literal stay as
// they are. Whole lines only — a code line that changes by one character still counts.
function codeText(text) {
  const kept = [];
  let inTemplate = false;
  let inBlock = false;
  const toggles = line => (line.replace(/\\[\s\S]/g, '').match(/`/g) || []).length % 2 === 1;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (inTemplate) {
      kept.push(line);
      if (toggles(line)) inTemplate = false;
      continue;
    }
    const trimmed = line.trim();
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) continue;
      inBlock = false;
      if (line.slice(end + 2).trim()) kept.push(line);
      continue;
    }
    if (!trimmed || trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('/*')) {
      const end = trimmed.indexOf('*/', 2);
      if (end < 0) { inBlock = true; continue; }
      if (!trimmed.slice(end + 2).trim()) continue;
    }
    kept.push(line);
    if (toggles(line)) inTemplate = true;
  }
  return kept.join('\n');
}

module.exports = { runnerLayout, codeText, LAUNCHER_FILE, MODULE_DIR, RESULTS_FILE, DECISION_MODULES, STORAGE_FOLDER };
