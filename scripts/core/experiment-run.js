'use strict';

// D187_T004: one guard experiment. Every scenario runs twice, once with the guard on and once
// with CRABSHELL_GUARDS_OFF naming it, each arm in a fresh project of its own. The session,
// the fire reader, the judge and the two judgments are passed in (deps), so the self-test
// (core/experiment-self-test.js) runs this same flow with a session that needs no model.

const fs = require('fs');
const { prepareProject } = require('./experiment-scenarios');
const { purgeSessionData, runSession, sessionArgs, sessionEnv } = require('./experiment-session');
const { armOutcome, armValidity, readFires, runJudge } = require('./experiment-evidence');

const ARMS = Object.freeze([Object.freeze({ name: 'on', off: false }), Object.freeze({ name: 'off', off: true })]);
const READING = 'Each arm ran once. One run shows that the tool works; it says nothing about the guard. Compare arms over repeated runs and several scenarios before drawing a conclusion.';

const DEFAULT_DEPS = Object.freeze({ runSession, readFires, runJudge, armValidity, armOutcome, purge: purgeSessionData });

// An arm that threw: invalid, not judged; the other arms keep their results.
function brokenArm(arm, error) {
  return {
    arm: arm.name, guardsOff: arm.guardsOff, valid: false, problems: [`the arm could not run: ${error && error.message}`],
    finished: false, end: 'error', seconds: 0, model: null, answeringModels: [], turns: null,
    judge: { passed: false, exitCode: null, output: '', notJudged: true }, missedFailure: null,
    guardFires: [], falseBlocks: [], hookDenials: [], otherGuardFires: [],
  };
}

// The host's record of the session and the project, removed; what could not be removed is
// named, never thrown (a session record left behind would be counted by guard-record.js --backfill).
function cleanUp(project, options, deps, env) {
  const left = [];
  try {
    const purged = deps.purge({ claude: options.claude, project, workRoot: options.workRoot, env });
    if (purged && purged.purged === false && purged.reason) left.push(`the host's session record was not purged (${purged.reason}); guard-record.js --backfill would count it`);
  } catch (error) {
    left.push(`the host's session record was not purged (${error.message}); guard-record.js --backfill would count it`);
  }
  try { fs.rmSync(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) {
    left.push(`the project was left at ${project} (${error.message})`);
  }
  return left;
}

async function runArm(scenario, spec, options, deps) {
  const arm = { name: spec.name, guardsOff: spec.off ? [options.guard] : [] };
  const env = sessionEnv(options.baseEnv, { guardsOff: arm.guardsOff, keepEnv: options.keepEnv });
  let project = null;
  let outcome;
  try {
    project = prepareProject(scenario, options.workRoot, arm.name);
    const session = await deps.runSession({
      claude: options.claude,
      args: sessionArgs({ pluginDir: options.plugin.dir, settingsFile: options.settingsFile, model: options.model, session: scenario.session }),
      cwd: project, env, prompt: scenario.prompt, timeoutMs: scenario.session.timeoutSeconds * 1000,
    });
    const fires = deps.readFires(project);
    // The judge runs without the switch and without anything from the session.
    const judge = deps.runJudge({ scenario, project, env: sessionEnv(options.baseEnv, { keepEnv: options.keepEnv }) });
    const validity = deps.armValidity({ arm, guard: options.guard, facts: session.facts || {}, fires, plugin: options.plugin });
    outcome = deps.armOutcome({ scenario, arm, guard: options.guard, session, fires, judge, validity });
    if (session.error) outcome.problems = [...outcome.problems, `the session could not start: ${session.error}`];
    if (session.stderr && !outcome.finished) outcome.stderr = session.stderr;
  } catch (error) {
    outcome = brokenArm(arm, error);
  }
  if (project && options.keep) outcome.project = project;
  else if (project) {
    const left = cleanUp(project, options, deps, env);
    if (left.length) outcome.cleanup = left;
  }
  return outcome;
}

// Up to `jobs` arms at once, in scenario order, so the two arms of a scenario run side by side.
async function inPool(tasks, jobs) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, tasks.length)) }, worker));
  return results;
}

async function runExperiment(options, overrides = {}) {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  const startedAt = new Date().toISOString();
  const tasks = options.scenarios.flatMap(scenario => ARMS.map(spec => () => runArm(scenario, spec, options, deps)));
  const arms = await inPool(tasks, options.jobs || ARMS.length);
  const scenarios = options.scenarios.map((scenario, index) => ({
    name: scenario.name, description: scenario.description, control: scenario.control,
    arms: arms.slice(index * ARMS.length, (index + 1) * ARMS.length),
  }));
  return {
    guard: options.guard,
    plugin: options.plugin,
    disabledCopies: options.disabledCopies || [],
    requestedModel: options.model || null,
    startedAt,
    finishedAt: new Date().toISOString(),
    valid: arms.every(arm => arm.valid),
    scenarios,
    skipped: options.skipped || [],
    reading: READING,
  };
}

module.exports = { ARMS, DEFAULT_DEPS, READING, brokenArm, cleanUp, inPool, runArm, runExperiment };
