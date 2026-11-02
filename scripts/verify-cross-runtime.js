'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function loadSuites() {
  const manifest = JSON.parse(require('fs').readFileSync(path.join(repoRoot, '.crabshell/verification/manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  const entry = manifest.entries.find(item => item.id === 'V059');
  if (!entry || !entry.fileAssertions || typeof entry.fileAssertions !== 'object' || Array.isArray(entry.fileAssertions)) {
    throw new Error('V059.fileAssertions must supply the cross-runtime observations.');
  }
  const plan = [];
  for (const [file, assertions] of Object.entries(entry.fileAssertions)) {
    if (!Array.isArray(assertions)) throw new Error(`V059.fileAssertions for ${file} must be an assertion array`);
    const observations = assertions.filter(assertion => assertion.kind === 'stdoutMatches').map(assertion => {
      if (typeof assertion.pattern !== 'string' || (assertion.flags !== undefined && typeof assertion.flags !== 'string')) {
        throw new Error(`V059.fileAssertions for ${file}: stdoutMatches requires a string pattern and optional string flags`);
      }
      return new RegExp(assertion.pattern, assertion.flags);
    });
    if (observations.length) plan.push({ file: path.posix.relative('scripts', file.replace(/\\/g, '/')), observations });
  }
  if (plan.length === 0) throw new Error('V059.fileAssertions has no cross-runtime observations.');
  plan.push({ file: '_test-fail-open-edge-cases.js', observations: [], isolatedLast: true });
  return plan;
}

const suites = loadSuites();

function validatePlan(plan = suites) {
  const isolated = plan.filter((suite) => suite.isolatedLast);
  if (isolated.length !== 1 || plan.at(-1) !== isolated[0]) {
    throw new Error('The fail-open suite must be the single isolated last suite.');
  }
  for (const suite of plan) {
    if (path.isAbsolute(suite.file)) throw new Error(`Suite path must be relative: ${suite.file}`);
    if (/\bPASS\b/.test(String(suite.verdict || ''))) {
      throw new Error(`PASS text cannot define the verdict: ${suite.file}`);
    }
  }
  return true;
}

function runSuite(suite) {
  const result = spawnSync(process.execPath, [path.join(__dirname, suite.file)], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const missingObservations = suite.observations
    .filter((pattern) => !new RegExp(pattern.source, pattern.flags).test(stdout))
    .map((pattern) => pattern.source);
  return {
    file: suite.file,
    exitCode: result.status,
    signal: result.signal,
    timedOut: result.error?.code === 'ETIMEDOUT',
    missingObservations,
    passed: result.status === 0 && !result.signal && missingObservations.length === 0,
    stdout,
    stderr,
  };
}

function runAll(plan = suites) {
  validatePlan(plan);
  const results = [];
  for (const suite of plan) results.push(runSuite(suite));
  return {
    passed: results.every((result) => result.passed),
    suites: results.map(({ stdout, stderr, ...result }) => ({
      ...result,
      stdoutTail: stdout.trim().split(/\r?\n/).slice(-3),
      stderrTail: stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3),
    })),
    coverage: {
      verdict: 'child exit status plus required named observations',
      failOpenIsolatedLast: suites.at(-1)?.isolatedLast === true,
      requiredFailureClasses: [
        'missing injection or host mismatch',
        'stale memory',
        'lost workflow state',
        'wrong order or false done',
        'hardcoded path',
        'forbidden side effect',
      ],
    },
  };
}

if (require.main === module) {
  const report = runAll();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else {
    for (const suite of report.suites) {
      process.stdout.write(`${suite.passed ? 'OK' : 'FAIL'} ${suite.file}\n`);
    }
    process.stdout.write(`${report.passed ? 'OK' : 'FAIL'} cross-runtime behavioral verification\n`);
  }
  process.exitCode = report.passed ? 0 : 1;
}

module.exports = { runAll, runSuite, suites, validatePlan };
