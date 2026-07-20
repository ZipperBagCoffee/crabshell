'use strict';

// Portable structured verification runner.
// Copy this file beside .crabshell/verification/manifest.json.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
    error: null
  };

  for (const arg of argv) {
    if (arg === '--flat' || arg === '-f') parsed.flat = true;
    else if (arg.startsWith('-')) {
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
      env: { ...process.env, PROJECT_ROOT: projectRoot, CLAUDE_PROJECT_DIR: projectRoot, CRABSHELL_VERIFY_RUNNING: '1' }
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
  if (process.env.CRABSHELL_VERIFY_RUNNING === '1' && !args.targetId) {
    return failRunner('RUNNER_RECURSION', 'Nested full-manifest verification is blocked. Pass an explicit entry id.');
  }
  const manifestPath = options.manifestPath || path.join(__dirname, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return failRunner('RUNNER_MANIFEST', `Cannot read manifest: ${error.message}`);
  }
  const projectRoot = path.resolve(options.projectRoot || process.env.PROJECT_ROOT || path.resolve(__dirname, '../..'));
  const entries = selectEntries(manifest, args.targetId);
  if (args.targetId && entries.length === 0) return failRunner('RUNNER_TARGET', `Unknown entry id: ${args.targetId}`);
  const results = entries.map(entry => runEntry(entry, { projectRoot }));
  const passCount = results.filter(result => result.status === 'PASS').length;
  const failCount = results.filter(result => result.status === 'FAIL').length;
  const manualCount = results.filter(result => result.status === 'manual').length;
  console.log(JSON.stringify(results, null, 2));
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
  main
};
