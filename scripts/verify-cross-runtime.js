'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

const suites = [
  {
    file: '_test-cross-runtime-first-turn.js',
    observations: [/three-field ending is retired/, /divergent-source mutation/, /forbidden-side-effect mutation/],
  },
  {
    file: '_test-cross-runtime-session-memory.js',
    observations: [/stale-memory mutation/, /sentinel-write mutation/],
  },
  {
    file: '_test-cross-runtime-workflow-restart.js',
    observations: [/stale state/, /lost-state/, /sentinel-write mutation/],
  },
  {
    file: '_test-cross-runtime-subagent-context.js',
    observations: [/wrong-event, removed-field/, /sentinel-write mutation/],
  },
  {
    file: '_test-cross-runtime-parent-completion.js',
    observations: [/child false-done/, /wrong-order mutation/, /owner and authority mutations/],
  },
  {
    file: '_test-codex-hook-contract.js',
    observations: [/hardcoded-command mutations/, /PASS-only stdout fixture/],
  },
  {
    file: '_test-codex-windows-hook-command.js',
    observations: [/retired percent-expansion command/],
  },
  {
    file: '_test-codex-compaction.js',
    observations: [/wrong event and missing context mutations/, /missing reset and missing log mutations/],
  },
  {
    file: '_test-alternating-host-continuity.js',
    observations: [/missing-memory mutation/, /cross-host marker mutation/],
  },
  {
    file: '_test-claude-lifecycle-preservation.js',
    observations: [/Codex execution uses separate plugin data and never writes Claude surfaces/],
  },
  {
    file: '_test-fail-open-edge-cases.js',
    observations: [],
    isolatedLast: true,
  },
];

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
    .filter((pattern) => !pattern.test(stdout))
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
