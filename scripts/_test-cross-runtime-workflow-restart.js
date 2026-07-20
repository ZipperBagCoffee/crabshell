'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildWorkflowContext, validateWorkflowContext } = require('./core/workflow-context');
const { validateSessionStartOutput } = require('./core/memory-context');
const { validateContextOutput } = require('./core/first-turn-context');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell workflow restart '));
const projectRoot = path.join(tempRoot, 'restart project');
const claudeSession = path.join(__dirname, 'load-memory.js');
const codexSession = path.join(__dirname, 'adapters', 'codex', 'session-start.js');
const claudePrompt = path.join(__dirname, 'inject-rules.js');
const codexPrompt = path.join(__dirname, 'adapters', 'codex', 'user-prompt-submit.js');
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function snapshot(root) {
  const result = {};
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(current, entry.name);
      const childRelative = path.join(relative, entry.name);
      result[childRelative] = entry.isDirectory()
        ? '<directory>'
        : crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex');
      if (entry.isDirectory()) visit(child, childRelative);
    }
  }
  visit(root);
  return result;
}

function setup(root, options = {}) {
  const storage = path.join(root, '.crabshell');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  for (const directory of ['memory', 'discussion', 'plan', 'ticket', 'worklog']) {
    fs.mkdirSync(path.join(storage, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(storage, 'project.md'), 'WORKFLOW_RESTART_PROJECT_MARKER\n');
  fs.writeFileSync(path.join(storage, 'discussion', 'D888-fixture.md'), '## Intent\nWORKFLOW_DISCUSSION_MARKER\n');
  fs.writeFileSync(path.join(storage, 'plan', 'P888-fixture.md'), [
    '---', 'status: in-progress', '---', '', '## Acceptance Criteria', '- PLAN_UNMET_OUTCOME_MARKER',
  ].join('\n'));
  fs.writeFileSync(path.join(storage, 'ticket', 'P888_T001-fixture.md'), [
    '---', `status: ${options.ticketStatus || 'in-progress'}`, '---', '', '## Acceptance Criteria', '- TICKET_UNMET_OUTCOME_MARKER',
  ].join('\n'));
  fs.writeFileSync(path.join(storage, 'worklog', 'W888-fixture.md'), [
    '---', 'id: W888', `status: ${options.worklogStatus || 'in-progress'}`, '---', '',
    '## Task Contract (internal)', '- original_request: WORKLOG_TASK_MARKER', '',
    '## Verification', '| WORKLOG_UNMET_VERIFICATION_MARKER | pending |',
  ].join('\n'));
  fs.writeFileSync(path.join(storage, 'memory', 'regressing-state.json'), JSON.stringify({
    active: options.active !== false,
    phase: 'execution',
    cycle: 8,
    totalCycles: 99,
    discussion: 'D888',
    planId: 'P888',
    ticketIds: ['P888_T001'],
    lastUpdatedAt: options.lastUpdatedAt || new Date().toISOString(),
  }, null, 2));
  fs.writeFileSync(path.join(root, 'sentinel.txt'), 'UNCHANGED\n');
  return storage;
}

function run(script, root, payload, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ...env },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
}

function output(result, validator) {
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout.trim());
  assert.strictEqual(validator(parsed), true);
  return parsed.hookSpecificOutput.additionalContext;
}

function workflowPart(context) {
  const start = context.indexOf('## Active Crabshell Workflow');
  if (start === -1) return '';
  const endCandidates = ['\n## Delegation Check', '\n## Active Ticket Status', '\n## Relevant Memory'];
  const ends = endCandidates.map(marker => context.indexOf(marker, start + 1)).filter(index => index !== -1);
  return context.slice(start, ends.length > 0 ? Math.min(...ends) : context.length).trim();
}

try {
  setup(projectRoot);
  const sessionPayload = { hook_event_name: 'SessionStart', source: 'startup', session_id: 'restart-session', cwd: projectRoot };
  const before = snapshot(projectRoot);
  const claudeFirst = output(run(claudeSession, projectRoot, sessionPayload, { CLAUDE_PROJECT_DIR: projectRoot }), validateSessionStartOutput);
  const codexFirst = output(run(codexSession, projectRoot, sessionPayload), validateSessionStartOutput);
  const claudeRestart = output(run(claudeSession, projectRoot, { ...sessionPayload, session_id: 'restart-session-2', source: 'resume' }, { CLAUDE_PROJECT_DIR: projectRoot }), validateSessionStartOutput);
  const markers = ['D888', 'P888', 'P888_T001', 'TICKET_UNMET_OUTCOME_MARKER', 'W888', 'WORKLOG_TASK_MARKER', 'WORKLOG_UNMET_VERIFICATION_MARKER'];

  test('both hosts recover exact active workflow state after restart', () => {
    assert.strictEqual(claudeFirst, codexFirst);
    assert.strictEqual(claudeFirst, claudeRestart);
    const active = workflowPart(claudeFirst);
    assert.strictEqual(validateWorkflowContext(active, { purpose: 'session', requiredMarkers: markers }), true);
  });

  test('SessionStart workflow recovery is read-only and does not authorize resumption', () => {
    assert.deepStrictEqual(snapshot(projectRoot), before);
    const active = workflowPart(claudeFirst);
    assert.match(active, /not user authority to resume/);
    assert.doesNotMatch(active, /current user prompt authorizes execution/);
  });

  const claudeExecution = output(run(claudePrompt, projectRoot, {
    hook_event_name: 'UserPromptSubmit', prompt: 'Continue implementing the current workflow.', session_id: 'claude-execution', cwd: projectRoot,
  }, {
    CLAUDE_PROJECT_DIR: projectRoot,
    CLAUDE_PLUGIN_DATA: path.join(tempRoot, 'claude data'),
    CLAUDE_CONFIG_DIR: path.join(tempRoot, 'claude config'),
  }), validateContextOutput);
  const codexExecution = output(run(codexPrompt, projectRoot, {
    hook_event_name: 'UserPromptSubmit', prompt: 'Continue implementing the current workflow.', session_id: 'codex-execution', cwd: projectRoot,
  }, { PLUGIN_DATA: path.join(tempRoot, 'codex data') }), validateContextOutput);

  test('both execution prompts continue from current documents and unmet outcomes', () => {
    const claudeActive = workflowPart(claudeExecution);
    const codexActive = workflowPart(codexExecution);
    assert.strictEqual(validateWorkflowContext(claudeActive, { purpose: 'execution', requiredMarkers: markers }), true);
    assert.strictEqual(validateWorkflowContext(codexActive, { purpose: 'execution', requiredMarkers: markers }), true);
    assert.strictEqual(claudeActive, codexActive);
    assert.match(claudeActive, /Do not restart completed workflow setup/);
  });

  test('workflow continuation contains no host-specific skill or fixed-count rule', () => {
    const active = workflowPart(codexExecution);
    for (const forbidden of ['Skill tool', 'Work Agent', 'Review Agent', 'WA count', 'RA count', 'cycle cap', '99']) {
      assert.ok(!active.includes(forbidden), forbidden);
    }
  });

  test('question-only prompt does not inject execution continuation or write state', () => {
    const questionProject = path.join(tempRoot, 'question project');
    setup(questionProject);
    const questionBefore = snapshot(questionProject);
    const question = output(run(codexPrompt, questionProject, {
      hook_event_name: 'UserPromptSubmit', prompt: 'What is the current workflow?', session_id: 'question', cwd: questionProject,
    }), validateContextOutput);
    assert.strictEqual(workflowPart(question), '');
    assert.deepStrictEqual(snapshot(questionProject), questionBefore);
  });

  test('stale state is labeled and never fabricated as current', () => {
    const staleProject = path.join(tempRoot, 'stale project');
    setup(staleProject, { lastUpdatedAt: '2000-01-01T00:00:00.000Z' });
    const stale = buildWorkflowContext(staleProject, { purpose: 'session' });
    assert.match(stale, /STALE - confirm/);
  });

  test('inactive regressing and completed worklog produce no active workflow', () => {
    const doneProject = path.join(tempRoot, 'done project');
    setup(doneProject, { active: false, worklogStatus: 'done', ticketStatus: 'verified' });
    assert.strictEqual(buildWorkflowContext(doneProject, { purpose: 'session' }), '');
  });

  test('lost-state, restarted-plan, fixed-count, and wrong-purpose mutations fail', () => {
    const active = workflowPart(claudeFirst);
    assert.throws(() => validateWorkflowContext(active.replaceAll('P888', 'P999'), { purpose: 'session', requiredMarkers: markers }), /P888/);
    assert.throws(() => validateWorkflowContext(active + '\nWork Agent count: 2', { purpose: 'session', requiredMarkers: markers }), /Work Agent/);
    assert.throws(() => validateWorkflowContext(active, { purpose: 'execution', requiredMarkers: markers }), /current-turn authority/);
  });

  test('sentinel-write mutation is detected independently', () => {
    const mutationBefore = snapshot(projectRoot);
    fs.writeFileSync(path.join(projectRoot, 'sentinel.txt'), 'MUTATED\n');
    assert.notDeepStrictEqual(snapshot(projectRoot), mutationBefore);
  });

  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
