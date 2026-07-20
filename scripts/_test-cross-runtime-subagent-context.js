'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { MAX_CONTEXT_CHARS, validateSubagentOutput } = require('./core/subagent-context');

const claudeAdapter = path.join(__dirname, 'subagent-context.js');
const codexAdapter = path.join(__dirname, 'adapters', 'codex', 'subagent-start.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell subagent parity '));
const projectRoot = path.join(tempRoot, 'project with spaces');
const storageRoot = path.join(projectRoot, '.crabshell');
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

function run(script, payload, env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
}

function parse(result) {
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

try {
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(storageRoot, 'project.md'), 'SUBAGENT_PROJECT_MARKER\n');
  fs.mkdirSync(path.join(storageRoot, 'discussion'), { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'plan'), { recursive: true });
  fs.mkdirSync(path.join(storageRoot, 'ticket'), { recursive: true });
  fs.writeFileSync(path.join(storageRoot, 'discussion', 'D777-fixture.md'), [
    '## Intent', 'ORIGINAL_REQUEST_MARKER', '', '## Non-Goals', '- NON_GOAL_MARKER',
  ].join('\n'));
  fs.writeFileSync(path.join(storageRoot, 'plan', 'P777-fixture.md'), [
    '## Intent', 'PLAN_INTENT_MARKER', '', '## Scope', 'Allowed: PLAN_ALLOWED_MARKER', '', 'Excluded: FORBIDDEN_CHANGE_MARKER',
  ].join('\n'));
  fs.writeFileSync(path.join(storageRoot, 'ticket', 'P777_T001-fixture.md'), [
    '## Intent', 'EXACT_TASK_MARKER', '', '## Acceptance Criteria', '- OBSERVABLE_SUCCESS_MARKER', '', '## Allowed Files', '- ALLOWED_CHANGE_MARKER',
  ].join('\n'));
  fs.writeFileSync(path.join(storageRoot, 'memory', 'regressing-state.json'), JSON.stringify({
    active: true,
    phase: 'execution',
    cycle: 7,
    totalCycles: 10,
    discussion: 'D777',
    planId: 'P777',
    ticketIds: ['P777_T001'],
  }, null, 2));
  fs.writeFileSync(path.join(projectRoot, 'sentinel.txt'), 'UNCHANGED\n');
  const payload = {
    hook_event_name: 'SubagentStart',
    cwd: projectRoot,
    session_id: 'subagent-parity-session',
    agent_type: 'worker',
  };

  const before = snapshot(projectRoot);
  const claude = parse(run(claudeAdapter, payload, { CLAUDE_PROJECT_DIR: projectRoot }));
  const codex = parse(run(codexAdapter, payload));
  const markers = [
    'SUBAGENT_PROJECT_MARKER',
    'ORIGINAL_REQUEST_MARKER',
    'NON_GOAL_MARKER',
    'EXACT_TASK_MARKER',
    'D777',
    'P777',
    'P777_T001',
    'ALLOWED_CHANGE_MARKER',
    'FORBIDDEN_CHANGE_MARKER',
    'OBSERVABLE_SUCCESS_MARKER',
  ];

  test('Claude and Codex return valid native SubagentStart output', () => {
    assert.strictEqual(validateSubagentOutput(claude, markers), true);
    assert.strictEqual(validateSubagentOutput(codex, markers), true);
  });

  test('both hosts inject the exact same task-specific worker context', () => {
    assert.strictEqual(codex.hookSpecificOutput.additionalContext, claude.hookSpecificOutput.additionalContext);
  });

  test('existing Claude context categories remain present', () => {
    const context = claude.hookSpecificOutput.additionalContext;
    for (const category of ['Project Root Anchor', 'Project Concept', 'Regressing State', 'Worker Contract', 'Rules Quick-Check']) {
      assert.match(context, new RegExp(category));
    }
    assert.ok(context.length <= MAX_CONTEXT_CHARS);
  });

  test('both SubagentStart adapters are read-only', () => {
    assert.deepStrictEqual(snapshot(projectRoot), before);
  });

  test('missing active workflow falls back without fabricated task scope', () => {
    const statePath = path.join(storageRoot, 'memory', 'regressing-state.json');
    fs.renameSync(statePath, statePath + '.fixture-hidden');
    const fallback = parse(run(codexAdapter, payload));
    fs.renameSync(statePath + '.fixture-hidden', statePath);
    assert.strictEqual(validateSubagentOutput(fallback), true);
    assert.doesNotMatch(fallback.hookSpecificOutput.additionalContext, /Active Worker Task Scope|ORIGINAL_REQUEST_MARKER/);
  });

  test('wrong event fails open with no native output', () => {
    const result = run(codexAdapter, { ...payload, hook_event_name: 'Stop' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
  });

  test('wrong-event, removed-field, and truncated-field mutations fail validation', () => {
    assert.throws(() => validateSubagentOutput({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: claude.hookSpecificOutput.additionalContext } }, markers), /SubagentStart/);
    assert.throws(() => validateSubagentOutput(claude, ['REMOVED_TASK_MARKER']), /missing required task marker/);
    const truncated = JSON.parse(JSON.stringify(claude));
    truncated.hookSpecificOutput.additionalContext = truncated.hookSpecificOutput.additionalContext.replace('OBSERVABLE_SUCCESS_MARKER', '');
    assert.throws(() => validateSubagentOutput(truncated, markers), /OBSERVABLE_SUCCESS_MARKER/);
  });

  test('sentinel-write mutation is detected by the independent snapshot', () => {
    const mutationBefore = snapshot(projectRoot);
    fs.writeFileSync(path.join(projectRoot, 'sentinel.txt'), 'MUTATED\n');
    assert.notDeepStrictEqual(snapshot(projectRoot), mutationBefore);
  });

  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
