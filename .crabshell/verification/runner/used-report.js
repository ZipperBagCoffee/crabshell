'use strict';
// D152: what a check used, as the check itself reports it (Ninja's depfile: the program that
// ran knows what it used). The runner gives every check the path of a report file in the
// environment variable REPORT_ENV (child processes inherit it); a program in any language
// appends lines to that file. The runner reads it after the run. The manifest's
// `itemIdentity` command answers in the same line form.
//
// A line is fields separated by TAB. Inside a field, '%', TAB, CR and LF are written %25,
// %09, %0D and %0A. A path is relative to the project root ('/' or '\' between folders) and
// names a file or folder that is there.
//   file   <path> [<case>]                      used the whole file; a path that ends in '/'
//                                               or names a folder used its list of names
//   item   <path> <item> <fingerprint> [<case>]  used one item of a file; an empty
//                                               fingerprint: looked the item up, found none
//   rest   <path> [<case>]                      used only the file's part outside its items,
//                                               such as code that runs when the file loads (D163)
//   result <case> pass|fail                    how one case of a `{cases}` entry ended
//   begin  <writer>                             a process starts writing (when several write)
//   done   [<writer>]                           a process finished: the last line it writes
// A report is complete when its last line is `done`, each writer name has as many `done`
// lines as `begin` lines, and it names at least one use or result.
// itemIdentity prints, for every file it is given:
//   item   <path> <item> <fingerprint>          every item of the file
//   rest   <path> <fingerprint>                 everything in the file outside its items

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { toPosix, resolveInside, RUNNER_NODE } = require('./manifest');

const REPORT_ENV = 'CRABSHELL_USED_REPORT';
const CASES_PLACEHOLDER = '{cases}';
// The fingerprint of an item that is not there.
const NO_ITEM = '';
// Inside the runner an item is one input key: its file's path and its name joined by a
// character no path holds. The empty name stands for the file's rest outside its items.
const ITEM_SEPARATOR = '\u0000';
const IDENTITY_TIMEOUT_MS = 60000;
// Arguments per itemIdentity call stay under the command-line limit of every platform.
const IDENTITY_ARGS_CHARS = 24000;

const itemKey = (file, item) => `${file}${ITEM_SEPARATOR}${item}`;
const restKey = file => itemKey(file, '');
const isItemKey = key => key.includes(ITEM_SEPARATOR);
const pathOf = key => (isItemKey(key) ? key.slice(0, key.indexOf(ITEM_SEPARATOR)) : key);
const itemOf = key => (isItemKey(key) ? key.slice(key.indexOf(ITEM_SEPARATOR) + 1) : null);
// A key as a person reads it, in a reason line.
function describeKey(key) {
  const item = itemOf(key);
  if (item === null) return key;
  return item === '' ? `${pathOf(key)} (outside its items)` : `${pathOf(key)} (item ${item})`;
}

function escapeField(value) {
  return String(value).replace(/%/g, '%25').replace(/\t/g, '%09').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
// The field's text, or null when a '%' is not followed by two hex digits or the text holds
// the item separator (no path, item or case name can).
function unescapeField(field) {
  if (/%(?![0-9A-Fa-f]{2})/.test(field)) return null;
  const text = field.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return text.includes(ITEM_SEPARATOR) ? null : text;
}
// One report line from its fields (for checks written in JavaScript, and for tests).
const formatLine = fields => fields.map(escapeField).join('\t');

function splitLines(text) {
  return String(text).split(/\r?\n/).filter(line => line.trim() !== '');
}

// A reported path as an input key: the project-relative file, or "folder/". Null when it
// is not inside the project (or names the project itself, or git's own data), or when
// `exists(key, absolute)` is given and says no — a check cannot have used a file that is not
// there (a record it looked up and did not find is an item line; a file it did not find,
// its folder).
function projectPath(projectRoot, value, exists = null) {
  if (!value) return null;
  let absolute;
  try {
    absolute = path.isAbsolute(value) ? path.resolve(value) : resolveInside(projectRoot, toPosix(value), 'report path');
  } catch (_) { return null; }
  const relative = toPosix(path.relative(path.resolve(projectRoot), absolute));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split('/').includes('.git')) return null;
  let folder = /[\\/]$/.test(value);
  if (!folder) { try { folder = fs.statSync(absolute).isDirectory(); } catch (_) {} }
  const key = folder ? `${relative}/` : relative;
  return !exists || exists(key, absolute) ? key : null;
}

// A check's report: null when it wrote none; { problem } when it is broken (then the check
// is chosen as if it had not reported); otherwise every use (path, item or null,
// fingerprint, case or null) and each case's result. inSnapshot(key): whether the runner's
// look before the run held the file or folder (one the check removed still counts as there).
function readReport(file, projectRoot, inSnapshot = () => false) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  const lines = splitLines(text);
  if (lines.length === 0) return { problem: 'the report is empty' };
  const exists = (key, absolute) => {
    if (inSnapshot(key)) return true;
    try { return fs.statSync(absolute).isDirectory() === key.endsWith('/'); } catch (_) { return false; }
  };
  const uses = [];
  const results = new Map();
  // How many times each writer began and finished.
  const begun = new Map();
  const finished = new Map();
  const count = (map, writer) => map.set(writer, (map.get(writer) || 0) + 1);
  for (const line of lines) {
    const fields = line.split('\t').map(unescapeField);
    if (fields.some(field => field === null)) return { problem: `a field has a bad % escape or holds the item separator: ${line}` };
    const [kind, ...rest] = fields;
    if (kind === 'begin' && rest.length === 1 && rest[0]) { count(begun, rest[0]); continue; }
    if (kind === 'done' && rest.length <= 1) { count(finished, rest[0] || ''); continue; }
    if (kind === 'result' && rest.length === 2 && rest[0] && (rest[1] === 'pass' || rest[1] === 'fail')) {
      // A case that failed once in this run stays failed.
      if (results.get(rest[0]) !== 'fail') results.set(rest[0], rest[1]);
      continue;
    }
    if (kind === 'file' && (rest.length === 1 || rest.length === 2)) {
      const key = projectPath(projectRoot, rest[0], exists);
      if (!key) return { problem: `not a file or folder of the project: ${rest[0]}` };
      uses.push({ path: key, item: null, fingerprint: null, case: rest[1] || null });
      continue;
    }
    if (kind === 'rest' && (rest.length === 1 || rest.length === 2)) {
      const key = projectPath(projectRoot, rest[0], exists);
      if (!key || key.endsWith('/')) return { problem: `not a file of the project: ${rest[0]}` };
      uses.push({ path: key, item: '', fingerprint: undefined, case: rest[1] || null });
      continue;
    }
    if (kind === 'item' && (rest.length === 3 || rest.length === 4) && rest[1]) {
      const key = projectPath(projectRoot, rest[0], exists);
      if (!key || key.endsWith('/')) return { problem: `not a file of the project: ${rest[0]}` };
      uses.push({ path: key, item: rest[1], fingerprint: rest[2], case: rest[3] || null });
      continue;
    }
    return { problem: `not a report line: ${line}` };
  }
  if (!/^done(\t|$)/.test(lines[lines.length - 1])) return { problem: 'the last line is not done (a writer did not finish)' };
  const unfinished = [...begun].find(([writer, times]) => (finished.get(writer) || 0) < times);
  if (unfinished) return { problem: `writer ${unfinished[0]} began ${unfinished[1]} time(s) and finished fewer` };
  // A report that names nothing the check used says nothing it could be chosen by.
  if (uses.length === 0 && results.size === 0) return { problem: 'the report names nothing the check used' };
  return { uses, results };
}

// What `itemIdentity` prints: for each file, its items' fingerprints and its rest (null when
// the command printed no rest for it). Files the command was given and did not mention get
// no items and no rest.
function parseIdentity(stdout, projectRoot, files) {
  const facts = new Map(files.map(file => [file, { items: new Map(), rest: null }]));
  for (const line of splitLines(stdout)) {
    const fields = line.split('\t').map(unescapeField);
    if (fields.some(field => field === null)) continue;
    const [kind, rawPath, ...rest] = fields;
    const file = projectPath(projectRoot, rawPath || '');
    if (!file || !facts.has(file)) continue;
    if (kind === 'item' && rest.length === 2 && rest[0]) facts.get(file).items.set(rest[0], rest[1]);
    else if (kind === 'rest' && rest.length === 1) facts.get(file).rest = rest[0];
  }
  return facts;
}

// Runs the manifest's itemIdentity command { file, args, timeout? } over `files` (in groups
// that fit a command line) from the project root. A group whose command does not exit 0
// gives nothing for its files.
function runItemIdentity(command, projectRoot, files) {
  const answers = new Map();
  if (!command || typeof command.file !== 'string' || !Array.isArray(command.args) || files.length === 0) return answers;
  let executable;
  if (command.file === RUNNER_NODE) executable = process.execPath;
  else if (/[\\/]/.test(command.file)) {
    try { executable = resolveInside(projectRoot, command.file, 'itemIdentity.file'); } catch (_) { return answers; }
  } else executable = command.file;
  const groups = [[]];
  let length = 0;
  for (const file of files) {
    if (groups[groups.length - 1].length && length + file.length + 1 > IDENTITY_ARGS_CHARS) { groups.push([]); length = 0; }
    groups[groups.length - 1].push(file);
    length += file.length + 1;
  }
  for (const group of groups) {
    const result = spawnSync(executable, [...command.args, ...group], {
      cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 256 << 20,
      timeout: Number.isFinite(command.timeout) ? command.timeout : IDENTITY_TIMEOUT_MS,
      env: { ...process.env, PROJECT_ROOT: projectRoot, CLAUDE_PROJECT_DIR: projectRoot },
    });
    if (result.status !== 0 || result.error) continue;
    for (const [file, facts] of parseIdentity(result.stdout, projectRoot, group)) answers.set(file, facts);
  }
  return answers;
}

// An entry whose command takes the cases to run.
const hasCases = entry => Boolean(entry && entry.command && Array.isArray(entry.command.args) && entry.command.args.includes(CASES_PLACEHOLDER));
// The command's arguments with `{cases}` replaced by the cases to run, or dropped (every case).
function expandCases(args, cases) {
  return args.flatMap(arg => (arg === CASES_PLACEHOLDER ? (Array.isArray(cases) ? cases : []) : [arg]));
}

module.exports = {
  REPORT_ENV, CASES_PLACEHOLDER, NO_ITEM, ITEM_SEPARATOR,
  itemKey, restKey, isItemKey, pathOf, itemOf, describeKey,
  escapeField, unescapeField, formatLine, readReport, parseIdentity, runItemIdentity, hasCases, expandCases,
};
