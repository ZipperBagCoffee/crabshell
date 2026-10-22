'use strict';

// Portable structured verification runner.
// Copy this file beside .crabshell/verification/manifest.json.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MAP_FILE = 'test-map.json';
// Tests that may pass on HEAD too (a refactor that keeps behavior), each with the
// sha256 of the test content it covers and a reason.
const EXEMPT_FILE = 'fail-before-exempt.json';
// Changes to these always run every check; the manifest adds project files through
// "changed": { "global": [globs] }.
const DEFAULT_GLOBAL = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'];
// Prose that no check reads needs no check.
const PROSE_EXTENSIONS = ['.md', '.markdown', '.mdx', '.txt', '.rst', '.adoc'];
const IGNORED_DIRS = ['node_modules', '.git'];

let classify = function fallbackClassify(error, output) {
  const text = `${error || ''}\n${output || ''}`;
  if (/command not found|is not recognized|spawn .+ ENOENT/i.test(text)) return 'env-incompatible';
  if (/no such file|file not found|ENOENT/i.test(text)) return 'missing-file';
  if (/assert|mismatch|contract|forbidden|expected/i.test(text)) return 'assertion-fail';
  return 'unknown';
};
let shouldWarn = function fallbackWarn() {
  return { warn: false, ratio: 0, unknownCount: 0, failCount: 0 };
};
try {
  const localClassifier = require('./verify-classify');
  if (typeof localClassifier.classify === 'function') classify = localClassifier.classify;
  if (typeof localClassifier.shouldWarn === 'function') shouldWarn = localClassifier.shouldWarn;
} catch (_) {}

function parseArgs(argv) {
  const parsed = {
    targetId: null,
    flat: process.env.CRABSHELL_VERIFY_FLAT === '1',
    changed: false,
    dryRun: false,
    files: null,
    failBefore: true,
    error: null
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--flat' || arg === '-f') parsed.flat = true;
    else if (arg === '--changed') parsed.changed = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--no-fail-before') parsed.failBefore = false;
    else if (arg === '--files') {
      const value = argv[++index];
      if (!value) { parsed.error = '--files needs a comma-separated list'; break; }
      parsed.files = value.split(',').map(item => item.trim()).filter(Boolean);
    } else if (arg.startsWith('-')) {
      parsed.error = `Unknown flag: ${arg}`;
      break;
    } else if (!parsed.targetId) parsed.targetId = arg;
    else {
      parsed.error = `Unexpected extra argument: ${arg}`;
      break;
    }
  }
  return parsed;
}

function looksMachineAbsolute(value) {
  if (typeof value !== 'string') return false;
  return /^[A-Za-z]:[\\/]/.test(value)
    || /^~[\\/]/.test(value)
    || /^\/(?:Users|home|tmp|var|opt|mnt|private|Program Files)(?:\/|$)/i.test(value);
}

function resolveInside(projectRoot, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error(`${label} must be a non-empty repo-relative path`);
  }
  if (path.isAbsolute(relativePath) || looksMachineAbsolute(relativePath)) {
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

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('entry must be an object');
  if (!entry.id || typeof entry.id !== 'string') throw new Error('entry.id is required');
  if (!['behavioral', 'structural', 'manual'].includes(entry.type)) {
    throw new Error(`${entry.id}: type must be behavioral, structural, or manual`);
  }
  if (entry.type === 'manual') return;
  if (!entry.command || typeof entry.command !== 'object' || Array.isArray(entry.command)) {
    throw new Error(`${entry.id}: command must be an object with file and args`);
  }
  if (typeof entry.command.file !== 'string' || entry.command.file.length === 0) {
    throw new Error(`${entry.id}: command.file is required`);
  }
  if (path.isAbsolute(entry.command.file) || looksMachineAbsolute(entry.command.file)) {
    throw new Error(`${entry.id}: command.file must be portable: ${entry.command.file}`);
  }
  if (!Array.isArray(entry.command.args) || !entry.command.args.every(arg => typeof arg === 'string')) {
    throw new Error(`${entry.id}: command.args must be a string array`);
  }
  validatePortableStrings(entry.command, `${entry.id}.command`);
  validatePortableStrings(entry.contract, `${entry.id}.contract`);
  if (!entry.contract || !Number.isInteger(entry.contract.exitCode)) {
    throw new Error(`${entry.id}: contract.exitCode is required`);
  }
  const assertions = Array.isArray(entry.contract.assertions) ? entry.contract.assertions : [];
  const forbidden = Array.isArray(entry.contract.forbiddenChanges) ? entry.contract.forbiddenChanges : [];
  if (entry.type === 'behavioral' && assertions.length === 0 && forbidden.length === 0) {
    throw new Error(`${entry.id}: behavioral contract requires an assertion or forbiddenChanges`);
  }
}

function readJsonPointer(value, pointer) {
  if (pointer === '' || pointer === '/') return value;
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    throw new Error(`JSON pointer must start with '/': ${pointer}`);
  }
  return pointer.slice(1).split('/').reduce((current, raw) => {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), key)) {
      throw new Error(`JSON pointer not found: ${pointer}`);
    }
    return current[key];
  }, value);
}

function readJsonFile(projectRoot, relativePath) {
  const resolved = resolveInside(projectRoot, relativePath, 'assertion.path');
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function deepEqual(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function evaluateAssertion(assertion, context) {
  if (!assertion || typeof assertion !== 'object') return { pass: false, message: 'assertion must be an object' };
  try {
    if (assertion.kind === 'jsonEquals') {
      const actual = readJsonPointer(readJsonFile(context.projectRoot, assertion.path), assertion.pointer || '');
      return { pass: deepEqual(actual, assertion.equals), message: `${assertion.path}${assertion.pointer || ''}: expected ${JSON.stringify(assertion.equals)}, observed ${JSON.stringify(actual)}` };
    }
    if (assertion.kind === 'jsonMatches') {
      const actual = readJsonPointer(readJsonFile(context.projectRoot, assertion.actual.path), assertion.actual.pointer || '');
      const expected = readJsonPointer(readJsonFile(context.projectRoot, assertion.expected.path), assertion.expected.pointer || '');
      return { pass: deepEqual(actual, expected), message: `expected ${assertion.actual.path}${assertion.actual.pointer || ''} to match ${assertion.expected.path}${assertion.expected.pointer || ''}; observed ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}` };
    }
    if (assertion.kind === 'stdoutJsonEquals') {
      const parsed = JSON.parse(context.stdout || '');
      const actual = readJsonPointer(parsed, assertion.pointer || '');
      return { pass: deepEqual(actual, assertion.equals), message: `stdout${assertion.pointer || ''}: expected ${JSON.stringify(assertion.equals)}, observed ${JSON.stringify(actual)}` };
    }
    if (assertion.kind === 'fileExists') {
      const resolved = resolveInside(context.projectRoot, assertion.path, 'assertion.path');
      const actual = fs.existsSync(resolved);
      return { pass: actual === (assertion.equals !== false), message: `${assertion.path}: exists=${actual}` };
    }
    if (assertion.kind === 'fileContains') {
      const resolved = resolveInside(context.projectRoot, assertion.path, 'assertion.path');
      const actual = fs.readFileSync(resolved, 'utf8').includes(String(assertion.value));
      return { pass: actual, message: `${assertion.path}: contains ${JSON.stringify(assertion.value)} = ${actual}` };
    }
    return { pass: false, message: `unsupported assertion kind: ${assertion.kind}` };
  } catch (error) {
    return { pass: false, message: error.message };
  }
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function snapshotResolved(target) {
  if (!fs.existsSync(target)) return { kind: 'missing' };
  const stat = fs.statSync(target);
  if (stat.isFile()) return { kind: 'file', hash: hashBuffer(fs.readFileSync(target)) };
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(target).sort().map(name => ({ name, value: snapshotResolved(path.join(target, name)) }));
    return { kind: 'directory', hash: hashBuffer(Buffer.from(JSON.stringify(entries))) };
  }
  return { kind: 'other', size: stat.size, mtimeMs: stat.mtimeMs };
}

function snapshotPaths(projectRoot, relativePaths) {
  const snapshots = {};
  for (const relativePath of relativePaths) {
    const resolved = resolveInside(projectRoot, relativePath, 'contract.forbiddenChanges');
    snapshots[relativePath] = snapshotResolved(resolved);
  }
  return snapshots;
}

// --- discovery, load map and changed-file selection ---

const toPosix = value => value.replace(/\\/g, '/');

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

// The repo file a node command runs (the first argument that is a file), or null.
function entryTestFile(entry, projectRoot) {
  if (!entry || !entry.command || entry.command.file !== 'node' || !Array.isArray(entry.command.args)) return null;
  const script = entry.command.args.find(arg => !arg.startsWith('-'));
  if (!script || entry.command.args[0] === '-e' || entry.command.args[0] === '--eval') return null;
  try {
    const resolved = resolveInside(projectRoot, script, 'command.args');
    return fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? toPosix(path.relative(projectRoot, resolved)) : null;
  } catch (_) {
    return null;
  }
}

// Expand "discover" entries into one entry per matching file; explicit entries keep
// precedence, so a file run by its own entry is not discovered again.
function expandEntries(manifest, projectRoot) {
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const explicitFiles = new Set(entries.filter(entry => !entry.discover).map(entry => entryTestFile(entry, projectRoot)).filter(Boolean));
  const expanded = [];
  for (const entry of entries) {
    if (!entry || !entry.discover) { expanded.push(entry); continue; }
    const rule = entry.discover;
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
          : { file: 'node', args: [file] },
        contract: entry.contract,
        timeout: entry.timeout,
        always: entry.always,
        discoveredBy: entry.id,
      });
    }
  }
  return expanded;
}

// Tracer loaded into every checked process through NODE_OPTIONS: records the repo
// files and folders each process requires, reads, lists, copies or opens, appended
// to CRABSHELL_TRACE_FILE on exit. It also re-adds itself to child processes whose
// callers build a fresh environment or their own NODE_OPTIONS.
const TRACER_SOURCE = `'use strict';
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const out = process.env.CRABSHELL_TRACE_FILE;
const root = process.env.CRABSHELL_TRACE_ROOT;
const requireFlag = process.env.CRABSHELL_TRACE_REQUIRE;
if (out && root) {
  const seen = new Set();
  const note = target => {
    try {
      if (target instanceof URL) target = fileURLToPath(target);
      else if (typeof target === 'string' && target.startsWith('file:')) target = fileURLToPath(target);
      if (typeof target === 'string') seen.add(path.resolve(target));
    } catch (_) {}
  };
  const wrap = (object, name, positions = [0]) => {
    const original = object && object[name];
    if (typeof original !== 'function') return;
    object[name] = function (...args) { for (const index of positions) note(args[index]); return original.apply(this, args); };
  };
  for (const name of ['readFileSync', 'readFile', 'createReadStream', 'existsSync', 'statSync', 'lstatSync', 'readdirSync', 'readdir', 'opendirSync', 'openSync', 'open']) wrap(fs, name);
  for (const name of ['copyFileSync', 'copyFile', 'cpSync', 'cp']) wrap(fs, name, [0]);
  if (fs.promises) {
    for (const name of ['readFile', 'readdir', 'open', 'stat', 'opendir']) wrap(fs.promises, name);
    for (const name of ['copyFile', 'cp']) wrap(fs.promises, name, [0]);
  }
  const cp = require('child_process');
  const traced = options => {
    const copy = options && typeof options === 'object' ? { ...options } : {};
    const env = { ...(copy.env || process.env) };
    // A child that already carries a trace target (a nested runner tracing its own
    // checks) keeps it; only a child that lost tracing gets this process's target.
    if (!env.CRABSHELL_TRACE_FILE) {
      env.CRABSHELL_TRACE_FILE = out;
      env.CRABSHELL_TRACE_ROOT = root;
      if (requireFlag) env.CRABSHELL_TRACE_REQUIRE = requireFlag;
    }
    const flag = env.CRABSHELL_TRACE_REQUIRE || requireFlag;
    const current = env.NODE_OPTIONS || '';
    if (flag && !current.includes(flag)) env.NODE_OPTIONS = current ? flag + ' ' + current : flag;
    copy.env = env;
    return copy;
  };
  // Where the options object sits: (file, args?, options?, callback?) or (command, options?, callback?).
  const withArgs = (original, hasArgList) => function (...args) {
    let index = hasArgList && Array.isArray(args[1]) ? 2 : 1;
    if (typeof args[index] === 'function' || args[index] === undefined || args[index] === null) {
      if (typeof args[index] === 'function') args.splice(index, 0, traced(null));
      else args[index] = traced(null);
    } else if (typeof args[index] === 'object') args[index] = traced(args[index]);
    return original.apply(this, args);
  };
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork']) if (typeof cp[name] === 'function') cp[name] = withArgs(cp[name], true);
  for (const name of ['exec', 'execSync']) if (typeof cp[name] === 'function') cp[name] = withArgs(cp[name], false);
  process.on('exit', () => {
    try {
      const files = new Set([...seen, ...Object.keys(require.cache)]);
      fs.appendFileSync(out, JSON.stringify([...files]) + '\\n');
    } catch (_) {}
  });
}
`;

function insideRoot(projectRoot, absolute) {
  const relative = path.relative(projectRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const posix = toPosix(relative);
  if (IGNORED_DIRS.some(dir => posix === dir || posix.startsWith(dir + '/'))) return null;
  return posix;
}

function readTrace(traceFile, projectRoot) {
  const files = new Set();
  if (!traceFile || !fs.existsSync(traceFile)) return files;
  for (const line of fs.readFileSync(traceFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      for (const absolute of JSON.parse(line)) {
        const relative = insideRoot(projectRoot, absolute);
        if (!relative || !fs.existsSync(absolute)) continue;
        const stat = fs.statSync(absolute);
        if (stat.isFile()) files.add(relative);
        else if (stat.isDirectory()) files.add(relative + '/');
      }
    } catch (_) {}
  }
  return files;
}

// Repo files a check names as string literals (scripts started by a path string,
// fixtures) plus their relative-require closure. Covers child processes that the
// tracer cannot see because they start without NODE_OPTIONS.
function staticDependencies(testFile, projectRoot) {
  const found = new Set();
  if (!testFile || process.env.CRABSHELL_VERIFY_NO_STATIC_SCAN === '1') return found;
  const queue = [testFile];
  const literal = /['"`]([^'"`\n\r]{1,200}\.(?:c?js|mjs|json|md|ya?ml|txt))['"`]/g;
  const requireCall = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
  const candidates = (fromFile, value) => {
    const base = path.dirname(path.join(projectRoot, fromFile));
    return [path.resolve(base, value), path.resolve(projectRoot, value)];
  };
  while (queue.length && found.size < 2000) {
    const file = queue.shift();
    if (found.has(file)) continue;
    found.add(file);
    let text;
    try { text = fs.readFileSync(path.join(projectRoot, file), 'utf8'); } catch (_) { continue; }
    if (!/\.(c?js|mjs)$/.test(file)) continue;
    const next = [];
    let match;
    literal.lastIndex = 0;
    while ((match = literal.exec(text)) !== null) next.push(...candidates(file, match[1]));
    requireCall.lastIndex = 0;
    while ((match = requireCall.exec(text)) !== null) {
      const base = path.resolve(path.dirname(path.join(projectRoot, file)), match[1]);
      next.push(base, base + '.js', path.join(base, 'index.js'));
    }
    for (const absolute of next) {
      const relative = insideRoot(projectRoot, absolute);
      if (relative && !found.has(relative) && fs.existsSync(absolute) && fs.statSync(absolute).isFile()) queue.push(relative);
    }
  }
  return found;
}

// Files a check's assertions read. (forbiddenChanges paths are compared before and
// after the run, so editing them does not change the check's outcome.)
function contractPaths(entry) {
  const paths = [];
  const contract = entry && entry.contract || {};
  for (const assertion of Array.isArray(contract.assertions) ? contract.assertions : []) {
    for (const value of [assertion && assertion.path, assertion && assertion.actual && assertion.actual.path, assertion && assertion.expected && assertion.expected.path]) {
      if (typeof value === 'string') paths.push(toPosix(value));
    }
  }
  return paths;
}

// A recorded path covers a changed file when it is the file or a folder that contains it.
function covers(recorded, file) {
  return recorded === file || (recorded.endsWith('/') && file.startsWith(recorded));
}

function mapPath(manifestPath) {
  return path.join(path.dirname(manifestPath), MAP_FILE);
}

function exemptPath(manifestPath) {
  return path.join(path.dirname(manifestPath), EXEMPT_FILE);
}

// The runner's own files (the load map, the exemptions) are not changes to check.
function withoutRunnerFiles(files, projectRoot, manifestPath) {
  const own = new Set([mapPath(manifestPath), exemptPath(manifestPath)].map(file => insideRoot(projectRoot, file)).filter(Boolean));
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

// Files git can report as changed (tracked, or untracked and not ignored), or null
// when git is unavailable. Ignored files never appear in the change list.
function gitVisibleFiles(projectRoot) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true, maxBuffer: 256 << 20 });
  if (result.status !== 0) return null;
  return new Set(result.stdout.split('\n').map(line => toPosix(line.trim())).filter(Boolean));
}

// Decide which entries a set of changed files needs.
function planChanged(manifest, entries, projectRoot, manifestPath, changedFiles) {
  const runnable = entries.filter(entry => entry.type !== 'manual');
  const everything = reason => ({ mode: 'changed', full: true, reason, changed: changedFiles, selected: runnable.map(entry => entry.id), total: runnable.length });
  const mapFile = mapPath(manifestPath);
  const manifestRelative = insideRoot(projectRoot, manifestPath);
  const runnerRelative = insideRoot(projectRoot, __filename);
  const mapRelative = insideRoot(projectRoot, mapFile);
  const changed = withoutRunnerFiles(changedFiles, projectRoot, manifestPath);
  if (!fs.existsSync(mapFile)) return everything('no load map yet (a full run creates it)');
  let map;
  try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch (error) { return everything(`load map unreadable: ${error.message}`); }
  const createdAt = Date.parse(map.createdAt || '');
  if (!Number.isFinite(createdAt)) return everything('load map has no creation time');
  const testFiles = new Map(runnable.map(entry => [entry.id, entryTestFile(entry, projectRoot)]));
  const changedSet = new Set(changed);
  // A file is newer than the map when it changed after its time was recorded (the
  // end of the full run); files without a recorded time compare with the run start.
  // A moved time with the recorded content (a revert, a checkout) is not a change.
  const fileTimes = map.fileTimes || {};
  const fileHashes = map.fileHashes || {};
  const newer = file => {
    try {
      const absolute = path.join(projectRoot, file);
      const mtime = fs.statSync(absolute).mtimeMs;
      const moved = Object.hasOwn(fileTimes, file) ? mtime > fileTimes[file] + 1 : mtime > createdAt;
      if (moved && Object.hasOwn(fileHashes, file)) return hashBuffer(fs.readFileSync(absolute)) !== fileHashes[file];
      return moved;
    } catch (_) { return false; }
  };
  // A recorded file git ignores (runtime state a session keeps writing) can never be
  // in the change list, so its later change says nothing about the code: only files
  // git can report are checked. The manifest, runner and test files are always
  // checked, since a project may ignore its whole .crabshell folder.
  const visible = gitVisibleFiles(projectRoot);
  const recordedFiles = new Set();
  for (const record of Object.values(map.entries || {})) {
    for (const file of record.files || []) if (!file.endsWith('/') && file !== mapRelative && (!visible || visible.has(file))) recordedFiles.add(file);
  }
  // A check with no record yet (a new, renamed or pulled test) runs anyway, so its own
  // test file need not be compared with the map; nothing else can depend on a test
  // that did not exist when the map was written.
  const records = map.entries || {};
  const unrecorded = new Set(runnable.filter(entry => !records[entry.id]).map(entry => entry.id));
  const knownTests = [...testFiles].filter(([id]) => !unrecorded.has(id)).map(([, file]) => file);
  for (const file of [manifestRelative, runnerRelative, ...knownTests, ...recordedFiles].filter(Boolean)) {
    if (!changedSet.has(file) && newer(file)) return everything(`load map is older than ${file}`);
  }
  const globals = [...DEFAULT_GLOBAL, ...((manifest.changed && Array.isArray(manifest.changed.global)) ? manifest.changed.global : [])].map(globRegex);
  const selected = new Set(unrecorded);
  for (const entry of runnable) {
    const record = records[entry.id];
    if (record && (entry.always === true || (record.files || []).length === 0)) selected.add(entry.id);
  }
  // A test the map knows that is gone from disk (deleted, or the old name of a renamed
  // test) leaves nothing to run; a check that read it records it and is selected above.
  const formerTests = new Set(Object.values(records).map(record => record.test).filter(Boolean));
  for (const file of changed) {
    if (file === manifestRelative || file === runnerRelative || globals.some(regex => regex.test(file))) return everything(`${file} affects every check`);
    const users = runnable.filter(entry => testFiles.get(entry.id) === file || ((records[entry.id] || {}).files || []).some(recorded => covers(recorded, file)));
    if (users.length > 0) { users.forEach(entry => selected.add(entry.id)); continue; }
    if (PROSE_EXTENSIONS.includes(path.extname(file).toLowerCase())) continue;
    if (formerTests.has(file) && !fs.existsSync(path.join(projectRoot, file))) continue;
    return everything(`${file} is not in the load map`);
  }
  const chosen = runnable.filter(entry => selected.has(entry.id));
  const tests = {};
  for (const entry of chosen) if (testFiles.get(entry.id)) tests[entry.id] = testFiles.get(entry.id);
  // With nothing changed, only the checks that always run are left (an edit git cannot
  // see to the manifest, runner or a test was caught above as a stale map).
  const reason = (changed.length === 0 ? 'no changed files' : `${changed.length} changed file(s)`)
    + (unrecorded.size > 0 ? `, ${unrecorded.size} new check(s)` : '');
  return { mode: 'changed', full: false, reason, changed, selected: chosen.map(entry => entry.id), tests, total: runnable.length };
}

function commandExecutable(command, projectRoot) {
  if (command.file === 'node') return process.execPath;
  if (command.file.startsWith('./') || command.file.startsWith('../') || command.file.includes('/') || command.file.includes('\\')) {
    return resolveInside(projectRoot, command.file, 'command.file');
  }
  return command.file;
}

function runEntry(entry, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.env.PROJECT_ROOT || path.resolve(__dirname, '../..'));
  if (entry && entry.type === 'manual') {
    return { id: entry.id, type: 'manual', status: 'manual', message: 'Requires human verification', failureClass: null };
  }
  if (entry && entry.discoveryError) {
    return { id: entry.id, type: entry.type, status: 'FAIL', error: entry.discoveryError, output: '', failureClass: 'missing-file' };
  }

  try {
    validateEntry(entry);
    const assertions = Array.isArray(entry.contract.assertions) ? entry.contract.assertions : [];
    const forbiddenPaths = Array.isArray(entry.contract.forbiddenChanges) ? entry.contract.forbiddenChanges : [];
    const before = snapshotPaths(projectRoot, forbiddenPaths);
    const cwd = entry.command.cwd ? resolveInside(projectRoot, entry.command.cwd, 'command.cwd') : projectRoot;
    const executed = spawnSync(commandExecutable(entry.command, projectRoot), entry.command.args, {
      cwd,
      encoding: 'utf8',
      timeout: entry.timeout || 30000,
      windowsHide: true,
      env: traceEnvironment({ ...process.env, PROJECT_ROOT: projectRoot, CLAUDE_PROJECT_DIR: projectRoot, CRABSHELL_VERIFY_RUNNING: '1' }, options.trace, projectRoot)
    });
    const exitCode = Number.isInteger(executed.status) ? executed.status : null;
    const stdout = executed.stdout || '';
    const stderr = executed.stderr || '';
    const assertionResults = assertions.map(assertion => evaluateAssertion(assertion, { projectRoot, stdout, stderr, exitCode }));
    const after = snapshotPaths(projectRoot, forbiddenPaths);
    const changedForbidden = forbiddenPaths.filter(relativePath => !deepEqual(before[relativePath], after[relativePath]));
    const failures = [];
    if (executed.error) failures.push(`command error: ${executed.error.message}`);
    if (exitCode !== entry.contract.exitCode) failures.push(`exit code expected ${entry.contract.exitCode}, observed ${exitCode}`);
    for (const result of assertionResults) if (!result.pass) failures.push(result.message);
    if (changedForbidden.length > 0) failures.push(`forbidden changes observed: ${changedForbidden.join(', ')}`);
    const status = failures.length === 0 ? 'PASS' : 'FAIL';
    const output = stdout.trim();
    const error = failures.length > 0
      ? `${failures.join('; ')}${stderr.trim() ? `; stderr: ${stderr.trim()}` : ''}`
      : null;
    return {
      id: entry.id,
      type: entry.type,
      status,
      observation: { exitCode, assertions: assertionResults, changedForbidden },
      output,
      stderr: stderr.trim(),
      error,
      failureClass: status === 'FAIL' ? classify(error, `${stdout}\n${stderr}`) : null
    };
  } catch (error) {
    return { id: entry && entry.id ? entry.id : 'INVALID_ENTRY', type: entry && entry.type, status: 'FAIL', error: error.message, output: '', failureClass: classify(error.message, '') };
  }
}

function traceEnvironment(env, trace, projectRoot) {
  if (!trace) return env;
  const require = `--require "${toPosix(trace.tracer)}"`;
  return { ...env, NODE_OPTIONS: env.NODE_OPTIONS ? `${require} ${env.NODE_OPTIONS}` : require, CRABSHELL_TRACE_FILE: trace.file, CRABSHELL_TRACE_ROOT: projectRoot, CRABSHELL_TRACE_REQUIRE: require };
}

// --- fail-before: a changed test must fail on the source it was written against ---

// HEAD written into fresh folders through a temporary index, so the repository, its
// index and the working tree are never touched.
function headCheckout(projectRoot, workDir) {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(workDir, 'index') };
  const git = args => spawnSync('git', args, { cwd: projectRoot, env, encoding: 'utf8', windowsHide: true });
  const read = git(['read-tree', 'HEAD']);
  if (read.status !== 0) return { error: `cannot read HEAD: ${(read.stderr || (read.error && read.error.message) || '').trim()}` };
  const prefix = git(['rev-parse', '--show-prefix']);
  const inside = prefix.status === 0 ? prefix.stdout.trim() : '';
  let count = 0;
  return {
    extract() {
      const dir = path.join(workDir, `head-${++count}`);
      const result = git(['checkout-index', '--all', '--force', `--prefix=${toPosix(dir)}/`]);
      if (result.status !== 0) throw new Error(`git checkout-index failed: ${(result.stderr || '').trim()}`);
      return path.join(dir, inside);
    }
  };
}

function failureSummary(result) {
  return String(result.error || '').split('; stderr:')[0].slice(0, 200);
}

// A changed test that passes now and reads a changed file that is not a test (source,
// or a document the test checks) also runs on HEAD, where it must fail: a test that
// passes on the old source too does not check this change. The HEAD version of the
// test runs there first and must pass, so a failure on HEAD is the change's doing and
// not the copy's.
function failBeforeChecks({ entries, results, records, changedFiles, expanded, projectRoot, manifestPath }) {
  const changed = new Set(withoutRunnerFiles(changedFiles, projectRoot, manifestPath));
  const testFiles = new Set(expanded.map(entry => entryTestFile(entry, projectRoot)).filter(Boolean));
  const passed = new Set(results.filter(result => result.status === 'PASS').map(result => result.id));
  const targets = [];
  for (const entry of entries) {
    const test = entryTestFile(entry, projectRoot);
    if (!test || !changed.has(test) || !passed.has(entry.id)) continue;
    const files = (records[entry.id] || {}).files || [];
    const sources = [...changed].filter(file => !testFiles.has(file) && files.some(recorded => covers(recorded, file)));
    if (sources.length > 0) targets.push({ entry, test, files, sources });
  }
  if (targets.length === 0) return [];
  let exemptions = {};
  try { exemptions = JSON.parse(fs.readFileSync(exemptPath(manifestPath), 'utf8')) || {}; } catch (_) {}
  const exemptRelative = insideRoot(projectRoot, exemptPath(manifestPath)) || EXEMPT_FILE;
  const visible = gitVisibleFiles(projectRoot);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-fail-before-'));
  const out = [];
  try {
    const head = headCheckout(projectRoot, workDir);
    for (const { entry, test, files, sources } of targets) {
      const report = (status, text) => out.push({
        id: `FAIL_BEFORE:${entry.id}`, type: 'fail-before', status, test, sources,
        ...(status === 'FAIL' ? { error: text } : { message: text }),
        failureClass: status === 'FAIL' ? 'fail-before' : null
      });
      try {
        const hash = hashBuffer(fs.readFileSync(path.join(projectRoot, test)));
        const exemption = exemptions[test];
        if (exemption && exemption.sha256 === hash && typeof exemption.reason === 'string' && exemption.reason.trim()) {
          report('PASS', `exempt: ${exemption.reason.trim()}`);
          continue;
        }
        if (head.error) { report('manual', `${head.error}, so it cannot be compared with HEAD`); continue; }
        // Files git ignores that the test reads (runtime state, a generated manifest)
        // are not in HEAD, so they are copied as they are now. New files are part of
        // the change and stay out.
        const prepare = () => {
          const root = head.extract();
          for (const file of files) {
            if (file.endsWith('/') || !visible || visible.has(file)) continue;
            const from = path.join(projectRoot, file);
            if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.copyFileSync(from, path.join(root, file));
          }
          return root;
        };
        let root = prepare();
        let baseline = null;
        if (fs.existsSync(path.join(root, test))) {
          baseline = runEntry(entry, { projectRoot: root });
          if (baseline.status !== 'PASS') {
            report('manual', `the HEAD version of ${test} already fails on HEAD, so a failure there says nothing about this change: ${failureSummary(baseline)}`);
            continue;
          }
          root = prepare();
        }
        fs.mkdirSync(path.dirname(path.join(root, test)), { recursive: true });
        fs.copyFileSync(path.join(projectRoot, test), path.join(root, test));
        const attempt = runEntry(entry, { projectRoot: root });
        const stale = exemption ? ` (the exemption in ${exemptRelative} is for other content of this test)` : '';
        if (attempt.status === 'PASS') {
          report('FAIL', `passes on HEAD too, so it does not catch the change to ${sources.join(', ')}${stale}. If the change keeps behavior on purpose, record in ${exemptRelative}: {"${test}": {"sha256": "${hash}", "reason": "<why>"}}`);
        } else if (!baseline && ['missing-file', 'env-incompatible'].includes(attempt.failureClass)) {
          report('manual', `new test that cannot run on HEAD (${attempt.failureClass}), so whether it catches the change is unknown: ${failureSummary(attempt)}`);
        } else {
          report('PASS', `fails on HEAD${baseline ? ' (where its HEAD version passes)' : ''} and passes now, so it catches the change: ${failureSummary(attempt)}`);
        }
      } catch (error) {
        report('manual', `could not run on HEAD: ${error.message}`);
      }
    }
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
  }
  return out;
}

function selectEntries(manifest, targetId) {
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  return targetId ? entries.filter(entry => entry.id === targetId) : entries.filter(entry => entry.type !== 'manual');
}

function failRunner(id, error) {
  const result = { id, status: 'FAIL', error, output: '', failureClass: classify(error, '') };
  console.log(JSON.stringify([result], null, 2));
  console.log('\nVerification Results: PASS: 0 / FAIL: 1 / Manual: 0 / Total: 1');
  return 1;
}

function main(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  if (args.error) return failRunner('RUNNER_ARGS', args.error);
  if (process.env.CRABSHELL_VERIFY_RUNNING === '1' && !args.targetId && !args.dryRun) {
    return failRunner('RUNNER_RECURSION', 'Nested full-manifest verification is blocked. Pass an explicit entry id.');
  }
  const manifestPath = options.manifestPath || path.join(__dirname, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return failRunner('RUNNER_MANIFEST', `Cannot read manifest: ${error.message}`);
  }
  const projectRoot = path.resolve(options.projectRoot || process.env.PROJECT_ROOT || path.resolve(__dirname, '../..'));
  let expanded;
  try {
    expanded = expandEntries(manifest, projectRoot);
  } catch (error) {
    return failRunner('RUNNER_DISCOVERY', error.message);
  }
  let entries;
  let plan = null;
  let changedList = [];
  if (args.changed) {
    const changed = args.files ? { files: args.files } : gitChangedFiles(projectRoot);
    changedList = changed.files || [];
    plan = changed.error
      ? { mode: 'changed', full: true, reason: changed.error, changed: [], selected: expanded.filter(e => e.type !== 'manual').map(e => e.id), total: expanded.filter(e => e.type !== 'manual').length }
      : planChanged(manifest, expanded, projectRoot, manifestPath, changed.files);
    if (args.dryRun) {
      console.log(JSON.stringify(plan, null, 2));
      return 0;
    }
    const chosen = new Set(plan.selected);
    entries = expanded.filter(entry => chosen.has(entry.id));
  } else {
    entries = args.targetId ? expanded.filter(entry => entry.id === args.targetId) : expanded.filter(entry => entry.type !== 'manual');
    if (args.targetId && entries.length === 0) return failRunner('RUNNER_TARGET', `Unknown entry id: ${args.targetId}`);
  }

  // A run of every check records what each check loads (the map for --changed); a
  // --changed run that selected fewer refreshes the records of the checks it ran.
  const fullMap = !args.targetId && (!plan || plan.full);
  const partialMap = !args.targetId && Boolean(plan) && !plan.full && entries.length > 0;
  const tracing = fullMap || partialMap;
  let traceDir = null;
  let tracer = null;
  if (tracing) {
    traceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-verify-trace-'));
    tracer = path.join(traceDir, 'tracer.js');
    fs.writeFileSync(tracer, TRACER_SOURCE);
  }
  const startedAt = new Date().toISOString();
  const mapEntries = {};
  const results = entries.map((entry, index) => {
    const trace = tracing ? { tracer, file: path.join(traceDir, `trace-${index}.jsonl`) } : null;
    const result = runEntry(entry, { projectRoot, trace });
    if (tracing) {
      const files = new Set([...readTrace(trace.file, projectRoot), ...staticDependencies(entryTestFile(entry, projectRoot), projectRoot), ...contractPaths(entry)]);
      mapEntries[entry.id] = { test: entryTestFile(entry, projectRoot), files: [...files].sort() };
    }
    return result;
  });
  const allPassed = results.every(result => result.status !== 'FAIL');
  if (tracing && !allPassed) console.error('[VERIFY] load map not updated: a check failed or timed out, so its record may be incomplete');
  if (tracing && allPassed) {
    try {
      // Drop the map itself (checks may read it) and record every checked file's
      // time and content now, so files written during the run are not mistaken for
      // later changes and a later revert to the same content is not one either.
      // A --changed run replaces only the records of the checks it ran: every check
      // whose record covers a changed file was selected, so the others still hold.
      const mapRelative = insideRoot(projectRoot, mapPath(manifestPath));
      const map = fullMap
        ? { version: 2, createdAt: startedAt, fileTimes: {}, fileHashes: {}, entries: {} }
        : JSON.parse(fs.readFileSync(mapPath(manifestPath), 'utf8'));
      map.fileTimes = map.fileTimes || {};
      map.fileHashes = map.fileHashes || {};
      map.entries = map.entries || {};
      // A changed file that a check which did not run records already made this run
      // full; a new file inside a folder such a check lists does not (a --files list
      // can leave it out), so it keeps its content unrecorded and still counts as a
      // later change until that check runs.
      const otherFolders = fullMap ? [] : Object.entries(map.entries).filter(([id]) => !Object.hasOwn(mapEntries, id))
        .flatMap(([, record]) => record.files || []).filter(file => file.endsWith('/'));
      const noted = new Set();
      const note = file => {
        if (!file || file.endsWith('/') || file === mapRelative || noted.has(file)) return;
        noted.add(file);
        try {
          const absolute = path.join(projectRoot, file);
          const hash = hashBuffer(fs.readFileSync(absolute));
          if (map.fileHashes[file] !== hash && otherFolders.some(folder => file.startsWith(folder))) return;
          map.fileTimes[file] = fs.statSync(absolute).mtimeMs;
          map.fileHashes[file] = hash;
        } catch (_) {}
      };
      for (const [id, record] of Object.entries(mapEntries)) {
        record.files = record.files.filter(file => file !== mapRelative);
        record.files.forEach(note);
        note(record.test);
        map.entries[id] = record;
      }
      if (fullMap) {
        note(insideRoot(projectRoot, manifestPath));
        note(insideRoot(projectRoot, __filename));
      }
      fs.writeFileSync(mapPath(manifestPath), JSON.stringify(map, null, 2) + '\n');
    } catch (error) {
      console.error(`[VERIFY] WARN: load map not written: ${error.message}`);
    }
  }
  if (traceDir) { try { fs.rmSync(traceDir, { recursive: true, force: true }); } catch (_) {} }
  const failBefore = plan && args.failBefore
    ? failBeforeChecks({ entries, results, records: mapEntries, changedFiles: changedList, expanded, projectRoot, manifestPath })
    : [];
  results.push(...failBefore);
  const passCount = results.filter(result => result.status === 'PASS').length;
  const failCount = results.filter(result => result.status === 'FAIL').length;
  const manualCount = results.filter(result => result.status === 'manual').length;
  console.log(JSON.stringify(results, null, 2));
  if (plan) console.log(`\nChanged-files run: ${entries.length} of ${plan.total} checks (${plan.full ? 'all — ' : ''}${plan.reason})`);
  if (failBefore.length > 0) {
    const count = status => failBefore.filter(result => result.status === status).length;
    console.log(`\nFail-before: ${failBefore.length} changed test(s) also run on HEAD — PASS: ${count('PASS')} / FAIL: ${count('FAIL')} / Manual: ${count('manual')}`);
  }
  console.log(`\nVerification Results: PASS: ${passCount} / FAIL: ${failCount} / Manual: ${manualCount} / Total: ${results.length}`);

  if (!args.flat) {
    const counts = {};
    for (const result of results.filter(item => item.status === 'FAIL')) {
      const category = result.failureClass || 'unknown';
      counts[category] = (counts[category] || 0) + 1;
    }
    if (Object.keys(counts).length > 0) {
      console.log('\nFailure Categories:');
      for (const category of Object.keys(counts).sort()) console.log(`  ${category}: ${counts[category]}`);
    }
  }
  const warning = shouldWarn(results);
  if (warning.warn) console.error(`[VERIFY] WARN: ${warning.unknownCount}/${warning.failCount} (${warning.ratio}%) failures unclassified; classifier rules may need update`);
  return failCount > 0 ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  parseArgs,
  looksMachineAbsolute,
  resolveInside,
  validateEntry,
  readJsonPointer,
  evaluateAssertion,
  snapshotPaths,
  runEntry,
  selectEntries,
  expandEntries,
  planChanged,
  staticDependencies,
  globRegex,
  main
};
