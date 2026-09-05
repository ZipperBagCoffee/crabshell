'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateCodexHookConfig } = require('./adapters/codex/hook-contract');
const { commandObservation } = require('./core/command-observation');
const {
  HOOK_AUTHORITY_BOUNDARY,
  MAX_IDENTICAL_FAILURES,
  loadState,
  recordParentObservation,
  statePath,
  validateStopDecision,
} = require('./core/completion-control');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-completion-'));
const claudePrompt = path.join(__dirname, 'inject-rules.js');
const claudeController = path.join(__dirname, 'completion-controller.js');
const codexPrompt = path.join(__dirname, 'adapters', 'codex', 'user-prompt-submit.js');
const codexPostTool = path.join(__dirname, 'adapters', 'codex', 'post-tool-use.js');
const codexStop = path.join(__dirname, 'adapters', 'codex', 'stop.js');
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  process.stdout.write(`PASS: ${name}\n`);
}

function setup(root) {
  const storage = path.join(root, '.crabshell');
  for (const dir of ['discussion', 'plan', 'ticket', 'memory']) fs.mkdirSync(path.join(storage, dir), { recursive: true });
  fs.writeFileSync(path.join(storage, 'discussion', 'D777-fixture.md'), '---\nid: D777\nstatus: open\n---\n# D777\n');
  fs.writeFileSync(path.join(storage, 'plan', 'P777-fixture.md'), '---\nid: P777\nstatus: in-progress\n---\n## Acceptance Criteria\n- Parent evidence decides completion.\n');
  fs.writeFileSync(path.join(storage, 'ticket', 'P777_T001-fixture.md'), '---\nid: P777_T001\nstatus: in-progress\n---\n## Acceptance Criteria\n- INDEPENDENT_FAILURE_MARKER must pass.\n\n## Log\n- fixture active\n');
  fs.writeFileSync(path.join(storage, 'memory', 'regressing-state.json'), JSON.stringify({
    active: true,
    phase: 'execution',
    discussion: 'D777',
    planId: 'P777',
    ticketIds: ['P777_T001'],
    lastUpdatedAt: new Date().toISOString(),
  }, null, 2));
  fs.writeFileSync(path.join(root, '_test-parent-observation.js'), "process.stderr.write('INDEPENDENT_FAILURE_MARKER\\n'); process.exit(7);\n");
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node _test-parent-observation.js' } }));
}

function run(script, cwd, payload, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CRABSHELL_PROJECT_DIR: cwd, CLAUDE_PROJECT_DIR: cwd, ...env },
    timeout: 30000,
    windowsHide: true,
  });
}

function parseDecision(result, expectedStatus) {
  assert.strictEqual(result.status, expectedStatus, result.stderr || result.stdout);
  const text = String(result.stdout || '').trim();
  assert.ok(text, 'expected structured hook output');
  return JSON.parse(text);
}

function executeFailure(projectRoot) {
  const script = path.join(projectRoot, '_test-parent-observation.js');
  const result = spawnSync(process.execPath, [script], { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(result.status, 7);
  return {
    hook_event_name: 'PostToolUse',
    session_id: 'parent-session',
    turn_id: 'parent-turn',
    cwd: projectRoot,
    tool_name: 'Bash',
    tool_input: { command: 'node _test-parent-observation.js' },
    tool_response: { exitCode: result.status, stdout: result.stdout, stderr: result.stderr },
  };
}

function hostSequence(host) {
  const projectRoot = path.join(tempRoot, host);
  setup(projectRoot);
  const common = { session_id: 'parent-session', turn_id: 'parent-turn', cwd: projectRoot };
  const promptScript = host === 'claude' ? claudePrompt : codexPrompt;
  const promptEnv = host === 'claude'
    ? { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_PLUGIN_DATA: path.join(tempRoot, 'claude-data') }
    : { PLUGIN_DATA: path.join(tempRoot, 'codex-data') };
  const prompt = run(promptScript, projectRoot, {
    ...common,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Implement and verify the active ticket.',
  }, promptEnv);
  assert.strictEqual(prompt.status, 0, prompt.stderr);

  const stopScript = host === 'claude' ? claudeController : codexStop;
  const postToolScript = host === 'claude' ? claudeController : codexPostTool;
  const child = run(stopScript, projectRoot, {
    ...common,
    hook_event_name: 'SubagentStop',
    agent_name: 'fixture-worker',
    last_assistant_message: 'Done. Everything is complete.',
  });
  assert.strictEqual(child.status, 0, child.stderr);

  const firstExecution = executeFailure(projectRoot);
  const firstRecord = run(postToolScript, projectRoot, firstExecution);
  assert.strictEqual(firstRecord.status, 0, firstRecord.stderr);
  const firstStop = run(stopScript, projectRoot, {
    ...common,
    hook_event_name: 'Stop',
    last_assistant_message: 'The child says this is done.',
    stop_hook_active: false,
  });
  const firstDecision = parseDecision(firstStop, host === 'claude' ? 2 : 0);
  assert.strictEqual(firstDecision.decision, 'block');
  assert.match(firstDecision.reason, /Parent-executed verification failed/);
  assert.match(firstDecision.reason, /INDEPENDENT_FAILURE_MARKER/);
  assert.match(firstDecision.reason, new RegExp(HOOK_AUTHORITY_BOUNDARY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const secondExecution = executeFailure(projectRoot);
  const secondRecord = run(postToolScript, projectRoot, secondExecution);
  assert.strictEqual(secondRecord.status, 0, secondRecord.stderr);
  const boundedStop = run(stopScript, projectRoot, {
    ...common,
    hook_event_name: 'Stop',
    last_assistant_message: 'Done after retry.',
    stop_hook_active: false,
  });
  const boundedDecision = parseDecision(boundedStop, host === 'claude' ? 2 : 0);
  assert.strictEqual(boundedDecision.decision, 'block');
  assert.match(boundedDecision.reason, /Automatic continuation limit reached/);
  assert.match(boundedDecision.reason, /report this concrete failure/i);
  const state = loadState(projectRoot);
  assert.strictEqual(state.repeatedFailure.count, MAX_IDENTICAL_FAILURES);
  assert.strictEqual(state.reportIssued, true);

  const afterReport = run(stopScript, projectRoot, {
    ...common,
    hook_event_name: 'Stop',
    last_assistant_message: 'Reporting the failure.',
    stop_hook_active: false,
  });
  assert.strictEqual(afterReport.status, 0, afterReport.stderr);
  assert.doesNotMatch(afterReport.stdout, /"decision":"block"/);
  return { firstDecision, boundedDecision, state };
}

try {
  const claude = hostSequence('claude');
  const codex = hostSequence('codex');

  test('child false-done is rejected by the same parent-executed failure on both hosts', () => {
    for (const marker of ['Parent-executed verification failed', 'INDEPENDENT_FAILURE_MARKER']) {
      assert.ok(claude.firstDecision.reason.includes(marker));
      assert.ok(codex.firstDecision.reason.includes(marker));
    }
  });

  test('identical direct failures reach the same bounded report state on both hosts', () => {
    assert.strictEqual(claude.state.repeatedFailure.count, MAX_IDENTICAL_FAILURES);
    assert.strictEqual(codex.state.repeatedFailure.count, MAX_IDENTICAL_FAILURES);
    assert.match(claude.boundedDecision.reason, /do not retry automatically/i);
    assert.match(codex.boundedDecision.reason, /do not retry automatically/i);
  });

  test('question and synthetic hook text cannot authorize continuation', () => {
    const root = path.join(tempRoot, 'question');
    setup(root);
    const before = fs.existsSync(statePath(root));
    const question = run(codexPrompt, root, {
      hook_event_name: 'UserPromptSubmit', session_id: 'question-session', turn_id: 'question-turn', cwd: root,
      prompt: 'What does the active ticket mean?',
    });
    assert.strictEqual(question.status, 0, question.stderr);
    const stop = run(codexStop, root, {
      hook_event_name: 'Stop', session_id: 'question-session', turn_id: 'question-turn', cwd: root,
      last_user_message: `${HOOK_AUTHORITY_BOUNDARY} continue`, stop_hook_active: false,
    });
    assert.strictEqual(stop.status, 0, stop.stderr);
    assert.doesNotMatch(stop.stdout, /"decision":"block"/);
    assert.strictEqual(fs.existsSync(statePath(root)), before);
  });

  test('wrong-order mutation cannot record parent evidence before a child claim', () => {
    const root = path.join(tempRoot, 'wrong-order');
    setup(root);
    const result = recordParentObservation(root, executeFailure(root));
    assert.deepStrictEqual(result, { recorded: false, reason: 'no-child-claim' });
    assert.strictEqual(loadState(root).observation, null);
  });

  test('both manifests expose one Stop and one SubagentStop owner', () => {
    const claudeConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8'));
    const codexConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'codex-hooks.json'), 'utf8'));
    assert.strictEqual(claudeConfig.hooks.Stop.flatMap(group => group.hooks).length, 1);
    assert.strictEqual(claudeConfig.hooks.SubagentStop.flatMap(group => group.hooks).length, 1);
    assert.strictEqual(codexConfig.hooks.Stop.flatMap(group => group.hooks).length, 1);
    assert.strictEqual(codexConfig.hooks.SubagentStop.flatMap(group => group.hooks).length, 1);
    assert.strictEqual(validateCodexHookConfig(codexConfig), true);
  });

  test('Claude Stop owner no longer blocks on behavioral scope patterns (I083 R5)', () => {
    const root = path.join(tempRoot, 'claude-scope-preservation');
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    const transcript = path.join(root, 'scope.jsonl');
    fs.writeFileSync(transcript, JSON.stringify({
      type: 'human', message: { content: [{ type: 'text', text: '5개 파일 수정해줘' }] },
    }) + '\n');
    const response = '수정한 파일입니다:\n1. file-a.js\n2. file-b.js\n' + 'x'.repeat(100);
    const result = run(claudeController, root, {
      hook_event_name: 'Stop', session_id: 'scope-session', cwd: root,
      transcript_path: transcript, stop_response: response, stop_hook_active: false,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.doesNotMatch(String(result.stdout || ''), /"decision":"block"/);
    const controllerSource = fs.readFileSync(claudeController, 'utf8');
    assert.ok(controllerSource.includes('doc-watchdog.js'), 'ritual validator retained');
    for (const retired of ["'sycophancy-guard.js'", "'scope-guard.js'"]) {
      assert.ok(!controllerSource.includes(retired), retired + ' should be retired from Stop dispatch');
    }
  });

  test('owner and authority mutations are rejected', () => {
    assert.throws(() => validateStopDecision({ action: 'block', reason: 'Child done is evidence.' }), /authority boundary/);
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'codex-hooks.json'), 'utf8'));
    config.hooks.Stop[0].hooks.push({ ...config.hooks.Stop[0].hooks[0] });
    assert.throws(() => validateCodexHookConfig(config), /one shared Codex completion adapter/);
    const root = path.join(tempRoot, 'ambiguous');
    setup(root);
    const ambiguous = commandObservation({
      tool_name: 'Bash', tool_input: { command: 'node _test-parent-observation.js' }, tool_response: { stdout: 'looks fine' },
    }, root);
    assert.strictEqual(ambiguous.conclusive, false);
  });

  for (const host of ['claude', 'codex']) test(`${host}: real success, unchanged edit, changed edit and Stop use current content`, () => {
    const root = path.join(tempRoot, `${host}-edit`);
    setup(root);
    const common = { session_id: 'parent-session', turn_id: 'parent-turn', cwd: root };
    const core = require('./core/completion-control');
    core.noteExecutionAuthorization(root, { ...common, prompt: 'Implement the active ticket.' });
    core.noteSubagentStop(root, { ...common, last_assistant_message: 'Done' });
    const file = path.join(root, 'app.js');
    fs.writeFileSync(file, 'module.exports = 42;\n');
    fs.writeFileSync(path.join(root, '_test-parent-observation.js'), "require('assert').strictEqual(require('./app'), 42); console.log('Current source assertion passed');\n");
    const executed = spawnSync(process.execPath, ['_test-parent-observation.js'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.strictEqual(executed.status, 0, executed.stderr);
    assert.match(executed.stdout, /Current source assertion passed/);
    const nested = path.join(root, 'nested');
    fs.mkdirSync(nested);
    const script = host === 'claude' ? claudeController : codexPostTool;
    const tool = { ...common, hook_event_name: 'PostToolUse', cwd: nested,
      tool_name: host === 'codex' ? 'exec_command' : 'Bash',
      tool_input: host === 'codex' ? { cmd: 'node _test-parent-observation.js', workdir: root } : { command: 'node _test-parent-observation.js', workdir: root },
      tool_response: { exit_code: executed.status, stdout: executed.stdout },
    };
    assert.strictEqual(run(script, nested, tool, { CLAUDE_PROJECT_DIR: root }).status, 0);
    assert.strictEqual(loadState(root).observation.passed, true);
    const before = loadState(root).observation;
    const edit = { ...common, hook_event_name: 'PostToolUse', cwd: nested,
      tool_name: 'Write', tool_input: { file_path: file, content: 'module.exports = 42;\n' } };
    fs.writeFileSync(file, edit.tool_input.content);
    assert.strictEqual(run(script, nested, edit, { CLAUDE_PROJECT_DIR: root }).status, 0);
    assert.deepStrictEqual(loadState(root).observation, before, 'unchanged content retains evidence');
    // Remove the independent workflow blocker so Stop's evidence decision is
    // observable, unlike the original investigation's active-workflow probe.
    fs.writeFileSync(path.join(root, '.crabshell', 'memory', 'regressing-state.json'), JSON.stringify({ active: false }));
    const stopScript = host === 'claude' ? claudeController : codexStop;
    const stopPayload = { ...common, cwd: nested, hook_event_name: 'Stop' };
    const allowed = run(stopScript, nested, stopPayload, { CLAUDE_PROJECT_DIR: root });
    assert.strictEqual(allowed.status, 0, allowed.stderr);
    assert.doesNotMatch(allowed.stdout, /"decision":"block"/);
    fs.writeFileSync(file, 'module.exports = 99;\n');
    assert.strictEqual(run(script, nested, edit, { CLAUDE_PROJECT_DIR: root }).status, 0);
    assert.strictEqual(loadState(root).observation, null, 'actual content overrides stale tool content');
    const stop = core.decideStop(root, { ...common, hook_event_name: 'Stop' });
    assert.strictEqual(stop.action, 'block');
    assert.match(stop.reason, /must run the most direct acceptance check/);
    const blocked = parseDecision(run(stopScript, nested, stopPayload, { CLAUDE_PROJECT_DIR: root }), host === 'claude' ? 2 : 0);
    assert.strictEqual(blocked.decision, 'block');
    assert.match(blocked.reason, /must run the most direct acceptance check/);
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', host === 'claude' ? 'hooks.json' : 'codex-hooks.json'), 'utf8'));
    assert.ok(config.hooks.PostToolUse.some(group => new RegExp(`^(?:${group.matcher})$`).test('Write')
      && group.hooks.some(hook => /completion-controller|post-tool-use/.test(hook.command))));
  });

  test('printed names and incomplete results cannot supply passing parent evidence', () => {
    const root = path.join(tempRoot, 'unverified-parent');
    setup(root);
    const common = { session_id: 'parent-session', turn_id: 'parent-turn' };
    const core = require('./core/completion-control');
    core.noteExecutionAuthorization(root, { ...common, prompt: 'Implement the active ticket.' });
    core.noteSubagentStop(root, common);
    const printed = spawnSync(process.execPath, ['-e', "console.log('npm test')"], { encoding: 'utf8', windowsHide: true });
    assert.strictEqual(printed.status, 0);
    const examples = [
      { command: `node -e "console.log('npm test')"`, response: { exitCode: printed.status, stdout: printed.stdout } },
      ...[undefined, { exitCode: 0, status: 'running' }, { exitCode: 0, interrupted: true }, { exitCode: 7 }]
        .map(response => ({ command: 'node _test-parent-observation.js', response })),
    ];
    for (const example of examples) {
      core.recordParentObservation(root, { ...common, tool_name: 'Bash', tool_input: { command: example.command }, tool_response: example.response });
      assert.ok(!loadState(root).observation?.passed);
      assert.strictEqual(core.decideStop(root, common).action, 'block');
    }
  });

  function recordWithReadCount(root, payload, file) {
    const originalRead = fs.readFileSync;
    let reads = 0;
    fs.readFileSync = function(target, ...args) {
      if (typeof target === 'string' && path.resolve(target) === file) reads++;
      return originalRead.call(this, target, ...args);
    };
    try {
      const result = recordParentObservation(root, payload, { host: 'claude' });
      return { result, reads };
    } finally {
      fs.readFileSync = originalRead;
    }
  }

  function capturedResultSetup(name, fixtureName) {
    const root = path.join(tempRoot, name);
    setup(root);
    const file = path.join(root, 'app.js');
    fs.writeFileSync(file, 'module.exports = 42;\n');
    const captured = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hook-payloads', fixtureName), 'utf8'));
    const common = { session_id: captured.session_id, turn_id: 'read-count-turn', cwd: root };
    const core = require('./core/completion-control');
    core.noteExecutionAuthorization(root, { ...common, prompt: 'Implement and verify the active ticket.' });
    core.noteSubagentStop(root, { ...common, last_assistant_message: 'Ready for verification.' });
    // Replay the captured response verbatim, changing only project context and
    // the declared command. This measures core I/O, not live host delivery.
    const payload = { ...captured, ...common, tool_input: { command: 'node _test-parent-observation.js' } };
    return { root, file, common, core, payload };
  }

  test('a repeated result reads source once and the next event still detects real edits', () => {
    const { root, file, common, core, payload } = capturedResultSetup('single-scan', 'claude-posttooluse-bash-success.json');
    fs.writeFileSync(path.join(root, '_test-parent-observation.js'), "require('assert').strictEqual(require('./app'), 42);\n");
    const executed = spawnSync(process.execPath, ['_test-parent-observation.js'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.strictEqual(executed.status, 0, executed.stderr);
    for (let attempt = 0; attempt < 2; attempt++) {
      const recorded = recordWithReadCount(root, payload, file);
      assert.strictEqual(recorded.result.observation.passed, true);
      assert.strictEqual(recorded.reads, 1, 'one result must not read the same source twice');
    }
    const previous = loadState(root).observation;
    const edit = { ...payload, tool_name: 'Write', tool_input: { file_path: file } };
    fs.writeFileSync(file, 'module.exports = 42;\n');
    assert.strictEqual(recordWithReadCount(root, edit, file).reads, 1);
    assert.deepStrictEqual(loadState(root).observation, previous);
    fs.writeFileSync(file, 'module.exports = 99;\n');
    assert.strictEqual(recordWithReadCount(root, edit, file).reads, 1);
    assert.strictEqual(loadState(root).observation, null);
    assert.strictEqual(core.decideStop(root, common).action, 'block');
  });

  test('single-scan failure records keep retry counts until actual source content changes', () => {
    const { root, file, common, core, payload } = capturedResultSetup('single-scan-failure', 'claude-posttoolusefailure-bash.json');
    for (const count of [1, 2]) {
      const recorded = recordWithReadCount(root, payload, file);
      assert.strictEqual(recorded.reads, 1);
      assert.strictEqual(recorded.result.observation.passed, false);
      assert.strictEqual(loadState(root).repeatedFailure.count, count);
    }
    assert.strictEqual(core.decideStop(root, common).reportOnly, true);
    assert.strictEqual(loadState(root).reportIssued, true);
    // Keep the captured command/result identical. Only real source content
    // changes, so a reset cannot be explained by different failure output.
    fs.writeFileSync(file, 'module.exports = 99;\n');
    const recorded = recordWithReadCount(root, payload, file);
    assert.strictEqual(recorded.reads, 1);
    assert.strictEqual(loadState(root).repeatedFailure.count, 1);
    assert.strictEqual(loadState(root).reportIssued, false);
    assert.strictEqual(core.decideStop(root, common).action, 'block');
  });

  process.stdout.write(`RESULT: ${passed} passed, 0 failed\n`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
