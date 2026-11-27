'use strict';

// D187_T004: the guard experiment checks itself without a model. A fake guard that blocks
// every call runs through the real check runner (core/dispatch.js runChecks, which reads the
// switch) and the real fire log (core/guard-fires.js), inside the same experiment flow
// (core/experiment-run.js); only the session is a stand-in that needs no model. It passes
// only when:
//   S1 the fake guard's block in the control scenario is reported as a false block;
//   S2 with the switch the fake guard sends nothing and the off arm is valid;
//   S3 the verdict follows the files, not the answer: a finished task whose answer says it
//      failed passes, and an unfinished one whose answer claims success is a missed failure;
//   S4 an off arm in which the guard still fires is invalid;
//   S5 an arm that loaded another copy of the plugin is invalid.
// Any part of the flow can be replaced (overrides), so a test can break one and watch the
// self-test fail.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runChecks } = require('./dispatch');
const { recordFires } = require('./guard-fires');
const { GUARDS_OFF_ENV, guardsOffNotice } = require('./guards-off');
const { loadScenarios, SCENARIO_FILE } = require('./experiment-scenarios');
const { runExperiment } = require('./experiment-run');
const { writeJson } = require('../utils');

const SELF_TEST_GUARD = 'self-test-always-block';
const SELF_TEST_MODEL = 'self-test-session';
const DONE_FILE = 'done.txt';
const DONE_TEXT = 'done';

const ALWAYS_BLOCK = Object.freeze({ name: SELF_TEST_GUARD, run: () => ({ reason: 'Self-test guard: blocks every call.' }) });

const JUDGE = [
  "'use strict';",
  '// Self-test judge: the task is done when the project holds done.txt with the word done.',
  "const fs = require('fs');",
  "const path = require('path');",
  `let text = '';`,
  `try { text = fs.readFileSync(path.join(process.argv[2], '${DONE_FILE}'), 'utf8').trim(); } catch {}`,
  `console.log(text === '${DONE_TEXT}' ? 'PASS ${DONE_FILE}' : 'FAIL ${DONE_FILE} missing or wrong');`,
  `process.exit(text === '${DONE_TEXT}' ? 0 : 1);`,
  '',
].join('\n');

// Two scenarios whose prompt tells the stand-in session what to do and what to answer: the
// control finishes its task and says it failed; the task leaves its work undone and claims
// success.
function writeScenarios(root) {
  const plans = {
    control: { control: true, plan: { write: { [DONE_FILE]: DONE_TEXT }, answer: 'I could not finish this task.' } },
    task: { control: false, plan: { write: {}, answer: 'Done. Every check passes.' } },
  };
  for (const [name, item] of Object.entries(plans)) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'judge.js'), JUDGE);
    writeJson(path.join(dir, SCENARIO_FILE), { control: item.control, prompt: JSON.stringify(item.plan), judge: ['node', '{scenario}/judge.js', '{project}'] });
  }
  return loadScenarios(root).scenarios;
}

// The stand-in session: does what its prompt says, sends one tool call through the real check
// runner with the switch it was given (or without it, when it ignores the switch), records
// what was sent, and reports what a session's stream would.
function standInSession(plugin, { ignoreSwitch = false, extraCopy = null } = {}) {
  return async ({ cwd, env, prompt }) => {
    const started = Date.now();
    const plan = JSON.parse(prompt);
    for (const [relative, text] of Object.entries(plan.write || {})) fs.writeFileSync(path.join(cwd, relative), text);
    const given = env[GUARDS_OFF_ENV] || '';
    const payload = { hook_event_name: 'PreToolUse', session_id: 'self-test', tool_name: 'Write', tool_use_id: `self-test-${path.basename(cwd)}`,
      tool_input: { file_path: path.join(cwd, DONE_FILE), content: DONE_TEXT } };
    const collected = await runChecks([ALWAYS_BLOCK], payload, cwd, { env: { [GUARDS_OFF_ENV]: ignoreSwitch ? '' : given } });
    recordFires(cwd, { host: 'claude', event: 'PreToolUse', fired: collected.fired, payload });
    const plugins = [{ name: plugin.name, path: plugin.dir, source: `${plugin.name}@inline` }, ...(extraCopy ? [extraCopy] : [])];
    return {
      exitCode: 0, timedOut: false, ms: Date.now() - started, stderr: '',
      facts: {
        init: { model: SELF_TEST_MODEL, plugins },
        sessionStart: [guardsOffNotice({ [GUARDS_OFF_ENV]: given })],
        answeringModels: [SELF_TEST_MODEL],
        result: { subtype: 'success', isError: false, numTurns: 1, text: plan.answer },
        permissionDenials: [],
      },
    };
  };
}

const armOf = (report, scenario, arm) => {
  const found = (report.scenarios.find(item => item.name === scenario) || { arms: [] }).arms.find(item => item.arm === arm);
  return found || { problems: [], guardFires: [], falseBlocks: [], judge: {} };
};
const brief = arm => JSON.stringify({ valid: arm.valid, problems: arm.problems, fires: arm.guardFires, falseBlocks: arm.falseBlocks,
  judge: arm.judge && arm.judge.passed, missedFailure: arm.missedFailure });

async function selfTest(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-guard-experiment-self-test-'));
  try {
    const scenarios = writeScenarios(path.join(root, 'scenarios'));
    const plugin = { name: 'self-test-plugin', dir: path.join(root, 'plugin') };
    const options = (only, session) => ({ guard: SELF_TEST_GUARD, plugin, scenarios: scenarios.filter(item => only.includes(item.name)),
      // One arm at a time: runChecks swaps process.stdout while checks run, and the stand-in
      // sessions run it inside this one process (a real session is a process of its own).
      workRoot: path.join(root, 'projects'), settingsFile: path.join(root, 'settings.json'), baseEnv: process.env, jobs: 1,
      session });
    const run = (only, session) => runExperiment(options(only, session), { purge: () => ({ purged: false }), ...overrides, runSession: session });

    const main = await run(['control', 'task'], standInSession(plugin));
    const ignored = await run(['control'], standInSession(plugin, { ignoreSwitch: true }));
    const other = { name: plugin.name, path: path.join(root, 'installed-copy'), source: `${plugin.name}@marketplace` };
    const doubled = await run(['control'], standInSession(plugin, { extraCopy: other }));

    const controlOn = armOf(main, 'control', 'on');
    const controlOff = armOf(main, 'control', 'off');
    const tasks = ['on', 'off'].map(arm => armOf(main, 'task', arm));
    const controls = [controlOn, controlOff];
    const checks = [
      { id: 'S1', name: 'a guard that always blocks is reported as a false block in the control scenario',
        passed: controlOn.falseBlocks.some(fire => fire.kind === 'block'), detail: brief(controlOn) },
      { id: 'S2', name: 'with the switch the guard sends nothing and the off arm is valid',
        passed: controlOff.valid === true && controlOff.guardFires.length === 0 && controlOff.falseBlocks.length === 0, detail: brief(controlOff) },
      { id: 'S3', name: 'the verdict follows the files, not the answer',
        passed: controls.every(arm => arm.judge.passed === true && arm.missedFailure === false)
          && tasks.every(arm => arm.judge.passed === false && arm.missedFailure === true),
        detail: [...controls, ...tasks].map(brief).join(' | ') },
      { id: 'S4', name: 'an off arm in which the switched-off guard still fires is invalid',
        passed: armOf(ignored, 'control', 'off').valid === false
          && armOf(ignored, 'control', 'off').problems.some(problem => problem.includes(SELF_TEST_GUARD) || problem.includes('switched-off guard fired')),
        detail: brief(armOf(ignored, 'control', 'off')) },
      { id: 'S5', name: 'an arm that loaded another copy of the plugin is invalid',
        passed: ['on', 'off'].every(arm => armOf(doubled, 'control', arm).valid === false
          && armOf(doubled, 'control', arm).problems.some(problem => problem.includes(other.path))),
        detail: ['on', 'off'].map(arm => brief(armOf(doubled, 'control', arm))).join(' | ') },
    ];
    return { ok: checks.every(item => item.passed), checks };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { SELF_TEST_GUARD, selfTest, standInSession };
