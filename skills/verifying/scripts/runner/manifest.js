'use strict';
// The manifest: path checks, entry validation and discovery of one entry per file.

const fs = require('fs');
const path = require('path');

const toPosix = value => value.replace(/\\/g, '/');

// In a manifest, command.file "node" means the runner's own Node (its process.execPath).
const RUNNER_NODE = 'node';

// Any absolute path: POSIX root, Windows drive or UNC share, or a home-relative path.
function isAbsolutePath(value) {
  return typeof value === 'string' && (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value) || /^~[\\/]/.test(value));
}

const topFolders = new Map();
// A string that names a place on this machine: a drive, UNC or home path, or a POSIX
// absolute path whose first folder exists here. Free text such as a URL path
// ("/api/v1") or a pattern ("/^PASS/") does not.
function looksMachineAbsolute(value) {
  if (typeof value !== 'string') return false;
  if (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value) || /^~[\\/]/.test(value)) return true;
  const match = value.match(/^\/([^/\\]+)(?:[/\\]|$)/);
  if (!match) return false;
  if (!topFolders.has(match[1])) {
    let exists = false;
    try { exists = fs.statSync(path.join(path.parse(process.cwd()).root, match[1])).isDirectory(); } catch (_) {}
    topFolders.set(match[1], exists);
  }
  return topFolders.get(match[1]);
}

function resolveInside(projectRoot, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error(`${label} must be a non-empty repo-relative path`);
  }
  if (isAbsolutePath(relativePath)) {
    throw new Error(`${label} must be repo-relative: ${relativePath}`);
  }
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, relativePath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error(`${label} escapes project root: ${relativePath}`);
  }
  return resolved;
}

function validatePortableStrings(value, label) {
  if (typeof value === 'string') {
    if (looksMachineAbsolute(value)) throw new Error(`${label} contains a machine-specific absolute path: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validatePortableStrings(item, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) validatePortableStrings(item, `${label}.${key}`);
  }
}

function validateStdoutAssertions(assertions, label) {
  for (const assertion of Array.isArray(assertions) ? assertions : []) {
    if (!assertion || assertion.kind !== 'stdoutMatches') continue;
    if (typeof assertion.pattern !== 'string' || (assertion.flags !== undefined && typeof assertion.flags !== 'string')) {
      throw new Error(`${label}: stdoutMatches requires a string pattern and optional string flags`);
    }
    try { new RegExp(assertion.pattern, assertion.flags); }
    catch (error) { throw new Error(`${label}: invalid stdoutMatches regex: ${error.message}`); }
  }
}

// A field that holds repo-relative paths: any absolute path is machine-specific.
function validateRelativePaths(values, label) {
  for (const [index, value] of (Array.isArray(values) ? values : [values]).entries()) {
    if (isAbsolutePath(value)) throw new Error(`${label}[${index}] must be repo-relative: ${value}`);
  }
}

// The optional settings of an entry, each with the kind of value it takes (the manifest's
// own run settings are in settings.js: they decide no result, so a new one does not change
// the runner identity this module is part of). Validation reads these tables, and the
// verifying skill must document every name in them (D145_T002), so a new setting is added
// in one place.
const SETTING_KINDS = {
  paths: { message: 'must be an array of repo-relative paths, folders or globs', valid: value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0) },
  names: { message: 'must be an array of non-empty names', valid: value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0) },
  count: { message: 'must be a positive whole number', valid: value => Number.isInteger(value) && value >= 1 },
  whole: { message: 'must be a whole number (0 or more)', valid: value => Number.isInteger(value) && value >= 0 },
  seconds: { message: 'must be a positive number', valid: value => typeof value === 'number' && value > 0 },
  share: { message: 'must be a number above 0 and at most 1', valid: value => typeof value === 'number' && value > 0 && value <= 1 },
  flag: { message: 'must be true or false', valid: value => typeof value === 'boolean' },
  name: { message: 'must be a non-empty name', valid: value => typeof value === 'string' && value.length > 0 },
  // Read by the runner and documented, with checks of their own elsewhere.
  other: { message: '', valid: () => true },
};
const ENTRY_SETTINGS = {
  inputs: 'paths', outputs: 'paths', slow: 'flag', exclusive: 'flag', group: 'name',
  reuse: 'other', always: 'other', coveredBy: 'other', reuseExclude: 'other', timeout: 'other',
};

// label: "manifest" or "<entry id>:"; pathLabel: the prefix of a path field's own checks.
function validateSettings(object, settings, label, pathLabel) {
  for (const [field, kind] of Object.entries(settings)) {
    if (object[field] === undefined) continue;
    if (!SETTING_KINDS[kind].valid(object[field])) throw new Error(`${label} ${field} ${SETTING_KINDS[kind].message}`);
    if (kind === 'paths') validateRelativePaths(object[field], `${pathLabel}.${field}`);
  }
}

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('entry must be an object');
  if (!entry.id || typeof entry.id !== 'string') throw new Error('entry.id is required');
  if (!['behavioral', 'structural', 'manual'].includes(entry.type)) {
    throw new Error(`${entry.id}: type must be behavioral, structural, or manual`);
  }
  // inputs: files the check reads; outputs: files it writes (products, not inputs).
  validateSettings(entry, ENTRY_SETTINGS, `${entry.id}:`, entry.id);
  if (entry.type === 'manual') return;
  if (!entry.command || typeof entry.command !== 'object' || Array.isArray(entry.command)) {
    throw new Error(`${entry.id}: command must be an object with file and args`);
  }
  if (typeof entry.command.file !== 'string' || entry.command.file.length === 0) {
    throw new Error(`${entry.id}: command.file is required`);
  }
  if (isAbsolutePath(entry.command.file)) {
    throw new Error(`${entry.id}: command.file must be portable: ${entry.command.file}`);
  }
  if (!Array.isArray(entry.command.args) || !entry.command.args.every(arg => typeof arg === 'string')) {
    throw new Error(`${entry.id}: command.args must be a string array`);
  }
  if (entry.command.cwd !== undefined) validateRelativePaths(entry.command.cwd, `${entry.id}.command.cwd`);
  validatePortableStrings(entry.command, `${entry.id}.command`);
  validatePortableStrings(entry.contract, `${entry.id}.contract`);
  if (entry.contract && entry.contract.forbiddenChanges !== undefined) validateRelativePaths(entry.contract.forbiddenChanges, `${entry.id}.contract.forbiddenChanges`);
  for (const [index, assertion] of (entry.contract && Array.isArray(entry.contract.assertions) ? entry.contract.assertions : []).entries()) {
    for (const value of [assertion && assertion.path, assertion && assertion.actual && assertion.actual.path, assertion && assertion.expected && assertion.expected.path]) {
      if (value !== undefined) validateRelativePaths(value, `${entry.id}.contract.assertions[${index}].path`);
    }
  }
  if (!entry.contract || !Number.isInteger(entry.contract.exitCode)) {
    throw new Error(`${entry.id}: contract.exitCode is required`);
  }
  const assertions = Array.isArray(entry.contract.assertions) ? entry.contract.assertions : [];
  validateStdoutAssertions(assertions, entry.id);
  const forbidden = Array.isArray(entry.contract.forbiddenChanges) ? entry.contract.forbiddenChanges : [];
  if (entry.type === 'behavioral' && assertions.length === 0 && forbidden.length === 0) {
    throw new Error(`${entry.id}: behavioral contract requires an assertion or forbiddenChanges`);
  }
}

function globRegex(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') { source += '.*'; index++; if (pattern[index + 1] === '/') index++; }
    else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

// The repo file a command runs or checks: its first argument that is not a flag and
// names an existing project file, whatever the program; null when there is none.
function entryTestFile(entry, projectRoot) {
  if (!entry || !entry.command || !Array.isArray(entry.command.args)) return null;
  for (const arg of entry.command.args) {
    if (typeof arg !== 'string' || !arg || arg.startsWith('-')) continue;
    try {
      const resolved = resolveInside(projectRoot, arg, 'command.args');
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return toPosix(path.relative(projectRoot, resolved));
    } catch (_) {}
  }
  return null;
}

// Expand "discover" entries into one entry per matching file; explicit entries keep
// precedence, so a file run by its own entry is not discovered again.
function expandEntries(manifest, projectRoot) {
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const explicitFiles = new Set(entries.filter(entry => !entry.discover).map(entry => entryTestFile(entry, projectRoot)).filter(Boolean));
  const expanded = [];
  for (const entry of entries) {
    if (entry && entry.fileAssertions !== undefined && !entry.discover) {
      throw new Error(`${entry.id}: fileAssertions requires discover`);
    }
    if (!entry || !entry.discover) { expanded.push(entry); continue; }
    const rule = entry.discover;
    if (entry.reuseExclude !== undefined && (!Array.isArray(entry.reuseExclude)
      || entry.reuseExclude.some(file => typeof file !== 'string'))) {
      throw new Error(`${entry.id}: reuseExclude must be an array of relative file paths`);
    }
    const reuseExcluded = new Set((entry.reuseExclude || []).map(toPosix));
    if (entry.coveredBy !== undefined && (!entry.coveredBy || typeof entry.coveredBy !== 'object' || Array.isArray(entry.coveredBy))) {
      throw new Error(`${entry.id}: discover coveredBy must map relative file paths to check ids`);
    }
    const coverage = new Map(Object.entries(entry.coveredBy || {}).map(([file, id]) => {
      resolveInside(projectRoot, file, `${entry.id}.coveredBy`);
      return [toPosix(file), id];
    }));
    if (entry.fileAssertions !== undefined && (!entry.fileAssertions || typeof entry.fileAssertions !== 'object' || Array.isArray(entry.fileAssertions))) {
      throw new Error(`${entry.id}: fileAssertions must map relative file paths to assertion arrays`);
    }
    const fileAssertions = new Map();
    for (const [key, assertions] of Object.entries(entry.fileAssertions || {})) {
      const file = toPosix(key);
      resolveInside(projectRoot, file, `${entry.id}.fileAssertions`);
      if (!Array.isArray(assertions)) throw new Error(`${entry.id}: fileAssertions for ${key} must be an assertion array`);
      validateStdoutAssertions(assertions, `${entry.id}.fileAssertions ${key}`);
      fileAssertions.set(file, [...(fileAssertions.get(file) || []), ...assertions]);
    }
    const pattern = typeof rule.pattern === 'string' ? toPosix(rule.pattern) : '';
    const slash = pattern.lastIndexOf('/');
    const dir = slash >= 0 ? pattern.slice(0, slash) : '.';
    const name = slash >= 0 ? pattern.slice(slash + 1) : pattern;
    if (!pattern || /[*?]/.test(dir)) throw new Error(`${entry.id}: discover.pattern needs a literal folder and a file-name pattern: ${pattern}`);
    const excluded = new Map();
    for (const item of Array.isArray(rule.exclude) ? rule.exclude : []) {
      if (!item || typeof item.file !== 'string' || typeof item.reason !== 'string' || !item.reason.trim()) {
        throw new Error(`${entry.id}: every discover.exclude item needs a file and a reason`);
      }
      excluded.set(toPosix(item.file), item.reason);
    }
    const folder = resolveInside(projectRoot, dir, 'discover.pattern');
    const matcher = globRegex(name);
    const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter(file => matcher.test(file)).sort() : [];
    const discovered = files.map(file => toPosix(path.join(dir, file)).replace(/^\.\//, ''))
      .filter(file => !explicitFiles.has(file) && !excluded.has(file));
    for (const file of fileAssertions.keys()) {
      if (!discovered.includes(file)) throw new Error(`${entry.id}: fileAssertions file is not discovered: ${file}`);
    }
    if (discovered.length === 0) {
      expanded.push({ id: entry.id, type: entry.type, discoveryError: `discover pattern ${pattern} matched no files` });
      continue;
    }
    for (const file of discovered) {
      expanded.push({
        id: `${entry.id}:${file}`,
        ia: entry.ia,
        type: entry.type,
        command: rule.command && typeof rule.command.file === 'string' && Array.isArray(rule.command.args)
          ? { ...rule.command, args: rule.command.args.map(arg => arg === '{file}' ? file : arg) }
          : { file: RUNNER_NODE, args: [file] },
        contract: fileAssertions.has(file)
          ? { ...entry.contract, assertions: [...(entry.contract && entry.contract.assertions || []), ...fileAssertions.get(file)] }
          : entry.contract,
        timeout: entry.timeout,
        always: entry.always,
        ...(typeof entry.slow === 'boolean' ? { slow: entry.slow } : {}),
        ...(entry.exclusive === true ? { exclusive: true } : {}),
        ...(typeof entry.group === 'string' ? { group: entry.group } : {}),
        ...(Array.isArray(entry.inputs) ? { inputs: entry.inputs } : {}),
        ...(Array.isArray(entry.outputs) ? { outputs: entry.outputs } : {}),
        reuse: reuseExcluded.has(file) ? false : entry.reuse,
        discoveredBy: entry.id,
        ...(coverage.has(file) ? { coveredBy: coverage.get(file) } : {}),
      });
    }
  }
  const byId = new Map(expanded.map(entry => [entry.id, entry]));
  // Reject malformed output patterns even on unselected entries, before any command.
  for (const entry of expanded) validateStdoutAssertions(entry.contract && entry.contract.assertions, entry.id);
  // Validate even references for excluded discovery files: a typo must not
  // silently turn into a passing, skipped check when that file is later included.
  for (const entry of entries) {
    const targets = entry.discover ? Object.entries(entry.coveredBy || {}).map(([file, id]) => [`${entry.id}:${toPosix(file)}`, id])
      : entry.coveredBy === undefined ? [] : [[entry.id, entry.coveredBy]];
    for (const [childId, id] of targets) {
      if (typeof id !== 'string' || !id.trim()) throw new Error(`${childId}: coveredBy must name a check id`);
      if (!byId.has(id)) throw new Error(`${childId}: unknown coveredBy check id ${id}`);
      const contract = (byId.get(childId) || entry).contract || {};
      const coveringContract = byId.get(id).contract || {};
      if ((contract.assertions || []).length > 0) {
        throw new Error(`${childId}: coveredBy ${id} cannot preserve the child's contract.assertions`);
      }
      const coveringForbidden = new Set(coveringContract.forbiddenChanges || []);
      if ((contract.forbiddenChanges || []).some(file => !coveringForbidden.has(file))) {
        throw new Error(`${childId}: contract.forbiddenChanges must be a subset of coveredBy ${id}'s contract.forbiddenChanges`);
      }
    }
  }
  const visited = new Set();
  const visiting = new Set();
  const visit = entry => {
    if (visiting.has(entry.id)) throw new Error(`${entry.id}: coveredBy cycle`);
    if (visited.has(entry.id)) return;
    visiting.add(entry.id);
    if (entry.coveredBy !== undefined) visit(byId.get(entry.coveredBy));
    visiting.delete(entry.id);
    visited.add(entry.id);
  };
  expanded.forEach(visit);
  return expanded;
}

function selectEntries(manifest, targetId) {
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  return targetId ? entries.filter(entry => entry.id === targetId) : entries.filter(entry => entry.type !== 'manual');
}

module.exports = {
  RUNNER_NODE, toPosix, isAbsolutePath, looksMachineAbsolute, resolveInside, validatePortableStrings, validateRelativePaths, validateStdoutAssertions, validateEntry,
  validateSettings, ENTRY_SETTINGS,
  globRegex, entryTestFile, expandEntries, selectEntries,
};
