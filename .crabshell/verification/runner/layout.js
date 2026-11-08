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
// The runner code that can change a check's result (D152 P6): how it runs (execute), how it
// is judged (contract), and what turns a failure into a pass (recheck) — whole modules — and
// the parts of other modules that shape the checked process: the tracer loaded into it and
// the environment it gets (trace.js), the report variable and the case arguments
// (used-report.js); their source text is hashed, the rest of those modules is not. The code
// that records and compares inputs (fingerprint, snapshot, manifest, select, the rest of
// trace and used-report), output and the launcher are not here, so editing them reruns
// nothing; a change that makes the runner record more of what a check reads bumps
// fingerprint.js SCHEMA_VERSION instead.
const DECISION_MODULES = ['contract.js', 'execute.js', 'recheck.js'];
const DECISION_PARTS = [['trace.js', 'TRACER_SOURCE'], ['trace.js', 'traceEnvironment'], ['used-report.js', 'REPORT_ENV'], ['used-report.js', 'expandCases']];
// The files whose change can rerun every check (for --replay, which sees only file names).
const DECISION_FILES = [...new Set([...DECISION_MODULES, ...DECISION_PARTS.map(([module]) => module)])];

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
  // One hash over the code that decides results (the modules' names and code text, and the
  // parts' source text): a release that only changes their comments does not rerun every
  // check (D143_T020).
  const decisionHash = () => {
    const hash = crypto.createHash('sha256');
    const add = (name, read) => {
      hash.update(name);
      hash.update('\0');
      try { hash.update(codeText(read())); } catch (_) { hash.update('MISSING'); }
      hash.update('\0');
    };
    for (const name of DECISION_MODULES) add(name, () => fs.readFileSync(path.join(moduleDir, name), 'utf8'));
    for (const [module, name] of DECISION_PARTS) add(`${module} ${name}`, () => partSource(moduleDir, module, name));
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

// The source text of one decision part: a function's code, or a string constant's value.
function partSource(moduleDir, module, name) {
  const value = require(path.join(moduleDir, module))[name];
  if (typeof value === 'function') return value.toString();
  if (typeof value === 'string') return value;
  throw new Error(`${module} exports no ${name}`);
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

module.exports = { runnerLayout, codeText, LAUNCHER_FILE, MODULE_DIR, RESULTS_FILE, DECISION_MODULES, DECISION_PARTS, DECISION_FILES, STORAGE_FOLDER, partSource };
