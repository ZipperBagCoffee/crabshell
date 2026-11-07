'use strict';
// A check's contract: assertions on its output and files, and snapshots of the paths
// it must not change.

const fs = require('fs');
const path = require('path');
const { resolveInside } = require('./manifest');
const { hashBuffer } = require('./fingerprint');

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
    if (assertion.kind === 'stdoutMatches') {
      return { pass: new RegExp(assertion.pattern, assertion.flags).test(context.stdout || ''), message: `stdout: expected /${assertion.pattern}/` };
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

module.exports = { readJsonPointer, readJsonFile, deepEqual, evaluateAssertion, snapshotResolved, snapshotPaths };
