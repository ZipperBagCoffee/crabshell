'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { inspectSessionTranscript } = require('./core/session-intent');
const { classifyUserIntent } = require('./core/turn-intent');

const counterPath = path.join(__dirname, 'counter.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell session end '));
const transcriptRoot = path.join(tempRoot, 'transcripts');
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
      const childRelative = path.join(relative, entry.name);
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        result[childRelative] = '<directory>';
        visit(child, childRelative);
      } else {
        result[childRelative] = crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex');
      }
    }
  }
  visit(root);
  return result;
}

function project(name) {
  const root = path.join(tempRoot, name);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), '.crabshell/\n');
  return root;
}

function transcript(name, entries) {
  const target = path.join(transcriptRoot, `${name}.jsonl`);
  fs.writeFileSync(target, entries.map(entry => typeof entry === 'string' ? entry : JSON.stringify(entry)).join('\n') + '\n');
  return target;
}

function user(text) {
  return { type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: text } };
}

function tool(name) {
  return {
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: `tool-${name}`, name, input: { file_path: 'fixture.txt', content: 'fixture' } }] },
  };
}

function runFinal(projectRoot, transcriptPath) {
  return spawnSync(process.execPath, [counterPath, 'final', `--project-dir=${projectRoot}`], {
    cwd: projectRoot,
    input: JSON.stringify({
      hook_event_name: 'SessionEnd',
      session_id: 'session-end-fixture',
      transcript_path: transcriptPath,
      cwd: projectRoot,
      reason: 'exit',
    }),
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
}

try {
  fs.mkdirSync(transcriptRoot, { recursive: true });
  const questionTranscript = transcript('question', [
    user('What does applying this change mean?'),
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'An explanation.' }] } },
  ]);
  const executionTranscript = transcript('execution', [
    user('Implement this change now.'),
    tool('Write'),
  ]);
  const defaultMutationTranscript = transcript('default-mutation', [user('yes'), tool('Edit')]);
  const questionMutationTranscript = transcript('question-mutation', [user('How should I implement this?'), tool('Write')]);
  const malformedTranscript = transcript('malformed', ['not-json', '{']);

  test('shared classifier is question-first for action words', () => {
    assert.strictEqual(classifyUserIntent('What does applying this change mean?'), 'question');
    assert.strictEqual(classifyUserIntent('이걸 어떻게 적용해?'), 'question');
    assert.strictEqual(require('./inject-rules').classifyUserIntent, classifyUserIntent);
  });

  test('session policy separates question, execution, and default mutation evidence', () => {
    assert.strictEqual(inspectSessionTranscript(questionTranscript).persist, false);
    assert.strictEqual(inspectSessionTranscript(executionTranscript).reason, 'execution-prompt');
    assert.strictEqual(inspectSessionTranscript(defaultMutationTranscript).reason, 'mutating-tool');
    assert.strictEqual(inspectSessionTranscript(questionMutationTranscript).reason, 'question-only');
  });

  for (const [name, transcriptPath] of [
    ['question', questionTranscript],
    ['missing', null],
    ['unreadable', path.join(transcriptRoot, 'absent.jsonl')],
    ['malformed', malformedTranscript],
  ]) {
    test(`${name} SessionEnd exits without any project write`, () => {
      const root = project(`${name} project`);
      const before = snapshot(root);
      const result = runFinal(root, transcriptPath);
      assert.strictEqual(result.status, 0, result.stderr || result.stdout);
      assert.strictEqual(result.stdout, '');
      assert.deepStrictEqual(snapshot(root), before);
    });
  }

  test('execution SessionEnd retains the existing persistence pipeline', () => {
    const root = project('execution project');
    const result = runFinal(root, executionTranscript);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /CRABSHELL_SAVE/);
    const memoryRoot = path.join(root, '.crabshell', 'memory');
    assert.ok(fs.existsSync(path.join(memoryRoot, 'counter.json')));
    assert.ok(fs.existsSync(path.join(memoryRoot, 'memory-index.json')));
    assert.ok(fs.readdirSync(path.join(memoryRoot, 'sessions')).some(file => file.endsWith('.l1.jsonl')));
  });

  test('forced-write mutation is detected by the independent snapshot', () => {
    const root = project('forced write mutation project');
    const before = snapshot(root);
    fs.writeFileSync(path.join(root, 'forbidden.txt'), 'mutation');
    assert.notDeepStrictEqual(snapshot(root), before);
  });

  test('removed execution evidence flips the decision and is detected', () => {
    const execution = inspectSessionTranscript(executionTranscript);
    const question = inspectSessionTranscript(questionTranscript);
    assert.strictEqual(execution.persist, true);
    assert.strictEqual(question.persist, false);
    assert.notStrictEqual(execution.reason, question.reason);
  });

  console.log(`RESULT: ${passed} passed, 0 failed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
