'use strict';
// A check's fingerprint (D143): everything that can change its result — the fields of
// its entry that decide the run, the program that runs it, the runner modules that
// judge it, the platform, and the content of every input file. A check runs again only
// when its fingerprint is not among the ones it passed with.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { RUNNER_NODE, resolveInside, toPosix } = require('./manifest');

// Bump when the meaning of a fingerprint or a record changes: records of another
// schema count as missing, so every check runs once.
const SCHEMA_VERSION = 3;

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizedJson(value) {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalizedJson(value[key])]));
  }
  return value;
}

// Only the entry fields that decide what runs and how it is judged; names, notes,
// selection hints (inputs, slow) and reuse settings do not change a result.
function resultFields(entry) {
  return normalizedJson({
    type: entry.type,
    command: entry.command || null,
    contract: entry.contract || null,
    timeout: entry.timeout === undefined ? null : entry.timeout,
  });
}

const executableCache = new Map();
// The file a bare command name runs: the first PATH folder that holds it (on Windows
// also with each PATHEXT extension). Null when it is not found.
function findExecutable(name) {
  if (executableCache.has(name)) return executableCache.get(name);
  const folders = String(process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? ['', ...String(process.env.PATHEXT || '').split(';').filter(Boolean)]
    : [''];
  let found = null;
  for (const folder of folders) {
    for (const extension of extensions) {
      const candidate = path.join(folder, name + extension);
      try { if (fs.statSync(candidate).isFile()) { found = candidate; break; } } catch (_) {}
    }
    if (found) break;
  }
  executableCache.set(name, found);
  return found;
}

const programName = file => path.basename(String(file || '')).replace(/\.[^.]+$/, '').toLowerCase();

const samePath = (a, b) => process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b);

// True when a command runs on the runner's own Node: the manifest alias, or a bare name
// that finds that very executable on PATH ("node.exe" here). Another Node install is a
// different program (another version may give another result).
function runsOnRunnerNode(command) {
  if (!command || typeof command.file !== 'string') return false;
  if (command.file === RUNNER_NODE) return true;
  if (/[\\/]/.test(command.file)) return false;
  const found = findExecutable(command.file);
  return Boolean(found) && samePath(found, process.execPath);
}

// Which program runs the check. `node` is the runner's own Node; a command with a path
// is a project file (its content is an input: `file`); a bare name is the executable
// found on PATH, identified by its path, size and modification time.
function programIdentity(command, projectRoot) {
  if (!command || typeof command.file !== 'string') return { id: 'none' };
  if (runsOnRunnerNode(command)) return { id: `node ${process.version} ${process.execPath}` };
  if (/[\\/]/.test(command.file) || command.file.startsWith('.')) {
    try {
      const absolute = resolveInside(projectRoot, command.file, 'command.file');
      const file = toPosix(path.relative(projectRoot, absolute));
      return { id: `project ${file}`, file };
    } catch (_) { return { id: `unresolved ${command.file}` }; }
  }
  const found = findExecutable(command.file);
  if (!found) return { id: `unresolved ${command.file}` };
  try {
    const stat = fs.statSync(found);
    return { id: `${found} ${stat.size} ${stat.mtimeMs}` };
  } catch (_) { return { id: found }; }
}

// identityOf(file) gives a file's (or "folder/"'s) content identity; `project` is the
// whole project's identity for a check whose inputs are unknown (null otherwise).
function entryFingerprint({ entry, files, identityOf, program, decision, project = null }) {
  const inputs = [...new Set(files.map(toPosix))].sort();
  return hashBuffer(JSON.stringify([
    SCHEMA_VERSION, resultFields(entry), program, decision, process.platform, process.arch,
    inputs.map(file => [file, identityOf(file)]), project,
  ]));
}

module.exports = { SCHEMA_VERSION, hashBuffer, normalizedJson, resultFields, findExecutable, programName, runsOnRunnerNode, programIdentity, entryFingerprint };
