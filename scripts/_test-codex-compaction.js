'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateCompactionOutput } = require('./core/compaction-context');
const { validatePostCompactEffects } = require('./adapters/codex/post-compact-effects');

const preAdapter = path.join(__dirname, 'adapters', 'codex', 'pre-compact.js');
const postAdapter = path.join(__dirname, 'adapters', 'codex', 'post-compact.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell codex compact '));
const projectRoot = path.join(tempRoot, 'project with spaces');
const storageRoot = path.join(projectRoot, '.crabshell');
const memoryDir = path.join(storageRoot, 'memory');
let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function hash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function snapshot(root) {
  const result = {};
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(current, entry.name);
      const childRelative = path.join(relative, entry.name);
      result[childRelative] = entry.isDirectory() ? '<directory>' : hash(child);
      if (entry.isDirectory()) visit(child, childRelative);
    }
  }
  visit(root);
  return result;
}

function changedPaths(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => before[key] !== after[key])
    .sort();
}

function payload(eventName, trigger = 'auto') {
  return {
    session_id: 'compact-fixture',
    transcript_path: null,
    cwd: projectRoot,
    hook_event_name: eventName,
    trigger,
    model: 'fixture-model',
  };
}

function run(script, eventName, trigger) {
  return spawnSync(process.execPath, [script], {
    cwd: projectRoot,
    input: JSON.stringify(payload(eventName, trigger)),
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
}

function contextFrom(result, eventName) {
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout.trim());
  assert.strictEqual(validateCompactionOutput(output, eventName), true);
  return output.hookSpecificOutput.additionalContext;
}

try {
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(path.join(storageRoot, 'project.md'), 'COMPACTION_PROJECT_MARKER\n');
  fs.writeFileSync(path.join(memoryDir, 'logbook.md'), 'COMPACTION_MEMORY_MARKER\n');
  fs.writeFileSync(path.join(memoryDir, 'memory-index.json'), JSON.stringify({
    feedbackPressure: { level: 2, lastShownLevel: 2 },
    rotatedFiles: [],
  }, null, 2));
  fs.writeFileSync(path.join(memoryDir, 'regressing-state.json'), JSON.stringify({
    active: true,
    phase: 'execution',
    cycle: 4,
    totalCycles: 8,
    discussion: 'D111',
    planId: 'P161',
    ticketIds: ['P161_T001'],
    lastUpdatedAt: new Date().toISOString(),
  }, null, 2));
  for (const [dir, id, title] of [
    ['discussion', 'D111', 'COMPACTION_DISCUSSION_MARKER'],
    ['plan', 'P161', 'COMPACTION_PLAN_MARKER'],
    ['ticket', 'P161_T001', 'COMPACTION_TICKET_MARKER'],
    ['investigation', 'I081', 'COMPACTION_INVESTIGATION_MARKER'],
  ]) {
    fs.mkdirSync(path.join(storageRoot, dir), { recursive: true });
    fs.writeFileSync(path.join(storageRoot, dir, 'INDEX.md'), `| ID | Title | Status |\n|---|---|---|\n| ${id} | ${title} | open |\n`);
  }
  fs.writeFileSync(path.join(projectRoot, 'sentinel.txt'), 'UNCHANGED\n');

  test('Codex PreCompact returns native recovery context and performs no write', () => {
    const before = snapshot(projectRoot);
    const context = contextFrom(run(preAdapter, 'PreCompact', 'manual'), 'PreCompact');
    for (const marker of [
      'COMPACTION_PROJECT_MARKER',
      'COMPACTION_MEMORY_MARKER',
      'COMPACTION_DISCUSSION_MARKER',
      'COMPACTION_PLAN_MARKER',
      'COMPACTION_TICKET_MARKER',
      'COMPACTION_INVESTIGATION_MARKER',
      'D111',
      'P161_T001',
    ]) assert.match(context, new RegExp(marker));
    assert.deepStrictEqual(snapshot(projectRoot), before);
  });

  test('Codex PostCompact restores context and preserves Claude reset/log outcomes', () => {
    const before = snapshot(projectRoot);
    const context = contextFrom(run(postAdapter, 'PostCompact', 'auto'), 'PostCompact');
    assert.match(context, /COMPACTION_MEMORY_MARKER/);
    assert.match(context, /P161_T001/);
    const index = JSON.parse(fs.readFileSync(path.join(memoryDir, 'memory-index.json'), 'utf8'));
    assert.strictEqual(index.feedbackPressure.lastShownLevel, 0);
    const logPath = path.join(memoryDir, 'logs', 'compaction.log');
    assert.match(fs.readFileSync(logPath, 'utf8'), /PostCompact hook fired/);
    assert.strictEqual(fs.readFileSync(path.join(projectRoot, 'sentinel.txt'), 'utf8'), 'UNCHANGED\n');
    const allowed = new Set([
      path.join('.crabshell', 'memory', 'memory-index.json'),
      path.join('.crabshell', 'memory', 'lock-contention.json'),
      path.join('.crabshell', 'memory', 'logs'),
      path.join('.crabshell', 'memory', 'logs', 'compaction.log'),
    ]);
    assert.deepStrictEqual(changedPaths(before, snapshot(projectRoot)).filter(item => !allowed.has(item)), []);
  });

  test('stale workflow state is labeled instead of silently resumed', () => {
    const statePath = path.join(memoryDir, 'regressing-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.lastUpdatedAt = '2000-01-01T00:00:00.000Z';
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    const context = contextFrom(run(preAdapter, 'PreCompact', 'auto'), 'PreCompact');
    assert.match(context, /STALE - confirm before continuation/);
  });

  test('wrong events fail open without producing a native contract', () => {
    const result = run(preAdapter, 'PostCompact', 'manual');
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
  });

  test('wrong event and missing context mutations are rejected', () => {
    assert.throws(() => validateCompactionOutput({ hookSpecificOutput: { hookEventName: 'PostCompact', additionalContext: 'Crabshell Compaction Recovery Context' } }, 'PreCompact'), /PreCompact/);
    assert.throws(() => validateCompactionOutput({ hookSpecificOutput: { hookEventName: 'PreCompact', additionalContext: 'PASS' } }, 'PreCompact'), /recovery context/);
  });

  test('missing reset and missing log mutations are rejected', () => {
    assert.throws(() => validatePostCompactEffects({ pressureReset: false, compactionLogged: true }, { requirePressureReset: true }), /pressure/);
    assert.throws(() => validatePostCompactEffects({ pressureReset: true, compactionLogged: false }, { requirePressureReset: true }), /log/);
  });

  test('unrelated project mutation is distinguished from allowed PostCompact paths', () => {
    const before = snapshot(projectRoot);
    fs.writeFileSync(path.join(projectRoot, 'sentinel.txt'), 'MUTATED\n');
    const unexpected = changedPaths(before, snapshot(projectRoot));
    assert.deepStrictEqual(unexpected, ['sentinel.txt']);
  });

  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
