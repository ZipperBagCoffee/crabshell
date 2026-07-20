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
}

function run(script, cwd, payload, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CRABSHELL_PROJECT_DIR: cwd, ...env },
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

  test('Claude single Stop owner still enforces the existing scope validator', () => {
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
    const decision = parseDecision(result, 2);
    assert.match(decision.reason, /Scope reduction detected/);
    const controllerSource = fs.readFileSync(claudeController, 'utf8');
    for (const retained of ['sycophancy-guard.js', 'doc-watchdog.js', 'scope-guard.js']) assert.ok(controllerSource.includes(retained));
  });

  test('owner and authority mutations are rejected', () => {
    assert.throws(() => validateStopDecision({ action: 'block', reason: 'Child done is evidence.' }), /authority boundary/);
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'codex-hooks.json'), 'utf8'));
    config.hooks.Stop[0].hooks.push({ ...config.hooks.Stop[0].hooks[0] });
    assert.throws(() => validateCodexHookConfig(config), /one shared Codex completion adapter/);
    const ambiguous = commandObservation({
      tool_name: 'Bash', tool_input: { command: 'node _test-parent-observation.js' }, tool_response: { stdout: 'looks fine' },
    });
    assert.strictEqual(ambiguous.conclusive, false);
  });

  process.stdout.write(`RESULT: ${passed} passed, 0 failed\n`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
