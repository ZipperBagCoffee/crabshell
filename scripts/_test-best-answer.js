'use strict';
// D177: the best-answer question once per user prompt at the main agent's Stop, through
// completion-controller: asked when no other check blocks, deferred to the next Stop when
// one does, other checks run once more after the question, off by config, Claude only.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { handlePayload } = require('./completion-controller');
const { QUESTION, statePath } = require('./best-answer');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-best-answer-'));
const savedEntry = process.env.CLAUDE_CODE_ENTRYPOINT;
const savedHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const home = path.join(base, 'home'); // the user-wide ~/.crabshell/config.json lives here
fs.mkdirSync(path.join(home, '.crabshell'), { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'; // an interactive session
let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}

let projects = 0;
function project(config) {
  const dir = path.join(base, `p${++projects}`);
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  if (config !== undefined) fs.writeFileSync(path.join(dir, '.crabshell', 'memory', 'config.json'), config);
  return dir;
}
let transcripts = 0;
function transcript(answer) {
  const file = path.join(base, `t${++transcripts}.jsonl`);
  const lines = [
    { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '이거 어떻게 돼?' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: answer }] } },
  ];
  fs.writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  return file;
}
const PLAIN = '이건 설정 파일이에요.';
const AGREES = '맞아요, 제가 틀렸어요.'; // sycophancy-guard blocks this when no tool ran
function stop(dir, extra = {}, answer = PLAIN, host = 'claude') {
  const payload = { hook_event_name: 'Stop', session_id: 's1', stop_hook_active: false,
    transcript_path: transcript(answer), last_assistant_message: answer, ...extra };
  return handlePayload(payload, { host, projectDir: dir }).result;
}

try {
  check('AC1: the first Stop of a prompt, no other check blocking, carries the question', () => {
    const dir = project();
    const result = stop(dir, { prompt_id: 'p1' });
    assert.notEqual(result.action, 'block');
    assert.equal(result.question, QUESTION);
  });

  check('AC1: main prints it as Stop additionalContext and exits 0', () => {
    const dir = project();
    const payload = { hook_event_name: 'Stop', session_id: 's1', prompt_id: 'p1', stop_hook_active: false,
      transcript_path: transcript(PLAIN), last_assistant_message: PLAIN, cwd: dir };
    const run = spawnSync(process.execPath, [path.join(__dirname, 'completion-controller.js')],
      { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_ENTRYPOINT: 'cli' } });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout.trim());
    assert.equal(out.hookSpecificOutput.hookEventName, 'Stop');
    assert.equal(out.hookSpecificOutput.additionalContext, QUESTION);
    assert.equal(out.decision, undefined);
  });

  check('AC2: after the question, the next Stop asks nothing and the other checks run once more', () => {
    const dir = project();
    stop(dir, { prompt_id: 'p1' });
    const second = stop(dir, { prompt_id: 'p1', stop_hook_active: true }, AGREES);
    assert.equal(second.action, 'block', 'sycophancy-guard should judge the revised answer');
    assert.equal(second.question, undefined);
    const third = stop(dir, { prompt_id: 'p1', stop_hook_active: true }, AGREES);
    assert.notEqual(third.action, 'block');
    assert.equal(third.question, undefined);
  });

  check('AC2: a revised answer the other checks accept ends the turn', () => {
    const dir = project();
    stop(dir, { prompt_id: 'p1' });
    const second = stop(dir, { prompt_id: 'p1', stop_hook_active: true });
    assert.notEqual(second.action, 'block');
    assert.equal(second.question, undefined);
  });

  check('AC3: when another check blocks, the question waits for the next Stop, then nothing more', () => {
    const dir = project();
    const first = stop(dir, { prompt_id: 'p2' }, AGREES);
    assert.equal(first.action, 'block');
    assert(!String(first.reason).includes(QUESTION), 'question must not join another block');
    const second = stop(dir, { prompt_id: 'p2', stop_hook_active: true });
    assert.equal(second.question, QUESTION);
    const third = stop(dir, { prompt_id: 'p2', stop_hook_active: true }, AGREES);
    assert.notEqual(third.action, 'block');
    assert.equal(third.question, undefined);
  });

  check('a new prompt is asked again', () => {
    const dir = project();
    stop(dir, { prompt_id: 'p1' });
    assert.equal(stop(dir, { prompt_id: 'p2' }).question, QUESTION);
  });

  check('AC4: bestAnswer.ask false turns it off', () => {
    const dir = project(JSON.stringify({ bestAnswer: { ask: false } }));
    const result = stop(dir, { prompt_id: 'p1' });
    assert.equal(result.question, undefined);
    assert.equal(fs.existsSync(statePath(dir)), false);
  });

  check('AC5: SubagentStop and the Codex host get no question', () => {
    const dir = project();
    const sub = handlePayload({ hook_event_name: 'SubagentStop', session_id: 's1', prompt_id: 'p1' }, { host: 'claude', projectDir: dir }).result;
    assert.equal(sub.question, undefined);
    assert.equal(stop(dir, { prompt_id: 'p1' }, PLAIN, 'codex').question, undefined);
  });

  check('AC6: without prompt_id it asks only when stop_hook_active is false', () => {
    const dir = project();
    assert.equal(stop(dir, {}).question, QUESTION);
    assert.equal(stop(dir, { stop_hook_active: true }).question, undefined);
  });

  check('AC6: a broken config or state file keeps it on, once per prompt', () => {
    const dir = project('{ not json');
    fs.writeFileSync(statePath(dir), '{ not json');
    assert.equal(stop(dir, { prompt_id: 'p1' }).question, QUESTION);
    assert.equal(stop(dir, { prompt_id: 'p1', stop_hook_active: true }).question, undefined);
  });

  check('AC6: an unwritable state file still asks once and never throws', () => {
    const dir = project();
    fs.mkdirSync(statePath(dir)); // a directory where the file should be: every write fails
    assert.equal(stop(dir, { prompt_id: 'p1' }).question, QUESTION);
    assert.equal(stop(dir, { prompt_id: 'p1', stop_hook_active: true }).question, undefined);
  });

  check('a claude -p / Agent SDK run (entrypoint sdk-*) gets no question; skipEntrypoints [] asks there too', () => {
    const dir = project();
    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-cli';
    try {
      assert.equal(stop(dir, { prompt_id: 'p1' }).question, undefined);
      const open = project(JSON.stringify({ bestAnswer: { skipEntrypoints: [] } }));
      assert.equal(stop(open, { prompt_id: 'p1' }).question, QUESTION);
    } finally { process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'; }
  });

  check('the user-wide config turns it off everywhere; a project setting wins over it', () => {
    const globalFile = path.join(home, '.crabshell', 'config.json');
    fs.writeFileSync(globalFile, JSON.stringify({ bestAnswer: { ask: false } }));
    try {
      assert.equal(stop(project(), { prompt_id: 'p1' }).question, undefined);
      const back = project(JSON.stringify({ bestAnswer: { ask: true } }));
      assert.equal(stop(back, { prompt_id: 'p1' }).question, QUESTION);
    } finally { fs.rmSync(globalFile, { force: true }); }
  });

  check('sessions keep their own prompt state', () => {
    const dir = project();
    stop(dir, { prompt_id: 'p1' });
    assert.equal(stop(dir, { prompt_id: 'p1', session_id: 's2' }).question, QUESTION);
    assert.equal(stop(dir, { prompt_id: 'p1', stop_hook_active: true }).question, undefined);
  });
} finally {
  if (savedEntry === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT; else process.env.CLAUDE_CODE_ENTRYPOINT = savedEntry;
  for (const [key, value] of Object.entries(savedHome)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  fs.rmSync(base, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
