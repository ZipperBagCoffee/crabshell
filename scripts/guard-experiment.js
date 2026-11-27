'use strict';

// D187_T004: one guard measured off and on, on the same tasks.
//   node scripts/guard-experiment.js --guard <name> --scenarios <dir> [--model <m>] [--json] [--out <file>]
//   node scripts/guard-experiment.js --self-test [--json]
// Each scenario (core/experiment-scenarios.js) runs as a `claude -p` session (the signed-in CLI,
// no API key) twice, each time in a fresh copy of its project: with the guard on, and with
// CRABSHELL_GUARDS_OFF=<name> (core/guards-off.js). The session loads this checkout as the
// plugin (--plugin-dir) with every installed copy of it switched off. Each arm reports whether
// it was valid (the development copy alone, the switch read, no line of the switched-off guard
// in the project's guard-fire log, no permission prompt denied), the judge's verdict on the
// finished files (a failed judge is a missed failure), the guard's blocks in a control
// scenario (false blocks), whether the session reached its end, its time and the model.
// --self-test checks the tool without a model (core/experiment-self-test.js).
// Options: --plugin-dir <dir> (default: this checkout), --claude <path> (default: claude),
// --jobs <n> (arms at once; default 2, so the two arms of a scenario run side by side),
// --work-dir <dir> (default: the system temp folder), --keep (keep the projects and the host's
// session data), --keep-env <NAME,NAME> (session variables to pass through).
// Exit: 0 every arm valid (or the self-test passed); 1 an arm invalid (or a self-test check
// failed); 2 a usage or setup error. A development tool; no hook runs it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJsonOrDefault, writeJson } = require('./utils');
const { recordPath, switchableNames } = require('./guard-record');
const { loadScenarios } = require('./core/experiment-scenarios');
const { installedCopies, sessionEnv, writeSessionSettings } = require('./core/experiment-session');
const { runExperiment } = require('./core/experiment-run');
const { selfTest } = require('./core/experiment-self-test');
const { GUARDS_OFF_ENV } = require('./core/guards-off');

const PLUGIN_MANIFEST = path.join('.claude-plugin', 'plugin.json');
const DEFAULT_JOBS = 2;

class UsageError extends Error {}

function parseArgs(argv) {
  const args = { guard: null, scenarios: null, model: null, selfTest: false, json: false, out: null, keep: false,
    pluginDir: path.join(__dirname, '..'), claude: 'claude', jobs: DEFAULT_JOBS, workDir: os.tmpdir(), keepEnv: [] };
  const value = (index, flag) => {
    if (index >= argv.length || String(argv[index]).startsWith('--')) throw new UsageError(`${flag} needs a value`);
    return argv[index];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--guard') args.guard = value(++i, arg);
    else if (arg === '--scenarios') args.scenarios = path.resolve(value(++i, arg));
    else if (arg === '--model') args.model = value(++i, arg);
    else if (arg === '--out') args.out = path.resolve(value(++i, arg));
    else if (arg === '--plugin-dir') args.pluginDir = value(++i, arg);
    else if (arg === '--claude') args.claude = value(++i, arg);
    else if (arg === '--work-dir') args.workDir = path.resolve(value(++i, arg));
    else if (arg === '--keep-env') args.keepEnv = value(++i, arg).split(',').map(name => name.trim()).filter(Boolean);
    else if (arg === '--jobs') {
      args.jobs = Number(value(++i, arg));
      if (!Number.isInteger(args.jobs) || args.jobs < 1) throw new UsageError('--jobs must be a whole number above 0');
    } else if (arg === '--self-test') args.selfTest = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--keep') args.keep = true;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  args.pluginDir = path.resolve(args.pluginDir);
  if (!args.selfTest && (!args.guard || !args.scenarios)) throw new UsageError('--guard and --scenarios are required (or --self-test)');
  return args;
}

function pluginOf(dir) {
  const manifest = readJsonOrDefault(path.join(dir, PLUGIN_MANIFEST), null);
  if (!manifest || typeof manifest.name !== 'string' || !manifest.name) throw new UsageError(`no plugin name in ${path.join(dir, PLUGIN_MANIFEST)}`);
  return { name: manifest.name, dir };
}

// The guard must be in the record and be a check the switch turns off.
function checkGuard(guard, pluginDir, switchable = switchableNames()) {
  const file = recordPath(pluginDir);
  const record = readJsonOrDefault(file, null);
  const recorded = (record && Array.isArray(record.guards) ? record.guards : []).map(item => item && item.guard);
  if (!recorded.includes(guard)) throw new UsageError(`"${guard}" is not a guard in ${file}`);
  if (!switchable.includes(guard)) {
    throw new UsageError(`"${guard}" does not read ${GUARDS_OFF_ENV} (a script the hooks run by itself); the switch covers: ${switchable.join(', ')}`);
  }
}

function armLine(arm) {
  const parts = [
    arm.valid ? 'valid' : `INVALID (${arm.problems.join('; ')})`,
    arm.finished ? 'finished' : `not finished (${arm.end})`,
    arm.judge.notJudged ? 'not judged' : arm.judge.passed ? 'judge passed' : 'judge failed: missed failure',
    arm.guardFires.length ? `guard fired: ${arm.guardFires.map(fire => `${fire.event} ${fire.kind} "${fire.words}"`).join(', ')}` : 'guard did not fire',
  ];
  if (arm.falseBlocks.length) parts.push(`FALSE BLOCKS: ${arm.falseBlocks.map(fire => `${fire.event} "${fire.words}"`).join(', ')}`);
  parts.push(`${arm.seconds} s`, arm.model || 'model unknown');
  if (arm.cleanup) parts.push(`LEFT BEHIND: ${arm.cleanup.join('; ')}`);
  return `  ${arm.arm.padEnd(3)}: ${parts.join('; ')}`;
}

function textReport(report) {
  const lines = [`guard-experiment: ${report.guard}; plugin ${report.plugin.name} at ${report.plugin.dir}; installed copies switched off: ${report.disabledCopies.join(', ') || 'none found'}`];
  if (report.copyLookupError) lines.push(`  installed copies could not be listed: ${report.copyLookupError}`);
  for (const scenario of report.scenarios) {
    lines.push(`${scenario.name} (${scenario.control ? 'control' : 'task'})`);
    for (const arm of scenario.arms) lines.push(armLine(arm));
  }
  for (const item of report.skipped) lines.push(`skipped ${item.name}: ${item.error}`);
  lines.push(report.reading);
  return lines.join('\n');
}

function selfTestText(result) {
  return [...result.checks.map(item => `${item.passed ? 'PASS' : 'FAIL'} ${item.id} ${item.name}${item.passed ? '' : ` -- ${item.detail}`}`),
    `guard-experiment self-test: ${result.ok ? 'passed' : 'failed'}`].join('\n');
}

async function main(argv = process.argv.slice(2), overrides = {}) {
  const args = parseArgs(argv);
  if (args.selfTest) {
    const result = await selfTest(overrides);
    process.stdout.write((args.json ? JSON.stringify(result, null, 2) : selfTestText(result)) + '\n');
    return result.ok ? 0 : 1;
  }
  const plugin = pluginOf(args.pluginDir);
  checkGuard(args.guard, args.pluginDir);
  const { scenarios, skipped } = loadScenarios(args.scenarios);
  if (!scenarios.length) throw new UsageError(`no valid scenario in ${args.scenarios}${skipped.length ? `: ${skipped.map(item => `${item.name}: ${item.error}`).join('; ')}` : ''}`);
  fs.mkdirSync(args.workDir, { recursive: true });
  const workRoot = fs.mkdtempSync(path.join(args.workDir, 'crabshell-guard-experiment-'));
  try {
    const copies = installedCopies(plugin.name, { claude: args.claude, env: sessionEnv(process.env, { keepEnv: args.keepEnv }) });
    const settingsFile = writeSessionSettings(path.join(workRoot, 'session-settings.json'), copies.ids);
    const report = await runExperiment({
      guard: args.guard, plugin, scenarios, skipped, workRoot: path.join(workRoot, 'projects'), settingsFile,
      baseEnv: process.env, keepEnv: args.keepEnv, claude: args.claude, model: args.model, jobs: args.jobs, keep: args.keep,
      disabledCopies: copies.ids,
    });
    if (copies.error) report.copyLookupError = copies.error;
    if (args.out) writeJson(args.out, report);
    process.stdout.write((args.json ? JSON.stringify(report, null, 2) : textReport(report)) + '\n');
    return report.valid ? 0 : 1;
  } finally {
    if (!args.keep) {
      try { fs.rmSync(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) {
        process.stderr.write(`guard-experiment: the work folder was left at ${workRoot} (${error.message})\n`);
      }
    }
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`guard-experiment: ${error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = { checkGuard, main, parseArgs, pluginOf, textReport };
