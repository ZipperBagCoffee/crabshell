'use strict';
// Running one check and judging it against its contract. The one-at-a-time path
// (spawnSync) and the side-by-side path (spawn) share how a run is prepared and judged.

const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { RUNNER_NODE, validateEntry, resolveInside } = require('./manifest');
const { evaluateAssertion, snapshotPaths, deepEqual } = require('./contract');
const { traceEnvironment } = require('./trace');
const { classify } = require('./classify');
const { REPORT_ENV, expandCases } = require('./used-report');

const DEFAULT_TIMEOUT_MS = 30000;

function commandExecutable(command, projectRoot) {
  if (command.file === RUNNER_NODE) return process.execPath;
  if (command.file.startsWith('./') || command.file.startsWith('../') || command.file.includes('/') || command.file.includes('\\')) {
    return resolveInside(projectRoot, command.file, 'command.file');
  }
  return command.file;
}

// options.projectRoot names the project; otherwise PROJECT_ROOT, otherwise the
// launcher's project (options.defaultProjectRoot, which the launcher supplies).
// options.report: the file the check may write what it used to (REPORT_ENV; a report path
// this process inherited is not passed on). options.cases: the cases `{cases}` stands for
// (none: every case).
// Returns { result } when nothing runs, or { run } with what to start and how to judge it.
function prepare(entry, options) {
  const projectRoot = path.resolve(options.projectRoot || process.env.PROJECT_ROOT || options.defaultProjectRoot || process.cwd());
  if (entry && entry.type === 'manual') {
    return { result: { id: entry.id, type: 'manual', status: 'manual', message: 'Requires human verification', failureClass: null } };
  }
  if (entry && entry.discoveryError) {
    return { result: { id: entry.id, type: entry.type, status: 'FAIL', error: entry.discoveryError, output: '', failureClass: 'missing-file' } };
  }
  try {
    validateEntry(entry);
    const forbiddenPaths = Array.isArray(entry.contract.forbiddenChanges) ? entry.contract.forbiddenChanges : [];
    const before = snapshotPaths(projectRoot, forbiddenPaths);
    const cwd = entry.command.cwd ? resolveInside(projectRoot, entry.command.cwd, 'command.cwd') : projectRoot;
    // CRABSHELL_VERIFY_RUNNING names the project being verified, so only a nested run of
    // this same project counts as recursion (main.js).
    const env = { ...process.env, PROJECT_ROOT: projectRoot, CLAUDE_PROJECT_DIR: projectRoot, CRABSHELL_VERIFY_RUNNING: projectRoot };
    delete env[REPORT_ENV];
    if (options.report) env[REPORT_ENV] = options.report;
    return {
      run: {
        file: commandExecutable(entry.command, projectRoot),
        args: expandCases(entry.command.args, options.cases),
        options: {
          cwd,
          timeout: entry.timeout || DEFAULT_TIMEOUT_MS,
          windowsHide: true,
          env: traceEnvironment(env, options.trace, projectRoot),
        },
        judge: executed => judge(entry, projectRoot, forbiddenPaths, before, executed),
      },
    };
  } catch (error) {
    return { result: invalid(entry, error) };
  }
}

function invalid(entry, error) {
  return { id: entry && entry.id ? entry.id : 'INVALID_ENTRY', type: entry && entry.type, status: 'FAIL', error: error.message, output: '', failureClass: classify(error.message, '') };
}

// executed: { status, stdout, stderr, error } as spawnSync reports it.
function judge(entry, projectRoot, forbiddenPaths, before, executed) {
  try {
    const assertions = Array.isArray(entry.contract.assertions) ? entry.contract.assertions : [];
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
    const error = failures.length > 0
      ? `${failures.join('; ')}${stderr.trim() ? `; stderr: ${stderr.trim()}` : ''}`
      : null;
    return {
      id: entry.id,
      type: entry.type,
      status,
      observation: { exitCode, assertions: assertionResults, changedForbidden },
      output: stdout.trim(),
      stderr: stderr.trim(),
      error,
      ...(executed.error && executed.error.code === 'ETIMEDOUT' ? { timedOut: true } : {}),
      failureClass: status === 'FAIL' ? classify(error, `${stdout}\n${stderr}`) : null
    };
  } catch (error) {
    return invalid(entry, error);
  }
}

const elapsedMs = started => Math.round(Number(process.hrtime.bigint() - started) / 1e6);

function runEntry(entry, options = {}) {
  const started = process.hrtime.bigint();
  const prepared = prepare(entry, options);
  let result = prepared.result;
  if (!result) {
    const { file, args, options: spawnOptions, judge: judgeRun } = prepared.run;
    result = judgeRun(spawnSync(file, args, { ...spawnOptions, encoding: 'utf8' }));
  }
  result.durationMs = elapsedMs(started);
  return result;
}

// The same run without blocking, for side-by-side execution; resolves to the result.
function runEntryAsync(entry, options = {}) {
  const started = process.hrtime.bigint();
  const prepared = prepare(entry, options);
  if (prepared.result) return Promise.resolve({ ...prepared.result, durationMs: elapsedMs(started) });
  const { file, args, options: spawnOptions, judge: judgeRun } = prepared.run;
  return new Promise(resolve => {
    const stdout = [];
    const stderr = [];
    let error = null;
    let settled = false;
    const { timeout, ...rest } = spawnOptions;
    let child;
    try { child = spawn(file, args, rest); } catch (spawnError) {
      resolve({ ...judgeRun({ status: null, stdout: '', stderr: '', error: spawnError }), durationMs: elapsedMs(started) });
      return;
    }
    const timer = setTimeout(() => {
      error = Object.assign(new Error(`spawnSync ${file} ETIMEDOUT`), { code: 'ETIMEDOUT' });
      try { child.kill(); } catch (_) {}
    }, timeout);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    const finish = status => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...judgeRun({ status, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), error }), durationMs: elapsedMs(started) });
    };
    child.on('error', spawnError => { error = error || spawnError; finish(null); });
    child.on('close', code => finish(error && error.code === 'ETIMEDOUT' ? null : code));
  });
}

module.exports = { commandExecutable, runEntry, runEntryAsync, DEFAULT_TIMEOUT_MS };
