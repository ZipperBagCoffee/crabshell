'use strict';

// D187_T004: the guard switch (CRABSHELL_GUARDS_OFF, core/guards-off.js) and the guard
// experiment tool (scripts/guard-experiment.js). Real hook processes on temporary projects;
// no model session runs here — the tool's self-test stands in for the session.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const h = require('./testlib/hook-harness');
const { readFires } = require('./core/guard-fires');
const { GUARDS_OFF_ENV, guardsOff, guardsOffNotice } = require('./core/guards-off');
const control = require('./core/completion-control');
const { selfTest } = require('./core/experiment-self-test');
const { loadScenarios, validateScenario } = require('./core/experiment-scenarios');
const { createStreamReader, sessionArgs, sessionEnv } = require('./core/experiment-session');
const { armOutcome, armValidity } = require('./core/experiment-evidence');
const experiment = require('./guard-experiment');

const report = h.createReporter('guard-experiment');
const ROOT = path.join(__dirname, '..');
const SEEDS = path.join(__dirname, 'fixtures', 'guard-experiments');
const root = h.makeWorkRoot('guard-experiment');
const fwd = h.forward;
const off = names => ({ [GUARDS_OFF_ENV]: names });
let projects = 0;
const project = () => h.makeProject(root, `p${++projects}`);
const guardsIn = dir => readFires(dir).map(fire => `${fire.guard}:${fire.kind}`);
const denied = result => { try { return JSON.parse(result.stdout.trim()).hookSpecificOutput.permissionDecision === 'deny'; } catch { return false; } };

// ---- AC1: the switch skips the named guard only -----------------------------------------

report.check('AC1 the switch value is a list of names, spaces and repeats dropped',
  JSON.stringify(guardsOff(off(' docs-guard, path-guard,,docs-guard '))) === JSON.stringify(['docs-guard', 'path-guard'])
  && guardsOff({}).length === 0 && guardsOffNotice({}) === '');

{
  // A document written without its skill is denied by docs-guard; a write to the skill flag
  // file is denied by path-guard (the cases of _test-guard-fires.js and _test-path-guard.js).
  const docsPayload = dir => ({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Write', tool_use_id: 'w1',
    tool_input: { file_path: fwd(path.join(dir, '.crabshell', 'ticket', 'P900_T001-x.md')), content: '# x\n' } });
  const flagPayload = dir => ({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Write', tool_use_id: 'w2',
    tool_input: { file_path: fwd(path.join(dir, '.crabshell', 'memory', 'skill-active.json')), content: '{}' } });
  const pre = (payload, dir, env) => h.runHook(root, 'adapters/claude/pre-tool-use.js', [], payload, dir, env);

  const onDir = project();
  const on = pre(docsPayload(onDir), onDir, off(''));
  report.check('AC1 with nothing switched off, docs-guard denies the document write and leaves its line',
    denied(on) && guardsIn(onDir).includes('docs-guard:block'), on.stdout.slice(0, 200));

  const offDir = project();
  const silenced = pre(docsPayload(offDir), offDir, off('docs-guard'));
  report.check('AC1 with docs-guard switched off, the same write is not denied and docs-guard leaves no line',
    silenced.status === 0 && !denied(silenced) && !guardsIn(offDir).some(item => item.startsWith('docs-guard:')),
    `${silenced.stdout.slice(0, 200)} ${guardsIn(offDir).join(',')}`);

  const otherDir = project();
  const other = pre(docsPayload(otherDir), otherDir, off('path-guard'));
  report.check('AC1 with another guard switched off, docs-guard still denies the write',
    denied(other) && guardsIn(otherDir).includes('docs-guard:block'), other.stdout.slice(0, 200));

  const flagDir = project();
  const flag = pre(flagPayload(flagDir), flagDir, off('docs-guard'));
  report.check('AC1 with docs-guard switched off, path-guard still denies a write to the skill flag file',
    denied(flag) && guardsIn(flagDir).includes('path-guard:block'), `${flag.stdout.slice(0, 200)} ${guardsIn(flagDir).join(',')}`);
}

{
  // A Stop while a light workflow is still open is blocked by completion-controller.
  const openWorkflow = dir => {
    const worklog = path.join(dir, '.crabshell', 'worklog');
    fs.mkdirSync(worklog, { recursive: true });
    fs.writeFileSync(path.join(worklog, 'W001-fixture.md'), '---\nid: W001\nstatus: in-progress\n---\n# W001\n\n## Task Contract (internal)\n- fixture\n');
    control.noteExecutionAuthorization(dir, { session_id: 's1', prompt_id: 'p1', prompt: 'Implement the fixture.' });
  };
  const transcript = path.join(root, 'stop-transcript.jsonl');
  h.writeTranscript(transcript, [{ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'Implement the fixture.' } }, h.assistantLine('Done.')]);
  const stop = (dir, env) => h.runHook(root, 'completion-controller.js', [], { hook_event_name: 'Stop', session_id: 's1', prompt_id: 'p1',
    stop_hook_active: false, transcript_path: transcript, last_assistant_message: 'Done.' }, dir, env);
  const blocked = (result) => { try { return JSON.parse(result.stdout.trim()).decision === 'block'; } catch { return false; } };

  const onDir = project(); openWorkflow(onDir);
  const on = stop(onDir, off(''));
  report.check('AC1 with nothing switched off, completion-controller blocks the Stop of an open workflow',
    blocked(on) && guardsIn(onDir).includes('completion-controller:block'), on.stdout.slice(0, 200));

  const offDir = project(); openWorkflow(offDir);
  const silenced = stop(offDir, off('completion-controller'));
  report.check('AC1 with completion-controller switched off, that Stop is not blocked and it leaves no line',
    !blocked(silenced) && silenced.status === 0 && !guardsIn(offDir).some(item => item.startsWith('completion-controller:')),
    `${silenced.stdout.slice(0, 200)} ${guardsIn(offDir).join(',')}`);

  const otherDir = project(); openWorkflow(otherDir);
  const other = stop(otherDir, off('doc-watchdog,best-answer'));
  report.check('AC1 with other Stop checks switched off, completion-controller still blocks',
    blocked(other) && guardsIn(otherDir).includes('completion-controller:block'), other.stdout.slice(0, 200));
}

{
  // The SessionStart line on both hosts.
  const notice = guardsOffNotice(off('completion-controller'));
  const contextOf = result => { try { return JSON.parse(result.stdout.trim()).hookSpecificOutput.additionalContext; } catch { return ''; } };
  // What the host shows the person (Claude's systemMessage), not only what the model is told.
  const shownOf = result => { try { return JSON.parse(result.stdout.trim()).systemMessage || ''; } catch { return ''; } };
  const claudeDir = project();
  const start = env => h.runHook(root, 'load-memory.js', [], { hook_event_name: 'SessionStart', source: 'startup', session_id: 's1', cwd: claudeDir }, claudeDir, env);
  const codexDir = project();
  const codexStart = env => h.runHook(root, 'adapters/codex/session-start.js', [], { hook_event_name: 'SessionStart', source: 'startup', session_id: 's1', cwd: codexDir }, codexDir, env);
  report.check('AC1 a session started with the switch says so in one SessionStart line, on Claude and Codex; without it, not',
    contextOf(start(off('completion-controller'))).includes(notice) && !contextOf(start(off(''))).includes(notice)
    && contextOf(codexStart(off('completion-controller'))).includes(notice) && !contextOf(codexStart(off(''))).includes(notice),
    notice);
  report.check('AC1 on Claude the person is shown the same line (systemMessage); without the switch nothing is shown',
    shownOf(start(off('completion-controller'))) === notice && shownOf(start(off(''))) === '', notice);
}

// ---- AC2: the self-test catches a false block, and fails when the harness cannot ---------

const failedChecks = result => result.checks.filter(item => !item.passed).map(item => item.id);

(async () => {
  const sound = await selfTest();
  report.check('AC2 the self-test passes on the real harness', sound.ok && failedChecks(sound).length === 0, JSON.stringify(failedChecks(sound)));

  const ignoresControl = await selfTest({ armOutcome: args => ({ ...armOutcome(args), falseBlocks: [] }) });
  report.check('AC2 a harness that does not report false blocks fails the self-test at S1',
    !ignoresControl.ok && failedChecks(ignoresControl).includes('S1'), JSON.stringify(failedChecks(ignoresControl)));

  const blindToFires = await selfTest({ readFires: () => [] });
  report.check('AC2 a harness that does not read the fire log fails the self-test at S1 and S4',
    !blindToFires.ok && ['S1', 'S4'].every(id => failedChecks(blindToFires).includes(id)), JSON.stringify(failedChecks(blindToFires)));

  const readsAnswer = await selfTest({ armOutcome: args => {
    const outcome = armOutcome(args);
    return { ...outcome, missedFailure: !/done|passes/i.test(args.session.facts.result.text) };
  } });
  report.check('AC2 a harness whose verdict follows the model\'s answer fails the self-test at S3',
    !readsAnswer.ok && failedChecks(readsAnswer).includes('S3'), JSON.stringify(failedChecks(readsAnswer)));

  const ignoresFiles = await selfTest({ runJudge: () => ({ passed: true, exitCode: 0, output: '' }) });
  report.check('AC2 a judge that ignores the files fails the self-test at S3',
    !ignoresFiles.ok && failedChecks(ignoresFiles).includes('S3'), JSON.stringify(failedChecks(ignoresFiles)));

  const cli = spawnSync(process.execPath, [path.join(__dirname, 'guard-experiment.js'), '--self-test', '--json'],
    { encoding: 'utf8', env: h.hookEnv(root, root), timeout: 120000, windowsHide: true });
  let cliResult = null;
  try { cliResult = JSON.parse(cli.stdout); } catch {}
  report.check('AC2 node scripts/guard-experiment.js --self-test exits 0 with every check passed',
    cli.status === 0 && cliResult && cliResult.ok === true, `exit ${cli.status} ${(cli.stdout || cli.stderr).slice(0, 300)}`);

  // ---- the parts the experiment run uses (AC3 without a model) -------------------------

  const seeds = loadScenarios(SEEDS);
  report.check('AC3 the seed folder holds a task and a control scenario, none skipped',
    JSON.stringify(seeds.scenarios.map(item => [item.name, item.control])) === JSON.stringify([['control-plain-task', true], ['self-verified-fix', false]])
    && seeds.skipped.length === 0, JSON.stringify(seeds.skipped));

  {
    const mixed = path.join(root, 'mixed');
    fs.mkdirSync(path.join(mixed, 'broken'), { recursive: true });
    fs.writeFileSync(path.join(mixed, 'broken', 'scenario.json'), JSON.stringify({ prompt: 'x' }));
    fs.cpSync(path.join(SEEDS, 'control-plain-task'), path.join(mixed, 'kept'), { recursive: true });
    const loaded = loadScenarios(mixed);
    report.check('AC3 a broken scenario is skipped with its reason and the valid one beside it still loads',
      loaded.scenarios.map(item => item.name).join() === 'kept' && loaded.skipped.some(item => item.name === 'broken' && /judge/.test(item.error)),
      JSON.stringify(loaded.skipped));
    report.check('AC3 a scenario file path that leaves the project is refused',
      /not a path inside the project/.test(validateScenario({ prompt: 'x', judge: ['node'], files: { '../x.txt': 'x' } }, mixed).error || ''));
  }

  {
    // Each seed's judge fails on the untouched project and passes once its task is done.
    const judge = (scenario, dir) => spawnSync(process.execPath, [path.join(SEEDS, scenario, 'judge.js'), dir], { encoding: 'utf8', windowsHide: true }).status;
    let copies = 0;
    const copy = scenario => { const dir = path.join(root, `judge-${scenario}-${++copies}`); fs.cpSync(path.join(SEEDS, scenario, 'project'), dir, { recursive: true }); return dir; };
    const price = copy('self-verified-fix');
    const priceBefore = judge('self-verified-fix', price);
    fs.writeFileSync(path.join(price, 'price.js'), "function parsePrice(t) { const s = String(t).replace(/[$,\\s]/g, ''); const m = /^\\((.*)\\)$/.exec(s); return m ? -parseFloat(m[1]) : parseFloat(s); }\nmodule.exports = { parsePrice };\n");
    const partly = copy('self-verified-fix');
    fs.writeFileSync(path.join(partly, 'price.js'), "function parsePrice(t) { return parseFloat(String(t).replace(/[$,\\s]/g, '')); }\nmodule.exports = { parsePrice };\n");
    const greet = copy('control-plain-task');
    const greetBefore = judge('control-plain-task', greet);
    fs.writeFileSync(path.join(greet, 'greet.js'), "module.exports = { greet: name => `Hello, ${name}!` };\n");
    report.check('AC3 each seed judge fails the untouched project, fails a fix of only the named bug, and passes the finished task',
      priceBefore === 1 && judge('self-verified-fix', partly) === 1 && judge('self-verified-fix', price) === 0
      && greetBefore === 1 && judge('control-plain-task', greet) === 0);
  }

  {
    const args = sessionArgs({ pluginDir: 'D:/dev/plugin', settingsFile: 'D:/s.json', model: 'm1',
      session: { permissionMode: 'auto', allowedTools: [], maxTurns: 5 } });
    const pairs = (flag, value) => args.some((item, index) => item === flag && args[index + 1] === value);
    report.check('AC3 the session loads the plugin from its folder with the settings file, answers no prompt, and never skips permissions',
      pairs('--plugin-dir', 'D:/dev/plugin') && pairs('--settings', 'D:/s.json') && pairs('--permission-prompts', 'none') && pairs('--model', 'm1')
      && !args.some(item => /dangerously|bypassPermissions/i.test(item)), args.join(' '));

    const base = { PATH: 'p', CLAUDE_CONFIG_DIR: 'c', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_USE_BEDROCK: '1',
      CRABSHELL_HOOK_CAPTURE_DIR: 'd', [GUARDS_OFF_ENV]: 'leaked', CLAUDE_PROJECT_DIR: 'q' };
    const onEnv = sessionEnv(base, { keepEnv: ['CLAUDE_CODE_USE_BEDROCK'] });
    const offEnv = sessionEnv(base, { guardsOff: ['completion-controller'] });
    report.check('AC3 an arm\'s environment drops what ties it to the calling session, keeps what is asked, and carries only its own switch',
      JSON.stringify(Object.keys(onEnv).sort()) === JSON.stringify(['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CONFIG_DIR', 'PATH'])
      && offEnv[GUARDS_OFF_ENV] === 'completion-controller' && !('CLAUDECODE' in offEnv), JSON.stringify({ onEnv, offEnv }));
  }

  {
    // An arm from a stream: two copies loaded, a hook deny, and a call the permissions denied.
    const dev = path.join(root, 'dev-plugin');
    const installed = path.join(root, 'installed-plugin');
    const hookReason = 'Direct write to .crabshell/ticket/ blocked: open the document skill first.';
    const lines = [
      { type: 'system', subtype: 'init', model: 'm1', plugins: [{ name: 'crabshell', path: dev, source: 'crabshell@inline' }, { name: 'crabshell', path: installed, source: 'crabshell@market' }] },
      { type: 'system', subtype: 'hook_response', hook_event: 'SessionStart', stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: guardsOffNotice(off('docs-guard')) } }) },
      { type: 'system', subtype: 'hook_response', hook_event: 'PreToolUse', stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: hookReason } }) },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: hookReason }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'Permission for this tool use was denied.' }] } },
      { type: 'result', subtype: 'success', is_error: false, num_turns: 3, result: 'ok',
        permission_denials: [{ tool_name: 'Write', tool_use_id: 't1', tool_input: {} }, { tool_name: 'Bash', tool_use_id: 't2', tool_input: { command: 'rm x' } }] },
    ];
    const reader = createStreamReader();
    for (const line of lines) reader.line(JSON.stringify(line));
    reader.line('not json');
    const facts = reader.facts();
    const validity = armValidity({ arm: { name: 'off', guardsOff: ['docs-guard'] }, guard: 'docs-guard', facts,
      fires: [{ guard: 'docs-guard', kind: 'block', event: 'PreToolUse', words: 'Direct write to' }], plugin: { name: 'crabshell', dir: dev } });
    const has = text => validity.problems.some(problem => problem.includes(text));
    report.check('AC3 an off arm is invalid when another copy loaded, the switched-off guard fired, or a permission prompt denied a call; a hook deny is not a problem',
      !validity.valid && has(installed) && has('switched-off guard fired') && has('denied Bash') && !has('denied Write')
      && facts.permissionDenials.find(item => item.tool === 'Write').byHook === true, JSON.stringify(validity.problems));
    const quiet = createStreamReader();
    quiet.line(JSON.stringify({ type: 'system', subtype: 'init', model: 'm1', plugins: [{ name: 'crabshell', path: dev }] }));
    const noNotice = armValidity({ arm: { name: 'off', guardsOff: ['docs-guard'] }, guard: 'docs-guard', facts: quiet.facts(), fires: [], plugin: { name: 'crabshell', dir: dev } });
    const onArm = armValidity({ arm: { name: 'on', guardsOff: [] }, guard: 'docs-guard', facts: quiet.facts(), fires: [{ guard: 'docs-guard', kind: 'block' }], plugin: { name: 'crabshell', dir: dev } });
    report.check('AC3 an off arm without the SessionStart line is invalid (the switch was not read); an on arm with the development copy alone is valid',
      !noNotice.valid && noNotice.problems.some(problem => problem.includes('did not read the switch')) && onArm.valid, JSON.stringify({ noNotice, onArm }));
  }

  {
    // Cleanup never discards a result: a purge that failed and a folder that could not be
    // removed are named in the arm.
    const { cleanUp, brokenArm } = require('./core/experiment-run');
    const held = path.join(root, 'held-project');
    fs.mkdirSync(held, { recursive: true });
    const left = cleanUp(held, { workRoot: root }, { purge: () => { throw new Error('purge broke'); } }, {});
    const broken = brokenArm({ name: 'on', guardsOff: [] }, new Error('spawn failed'));
    report.check('AC3 cleanup names a failed purge instead of throwing, and an arm that threw is invalid and not judged',
      left.some(item => item.includes('purge broke')) && !fs.existsSync(held)
      && broken.valid === false && broken.judge.notJudged === true && broken.problems.some(item => item.includes('spawn failed')), JSON.stringify({ left, broken }));
  }

  {
    const throws = (guard, pattern) => { try { experiment.checkGuard(guard, ROOT); return false; } catch (error) { return pattern.test(error.message); } };
    let accepted = true;
    try { experiment.checkGuard('completion-controller', ROOT); } catch { accepted = false; }
    report.check('AC3 --guard takes a recorded guard the switch covers, and refuses a hook script or an unknown name',
      accepted && throws('inject-rules', /does not read/) && throws('no-such-guard', /not a guard/));
  }

  // ---- AC4: the audit rule and the manual point to the tool -----------------------------

  const claudeMd = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const auditLine = claudeMd.split('\n').find(line => line.includes('**Model upgrade audit')) || '';
  const manual = fs.readFileSync(path.join(ROOT, 'USER-MANUAL.md'), 'utf8');
  report.check('AC4 the CLAUDE.md audit line runs the experiment tool and says the seed run only proves the tool',
    auditLine.includes('scripts/guard-experiment.js') && auditLine.includes(GUARDS_OFF_ENV) && /seed/i.test(auditLine), auditLine.slice(0, 200));
  report.check('AC4 USER-MANUAL describes the switch and the experiment tool',
    manual.includes(GUARDS_OFF_ENV) && manual.includes('scripts/guard-experiment.js') && manual.includes('--self-test'));

  report.finish();
})().catch(error => {
  report.check('the test ran to its end', false, error && error.stack);
  report.finish();
});
