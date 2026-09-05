'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readProjectConcept } = require('./shared-context');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell project memory '));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS: ${name}`); }
function setup(name) {
  const root = path.join(temp, name);
  fs.mkdirSync(path.join(root, '.crabshell', 'memory'), { recursive: true });
  return root;
}
function run(root, script, args = [], payload = {}) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: root, input: JSON.stringify({ cwd: root, session_id: 'memory-fixture', ...payload }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_DATA: path.join(temp, 'claude-data'), PLUGIN_DATA: path.join(temp, 'codex-data') },
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
function assertReaders(root, expected) {
  assert.strictEqual(readProjectConcept(root), expected);
  for (const script of ['load-memory.js', 'adapters/codex/session-start.js']) {
    assert.ok(run(root, script, [], { hook_event_name: 'SessionStart', source: 'startup' }).includes(expected), script);
    assert.ok(run(root, script, [], { hook_event_name: 'SessionStart', source: 'compact' }).includes(expected), `${script} recovery`);
  }
  for (const script of ['inject-rules.js', 'adapters/codex/user-prompt-submit.js']) {
    const result = run(root, script, [], { hook_event_name: 'UserPromptSubmit', prompt: 'What is the project?' });
    assert.ok(result.includes('Project Concept') && result.includes(expected), script);
  }
  for (const script of ['pre-compact.js', 'adapters/codex/pre-compact.js', 'adapters/codex/post-compact.js']) {
    assert.ok(run(root, script, [], { hook_event_name: script.includes('post-compact') ? 'PostCompact' : 'PreCompact' }).includes(expected), script);
  }
  assert.ok(run(root, 'codex-memory.js', ['load', `--project-dir=${root}`]).includes(expected));
  assert.ok(run(root, 'counter.js', ['memory-get', 'project']).includes(expected));
  assert.ok(run(root, 'counter.js', ['memory-get']).includes(expected));
  assert.ok(run(root, 'counter.js', ['memory-list']).includes('.crabshell/project.md'));
}
test('setter input changes reach both hosts, prompts and compaction through unchanged readers', () => {
  const root = setup('roundtrip');
  const descriptions = ['First description from the supported setter.', 'Different project purpose from the next setter call.'];
  for (const description of descriptions) {
    assert.ok(run(root, 'counter.js', ['memory-set', 'project', description]).includes('.crabshell/project.md'));
    assertReaders(root, description);
  }
  assert.strictEqual(fs.readFileSync(path.join(root, '.crabshell', 'project.md.bak'), 'utf8'), descriptions[0]);
  assert.ok(!fs.existsSync(path.join(root, '.crabshell', 'memory', 'project.md')));
});
test('legacy-only description migrates without losing its original bytes', () => {
  const root = setup('legacy');
  const legacy = path.join(root, '.crabshell', 'memory', 'project.md');
  const content = 'Preserved legacy project description.';
  fs.writeFileSync(legacy, content);
  assertReaders(root, content);
  assert.strictEqual(fs.readFileSync(path.join(root, '.crabshell', 'project.md'), 'utf8'), content);
  assert.strictEqual(fs.readFileSync(legacy, 'utf8'), content);
  const updated = 'Explicit setter after migration.';
  run(root, 'counter.js', ['memory-set', 'project', updated]);
  assertReaders(root, updated);
  assert.strictEqual(fs.readFileSync(legacy, 'utf8'), content);
});
test('conflicting canonical and legacy descriptions both survive migration and explicit replacement', () => {
  const root = setup('conflict');
  const legacy = path.join(root, '.crabshell', 'memory', 'project.md');
  const canonical = path.join(root, '.crabshell', 'project.md');
  fs.writeFileSync(legacy, 'Legacy conflict must survive.');
  fs.writeFileSync(canonical, 'Canonical content must survive.');
  assertReaders(root, 'Canonical content must survive.');
  run(root, 'counter.js', ['memory-set', 'project', 'Explicitly requested replacement.']);
  assertReaders(root, 'Explicitly requested replacement.');
  assert.strictEqual(fs.readFileSync(legacy, 'utf8'), 'Legacy conflict must survive.');
  assert.strictEqual(fs.readFileSync(`${canonical}.bak`, 'utf8'), 'Canonical content must survive.');
});
console.log(`RESULT: ${passed} passed, 0 failed`);
