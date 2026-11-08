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

function runFinal(projectRoot, transcriptPath, sessionId = 'session-end-fixture') {
  return spawnSync(process.execPath, [counterPath, 'final', `--project-dir=${projectRoot}`], {
    cwd: projectRoot,
    input: JSON.stringify({
      hook_event_name: 'SessionEnd',
      ...(sessionId ? { session_id: sessionId } : {}),
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
    // Claude Code discards SessionEnd output and no model turn follows, so it prints nothing.
    assert.strictEqual(result.stdout, '');
    const memoryRoot = path.join(root, '.crabshell', 'memory');
    // D119: the save counter is per session; a persisted SessionEnd records this session's L1 position.
    assert.ok(fs.existsSync(path.join(memoryRoot, 'session-state', 'session-', 'l1-cursor.json')));
    assert.ok(fs.existsSync(path.join(memoryRoot, 'memory-index.json')));
    assert.ok(fs.readdirSync(path.join(memoryRoot, 'sessions')).some(file => file.endsWith('.l1.jsonl')));
  });

  test('execution SessionEnd without a session id resets the project-wide save counter', () => {
    const root = project('legacy counter project');
    const memoryRoot = path.join(root, '.crabshell', 'memory');
    fs.mkdirSync(memoryRoot, { recursive: true });
    fs.writeFileSync(path.join(memoryRoot, 'counter.json'), JSON.stringify({ counter: 7 }));
    const result = runFinal(root, executionTranscript, null);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(memoryRoot, 'counter.json'), 'utf8')).counter, 0);
  });

  test('SessionEnd after an interval save refines only the new part, and the L1 equals a full refine', () => {
    const { sessionKey } = require('./core/session-state');
    const { refineRawSync } = require('./refine-raw');
    const root = project('incremental project');
    const sid = 'incremental-session-0001';
    const reply = text => ({ type: 'assistant', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
    const entries = [user('Implement this change now.'), tool('Write')];
    for (let i = 0; i < 30; i += 1) entries.push(user(`step ${i}`), reply(`done ${i}`));
    const file = transcript('incremental', entries);
    // Interval save: the session's counter is one short of the default interval.
    const stateDir = path.join(root, '.crabshell', 'memory', 'session-state', sessionKey(sid));
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'counter.json'), JSON.stringify({ counter: 14 }));
    const hookData = { hook_event_name: 'PostToolUse', session_id: sid, transcript_path: file, tool_name: 'Write', cwd: root };
    const check = spawnSync(process.execPath, [counterPath, 'check', `--project-dir=${root}`], {
      cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOOK_DATA: JSON.stringify(hookData) },
    });
    assert.strictEqual(check.status, 0, check.stderr);
    const sessionsDir = path.join(root, '.crabshell', 'memory', 'sessions');
    const l1Of = () => fs.readdirSync(sessionsDir).filter(name => name.endsWith('.l1.jsonl') && name.includes(`_${sessionKey(sid)}`));
    assert.strictEqual(l1Of().length, 1, 'the interval save wrote the session L1');
    const cursorAfterCheck = JSON.parse(fs.readFileSync(path.join(stateDir, 'l1-cursor.json'), 'utf8')).offset;

    const more = [];
    for (let i = 30; i < 45; i += 1) more.push(user(`step ${i}`), reply(`done ${i}`));
    fs.appendFileSync(file, more.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const result = runFinal(root, file, sid);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(l1Of().length, 1, 'SessionEnd appended to the same L1, no second file');
    assert.ok(JSON.parse(fs.readFileSync(path.join(stateDir, 'l1-cursor.json'), 'utf8')).offset > cursorAfterCheck);

    const whole = path.join(tempRoot, 'whole.l1.jsonl');
    refineRawSync(file, whole);
    assert.strictEqual(fs.readFileSync(path.join(sessionsDir, l1Of()[0]), 'utf8'), fs.readFileSync(whole, 'utf8'));
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
