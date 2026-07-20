'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  TASK_CONTRACT_FIELDS,
  createTaskContract,
  shouldAskUser,
  resolveNamedReference,
  evaluateCompletion
} = require('./core/orchestration-policy');
const { ORCHESTRATION_DEFAULTS, WORKER_PROMPT_CONTRACT } = require('./shared-context');
const { parseExecOutput, snapshotTree, diffSnapshots, score } = require('./run-orchestration-corpus');

let passed = 0;
let failed = 0;
const tempDirs = [];

function test(name, fn) {
  try {
    fn();
    console.log('PASS: ' + name);
    passed++;
  } catch (error) {
    console.log('FAIL: ' + name + ' -- ' + error.message);
    failed++;
  }
}

function tempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell ' + label + '-'));
  tempDirs.push(dir);
  return dir;
}

test('1 task contract preserves all D110 fields', () => {
  const contract = createTaskContract({ original_request: 'Do the requested work.' });
  assert.deepStrictEqual(Object.keys(contract), Array.from(TASK_CONTRACT_FIELDS));
  assert.ok(TASK_CONTRACT_FIELDS.every(field => ORCHESTRATION_DEFAULTS.includes(field)), 'active guidance omitted a field');
});

test('2 question boundary distinguishes inspection from destructive approval', () => {
  assert.strictEqual(shouldAskUser({
    blocking_unknowns: [{ kind: 'implementation_detail', resolvable_by_inspection: true }]
  }), false);
  assert.strictEqual(shouldAskUser({
    blocking_unknowns: [{ kind: 'destructive', resolvable_by_inspection: false }]
  }), true);
});

test('3 named reference perturbation changes output without consumer change', () => {
  const dir = tempDir('reference perturbation');
  const reference = path.join(dir, 'reference.json');
  const consume = () => resolveNamedReference(reference, 'release.channel');
  fs.writeFileSync(reference, JSON.stringify({ release: { channel: 'amber' } }), 'utf8');
  const before = consume();
  fs.writeFileSync(reference, JSON.stringify({ release: { channel: 'violet' } }), 'utf8');
  const after = consume();
  assert.deepStrictEqual([before, after], ['amber', 'violet']);
});

test('4 false child done is rejected by parent-owned execution evidence', () => {
  const contract = createTaskContract({
    required_outcomes: ['verification succeeds'],
    named_references: [{ id: 'authoritative-spec' }]
  });
  const result = evaluateCompletion(contract, {
    worker_claims: [{ status: 'done' }],
    parent_reopened_references: ['authoritative-spec'],
    observations: [{ outcome: 'verification succeeds', observed: true, passed: false }],
    command_results: [{ name: 'verify-child', executed: true, exit_code: 7 }]
  });
  assert.strictEqual(result.complete, false);
  assert.strictEqual(result.worker_claims_ignored, 1);
  assert.ok(result.reasons.some(reason => reason.includes('verification succeeds')));
  assert.ok(result.reasons.some(reason => reason.includes('verify-child')));
});

test('5 passing evidence closes the same contract', () => {
  const contract = createTaskContract({ required_outcomes: ['verification succeeds'] });
  const result = evaluateCompletion(contract, {
    worker_claims: [{ status: 'not done' }],
    observations: [{ outcome: 'verification succeeds', observed: true, passed: true }],
    command_results: [{ name: 'verify-child', executed: true, exit_code: 0 }]
  });
  assert.strictEqual(result.complete, true);
});

test('6 installed Codex wrapper creates a W contract in consumer project', () => {
  const consumer = tempDir('consumer project');
  const wrapper = path.join(__dirname, '..', 'codex-skills', 'light-workflow', 'scripts', 'codex-docs.js');
  const result = spawnSync(process.execPath, [wrapper, 'worklog', 'Parser behavior',
    '--project-dir=' + consumer,
    '--required-outcomes=parser test executes',
    '--non-goals=no production rewrite',
    '--observable-success=direct test exits zero'
  ], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  const relative = result.stdout.trim();
  const worklog = fs.readFileSync(path.join(consumer, relative), 'utf8');
  assert.ok(worklog.includes('## Task Contract (internal)'));
  assert.ok(worklog.includes('parser test executes'));
  assert.ok(worklog.includes('direct test exits zero'));
});

test('7 Claude and Codex light-workflow share five stages and no count policy', () => {
  const claude = fs.readFileSync(path.join(__dirname, '..', 'skills', 'light-workflow', 'SKILL.md'), 'utf8');
  const codex = fs.readFileSync(path.join(__dirname, '..', 'codex-skills', 'light-workflow', 'SKILL.md'), 'utf8');
  const stages = ['Understand internally', 'Inspect', 'Implement', 'Verify behavior', 'Report'];
  for (const stage of stages) {
    assert.ok(claude.includes(stage), 'Claude missing ' + stage);
    assert.ok(codex.includes(stage), 'Codex missing ' + stage);
  }
  const active = claude + '\n' + codex + '\n' + WORKER_PROMPT_CONTRACT;
  assert.ok(!/1:1|10-20|3-5|80-100K|7-file|multiple WAs/i.test(active), 'fixed-count policy remains');
  assert.ok(active.includes('claim / evidence / gap') || active.includes('claim, evidence from direct observation, and remaining gap'));
});

test('8 live corpus parser uses command event exit rather than response prose', () => {
  const stdout = [
    JSON.stringify({ type: 'item.started', item: {
      type: 'command_execution', command: 'rg --files actual-output.txt', exit_code: null,
      status: 'in_progress', aggregated_output: ''
    }}),
    JSON.stringify({ type: 'item.completed', item: {
      type: 'command_execution', command: 'rg --fixed-strings completed-sentinel actual-output.txt', exit_code: 1,
      status: 'failed', aggregated_output: ''
    }}),
    JSON.stringify({ type: 'item.completed', item: {
      type: 'agent_message', text: JSON.stringify({ false_done: { complete: false, verification_exit_code: 1 } })
    }})
  ].join('\n');
  const parsed = parseExecOutput(stdout);
  assert.strictEqual(parsed.command_observation.exit_code, 1);
  assert.strictEqual(parsed.response.false_done.complete, false);
});

test('9 fixture snapshot detects forbidden mutation independently', () => {
  const dir = tempDir('side effect audit');
  const file = path.join(dir, 'owned.txt');
  fs.writeFileSync(file, 'before', 'utf8');
  const before = snapshotTree(dir);
  fs.writeFileSync(file, 'after', 'utf8');
  const after = snapshotTree(dir);
  assert.deepStrictEqual(diffSnapshots(before, after), ['owned.txt']);
});

test('10 A/B scorer recognizes observed legacy ritual or delegation attempt', () => {
  const currentResponse = {
    non_blocking: { decision: 'act', asked_question: false, filename: 'parser.spec.js', evidence: 'repository convention observed' },
    destructive: { decision: 'ask', asked_question: true, evidence: 'destructive confirmation required' },
    named_reference: { value: 'amber', evidence: 'reference.json read' },
    false_done: { complete: false, verification_exit_code: 1, evidence: 'rg exited 1' }
  };
  const result = score([
    { policy: 'baseline', reference_variant: 'amber', response: currentResponse,
      stderr_tail: 'collab spawn failed: no thread with id', forbidden_side_effects: [] },
    { policy: 'current', reference_variant: 'amber', response: currentResponse,
      command_observation: { exit_code: 1 }, forbidden_side_effects: [] },
    { policy: 'current', reference_variant: 'violet', response: {
      ...currentResponse, named_reference: { value: 'violet', evidence: 'reference.json read' }
    }, command_observation: { exit_code: 1 }, forbidden_side_effects: [] }
  ]);
  assert.strictEqual(result.passed, true, JSON.stringify(result.checks));
});

for (const dir of tempDirs) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
