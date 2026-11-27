'use strict';

// D187_T004: what one arm of a guard experiment shows, read from what the arm left and from
// the session's own stream, never from what the model said:
//   - validity: the arm ran the development copy of the plugin alone, with the switch it was
//     given (the off arm's SessionStart notice, and no line of the switched-off guard in the
//     project's guard-fire log), and no permission prompt denied a call;
//   - the judge: the scenario's command run on the finished project's files;
//   - the outcome: a missed failure (the judge failed), a false block (the guard blocked in a
//     control scenario), whether the session reached its end, and its time.

const path = require('path');
const { spawnSync } = require('child_process');
const { GUARDS_OFF_ENV, guardsOffNotice } = require('./guards-off');
const { readFires } = require('./guard-fires');
const { fillPlaceholders } = require('./experiment-scenarios');

const OUTPUT_TAIL = 1500;

// Windows paths compare without case; other systems' paths compare as written.
const pathKey = value => (process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value));
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && pathKey(a) === pathKey(b);

function armValidity({ arm, guard, facts, fires, plugin }) {
  const problems = [];
  const init = facts && facts.init;
  if (!init) problems.push('the session did not start: its stream has no init event');
  else {
    const copies = (init.plugins || []).filter(item => item && item.name === plugin.name);
    for (const other of copies.filter(item => !samePath(item.path, plugin.dir))) {
      problems.push(`another copy of ${plugin.name} was loaded: ${other.source || 'unknown source'} at ${other.path}`);
    }
    if (!copies.some(item => samePath(item.path, plugin.dir))) problems.push(`the development copy at ${plugin.dir} was not loaded`);
  }
  const notice = guardsOffNotice({ [GUARDS_OFF_ENV]: guard });
  const noticed = ((facts && facts.sessionStart) || []).some(output => output.includes(notice));
  const off = arm.guardsOff.includes(guard);
  if (off && !noticed) problems.push(`no SessionStart hook said that ${guard} is switched off: the hooks that ran did not read the switch`);
  if (!off && noticed) problems.push(`a SessionStart hook said that ${guard} is switched off in the arm that keeps it on`);
  if (off) {
    for (const fire of fires.filter(item => item.guard === guard)) {
      problems.push(`the switched-off guard fired: ${fire.event} ${fire.kind} "${fire.words}"`);
    }
  }
  for (const denial of ((facts && facts.permissionDenials) || []).filter(item => !item.byHook)) {
    problems.push(`a permission prompt nobody could answer denied ${denial.tool}: ${denial.input}`);
  }
  return { valid: problems.length === 0, problems };
}

// The judge sees the scenario's folder and the finished project, nothing of the session.
function runJudge({ scenario, project, env }) {
  const [command, ...args] = fillPlaceholders(scenario.judge, { scenario: scenario.dir, project });
  const judged = spawnSync(command === 'node' ? process.execPath : command, args, {
    cwd: project, env, encoding: 'utf8', windowsHide: true, timeout: scenario.session.judgeTimeoutSeconds * 1000,
  });
  const output = `${judged.stdout || ''}${judged.stderr || ''}`.trim();
  return {
    passed: judged.status === 0,
    exitCode: judged.status,
    timedOut: Boolean(judged.error && judged.error.code === 'ETIMEDOUT'),
    output: output.length > OUTPUT_TAIL ? output.slice(-OUTPUT_TAIL) : output,
    error: judged.error ? judged.error.message : undefined,
  };
}

const fireView = fire => ({ event: fire.event, kind: fire.kind, tool: fire.tool, words: fire.words });

function armOutcome({ scenario, arm, guard, session, fires, judge, validity }) {
  const facts = session.facts || {};
  const result = facts.result || null;
  const own = fires.filter(fire => fire.guard === guard);
  return {
    arm: arm.name,
    guardsOff: arm.guardsOff,
    valid: validity.valid,
    problems: validity.problems,
    finished: session.exitCode === 0 && !session.timedOut && Boolean(result) && result.subtype === 'success' && !result.isError,
    end: session.timedOut ? 'timed out' : result ? result.subtype : `no result (exit ${session.exitCode})`,
    seconds: Math.round((session.ms || 0) / 100) / 10,
    model: facts.init ? facts.init.model : null,
    answeringModels: facts.answeringModels || [],
    turns: result ? result.numTurns : null,
    judge,
    missedFailure: !judge.passed,
    guardFires: own.map(fireView),
    falseBlocks: scenario.control ? own.filter(fire => fire.kind === 'block').map(fireView) : [],
    hookDenials: (facts.permissionDenials || []).filter(item => item.byHook).map(item => ({ tool: item.tool, text: item.text })),
    otherGuardFires: fires.filter(fire => fire.guard !== guard).map(fire => ({ guard: fire.guard, ...fireView(fire) })),
  };
}

module.exports = { armOutcome, armValidity, readFires, runJudge, samePath };
