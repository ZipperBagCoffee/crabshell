'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  FIRST_TURN_RULES,
  RESPONSE_CONTRACT,
  RESPONSE_FIELDS,
  validateContextOutput,
} = require('./core/first-turn-context');
const { classifyUserIntent, CODEX_DELEGATION } = require('./inject-rules');

const repoRoot = path.resolve(__dirname, '..');
const claudeEntry = path.join(__dirname, 'inject-rules.js');
const codexEntry = path.join(__dirname, 'adapters', 'codex', 'user-prompt-submit.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell cross runtime '));
const projectRoot = path.join(tempRoot, 'consumer project with spaces');
const nestedCwd = path.join(projectRoot, 'src', 'nested');
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function snapshotTree(root) {
  const snapshot = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      if (entry.isDirectory()) visit(absolute);
      else snapshot[relative] = fs.readFileSync(absolute).toString('base64');
    }
  }
  visit(root);
  return snapshot;
}

function run(entry, payload, env = {}) {
  const result = spawnSync(process.execPath, [entry], {
    cwd: nestedCwd,
    env: { ...process.env, ...env },
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim(), `no output from ${entry}`);
  return JSON.parse(result.stdout.trim());
}

try {
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.crabshell', 'memory'), { recursive: true });
  fs.mkdirSync(nestedCwd, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'CLAUDE.md'), '# Consumer instructions\nQUESTION_SAFETY_SENTINEL\n');
  fs.writeFileSync(path.join(projectRoot, '.crabshell', 'project.md'), '# Consumer project\nPROJECT_CONCEPT_SENTINEL\n');
  fs.writeFileSync(path.join(projectRoot, '.crabshell', 'memory', 'memory-index.json'), JSON.stringify({
    version: 1,
    current: 'logbook.md',
    feedbackPressure: { level: 2, consecutiveCount: 2, decayCounter: 0, lastShownLevel: 2 },
  }, null, 2));
  fs.writeFileSync(path.join(projectRoot, '.crabshell', 'memory', 'regressing-state.json'), JSON.stringify({
    active: true,
    phase: 'execution',
    cycle: 9,
    totalCycles: 9,
    discussion: 'OLD_TASK_MUST_NOT_RESUME',
  }, null, 2));

  const prompt = 'What does “apply this change” mean?';
  const payload = {
    session_id: 'cross-runtime-fixture',
    transcript_path: null,
    cwd: nestedCwd,
    hook_event_name: 'UserPromptSubmit',
    model: 'fixture-model',
    turn_id: 'fixture-turn',
    permission_mode: 'default',
    prompt,
  };
  const before = snapshotTree(projectRoot);
  const claudeOutput = run(claudeEntry, payload, { CLAUDE_PROJECT_DIR: projectRoot });
  const afterClaude = snapshotTree(projectRoot);
  const codexOutput = run(codexEntry, payload);
  const afterCodex = snapshotTree(projectRoot);

  test('question containing an execution word is classified as a question', () => {
    assert.strictEqual(classifyUserIntent(prompt), 'question');
  });

  test('Claude and Codex emit valid native UserPromptSubmit output', () => {
    assert.strictEqual(validateContextOutput(claudeOutput), true);
    assert.strictEqual(validateContextOutput(codexOutput), true);
  });

  test('both hosts consume the exact same shared first-turn semantics', () => {
    assert.ok(claudeOutput.hookSpecificOutput.additionalContext.includes(FIRST_TURN_RULES));
    // Codex delegation guidance is Claude-host-only; outside that block the contexts are identical.
    assert.ok(claudeOutput.hookSpecificOutput.additionalContext.includes(CODEX_DELEGATION));
    assert.ok(!codexOutput.hookSpecificOutput.additionalContext.includes('## Codex Delegation'));
    assert.strictEqual(
      codexOutput.hookSpecificOutput.additionalContext,
      claudeOutput.hookSpecificOutput.additionalContext.replace(CODEX_DELEGATION, '')
    );
  });

  test('both hosts receive the exact mandatory intent understanding explanation ending', () => {
    const context = claudeOutput.hookSpecificOutput.additionalContext;
    assert.ok(context.includes(RESPONSE_CONTRACT));
    assert.deepStrictEqual(RESPONSE_FIELDS, ['[의도]:', '[이해]:', '[설명]:']);
    assert.match(context, /End every user-facing response, including a short answer/i);
    assert.match(context, /easy-to-understand line using the user's words/i);
    assert.match(context, /do not default to analogy or caveman-style fragments/i);
  });

  test('question context forbids mutation and omits prior-work continuation', () => {
    const context = claudeOutput.hookSpecificOutput.additionalContext;
    assert.match(context, /question authorizes an answer/i);
    assert.ok(!context.includes('OLD_TASK_MUST_NOT_RESUME'));
    assert.ok(!context.includes('Regressing active'));
  });

  test('Claude question hook makes no fixture file change', () => {
    assert.deepStrictEqual(afterClaude, before);
  });

  test('Codex question hook makes no fixture file change', () => {
    assert.deepStrictEqual(afterCodex, before);
  });

  test('divergent-source mutation is detected by semantic comparison', () => {
    const mutated = JSON.parse(JSON.stringify(codexOutput));
    mutated.hookSpecificOutput.additionalContext = mutated.hookSpecificOutput.additionalContext.replace('## Crabshell Turn Contract', '## Divergent Contract');
    assert.throws(() => assert.strictEqual(mutated.hookSpecificOutput.additionalContext, claudeOutput.hookSpecificOutput.additionalContext));
    assert.throws(() => validateContextOutput(mutated), /shared Crabshell turn contract/);
  });

  test('response-contract mutations are rejected', () => {
    const outputWith = context => ({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
    });
    const original = claudeOutput.hookSpecificOutput.additionalContext;
    assert.throws(() => validateContextOutput(outputWith(original.replace('[이해]:', '[해석]:'))), /\[이해\]:/);
    assert.throws(() => validateContextOutput(outputWith(original.replace('[설명]:', '[쉬운설명]:'))), /\[설명\]:/);
    const reordered = original
      .replace('[의도]:', '[임시]:')
      .replace('[설명]:', '[의도]:')
      .replace('[임시]:', '[설명]:');
    assert.throws(() => validateContextOutput(outputWith(reordered)), /field order|missing \[(?:의도|이해|설명)\]:/);
    assert.throws(() => validateContextOutput(outputWith(original.replace('End every user-facing response, including a short answer', 'For user-facing responses'))), /end-placement/);
    assert.throws(() => validateContextOutput(outputWith(original.replace('easy-to-understand line using the user\'s words', 'technical line'))), /easy-language/);
  });

  test('forbidden-side-effect mutation is detected by the independent snapshot', () => {
    const mutated = { ...before, 'forbidden-write.txt': Buffer.from('mutation').toString('base64') };
    assert.throws(() => assert.deepStrictEqual(mutated, before));
  });

  test('test executes source entries from this repository', () => {
    assert.ok(claudeEntry.startsWith(repoRoot));
    assert.ok(codexEntry.startsWith(repoRoot));
  });

  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
