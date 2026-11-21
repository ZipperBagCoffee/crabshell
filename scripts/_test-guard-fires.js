'use strict';

// D178_T002: a guard block or notice that a hook actually sent leaves one line in
// .crabshell/memory/logs/guard-fires.jsonl, written after the output; the hook's stdout and
// exit code never change because of it. Real hook processes, temporary projects only.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { recordFires, firesFile, firstWords, DEFAULTS } = require('./core/guard-fires');
const control = require('./core/completion-control');

const SCRIPTS = __dirname;
const CLAUDE_PRE = path.join(SCRIPTS, 'adapters', 'claude', 'pre-tool-use.js');
const CODEX_PRE = path.join(SCRIPTS, 'adapters', 'codex', 'pre-tool-use.js');
const CONTROLLER = path.join(SCRIPTS, 'completion-controller.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-guard-fires-'));
const home = path.join(root, '_home');
fs.mkdirSync(home, { recursive: true });

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}

let projects = 0;
function project(config) {
  const dir = path.join(root, `p${++projects}`);
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  if (config) fs.writeFileSync(path.join(dir, '.crabshell', 'memory', 'config.json'), JSON.stringify(config));
  return dir;
}

function run(script, payload, dir, options = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CONFIG_DIR: path.join(root, '_claude-config') };
  if (options.isolateHome !== false) { env.HOME = home; env.USERPROFILE = home; }
  delete env.CRABSHELL_BACKGROUND;
  delete env.CRABSHELL_HOOK_CAPTURE_DIR;
  delete env.CLAUDE_CODE_SESSION_ID;
  const result = spawnSync(process.execPath, [script], { cwd: dir, env, input: JSON.stringify(payload),
    encoding: 'utf8', timeout: 60000, windowsHide: true });
  return { status: result.status, stdout: result.stdout || '' };
}

function fires(dir) {
  const file = firesFile(dir);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

const fwd = value => value.replace(/\\/g, '/');
// A document written without its skill is denied (the D4 case of _test-claude-dispatchers.js).
function denyPayload(dir, extra = {}) {
  return { hook_event_name: 'PreToolUse', session_id: 'sess-1', tool_name: 'Write', tool_use_id: 'w1',
    tool_input: { file_path: fwd(path.join(dir, '.crabshell', 'ticket', 'P900_T001-x.md')), content: '# x\n' }, ...extra };
}

function transcript(lines) {
  const file = path.join(root, `t${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`);
  fs.writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  return file;
}
const human = text => ({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const said = (text, model) => ({ type: 'assistant', message: { ...(model ? { model } : {}), content: [{ type: 'text', text }] } });

const EXECUTE = 'Implement the active ticket.';
function stopPayload(answer, extra = {}, prompt = '그거 틀렸잖아') {
  return { hook_event_name: 'Stop', session_id: 'sess-1', stop_hook_active: false,
    transcript_path: transcript([human(prompt), said(answer)]), last_assistant_message: answer, ...extra };
}
// A real Stop block from completion-controller: an authorized request while a regressing
// workflow is still active (fixture as in _test-cross-runtime-parent-completion.js).
function activeWorkflow(dir, promptId) {
  const storage = path.join(dir, '.crabshell');
  for (const sub of ['discussion', 'plan', 'ticket', 'memory']) fs.mkdirSync(path.join(storage, sub), { recursive: true });
  fs.writeFileSync(path.join(storage, 'discussion', 'D777-fixture.md'), '---\nid: D777\nstatus: open\n---\n# D777\n');
  fs.writeFileSync(path.join(storage, 'plan', 'P777-fixture.md'), '---\nid: P777\nstatus: in-progress\n---\n## Acceptance Criteria\n- fixture\n');
  fs.writeFileSync(path.join(storage, 'ticket', 'P777_T001-fixture.md'), '---\nid: P777_T001\nstatus: in-progress\n---\n## Acceptance Criteria\n- fixture\n\n## Log\n- fixture active\n');
  fs.writeFileSync(path.join(storage, 'memory', 'regressing-state.json'), JSON.stringify({ active: true, phase: 'execution',
    discussion: 'D777', planId: 'P777', ticketIds: ['P777_T001'], lastUpdatedAt: new Date().toISOString() }));
  control.noteExecutionAuthorization(dir, { session_id: 'sess-1', prompt_id: promptId, prompt: EXECUTE });
}
const blockedStop = (dir, promptId) => run(CONTROLLER, stopPayload('끝났어요.', { prompt_id: promptId }, EXECUTE), dir);

try {
  check('AC1: a Claude PreToolUse deny leaves one block line named by its check', () => {
    const dir = project();
    const result = run(CLAUDE_PRE, denyPayload(dir), dir);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
    const lines = fires(dir);
    const blocks = lines.filter(line => line.kind === 'block');
    assert.deepEqual(blocks.map(line => line.guard), ['docs-guard'], JSON.stringify(lines));
    const line = blocks[0];
    assert.equal(line.host, 'claude');
    assert.equal(line.event, 'PreToolUse');
    assert.equal(line.tool, 'Write');
    assert.equal(line.sessionId, 'sess-1');
    assert.match(line.key, /^[0-9a-f]{16}$/);
    assert.equal(line.words, firstWords(output.hookSpecificOutput.permissionDecisionReason, DEFAULTS.reasonWords));
    assert.equal(line.model, null, 'no model in the payload and no transcript');
  });

  check('AC2: a Stop block names the check that blocked; the deferred question is not recorded; a sent question is', () => {
    const dir = project();
    activeWorkflow(dir, 'p1');
    const blocked = blockedStop(dir, 'p1');
    assert.equal(blocked.status, 2, blocked.stdout);
    assert.equal(JSON.parse(blocked.stdout.trim()).decision, 'block');
    assert.deepEqual(fires(dir).map(line => [line.guard, line.kind]), [['completion-controller', 'block']]);
    const asked = run(CONTROLLER, stopPayload('이건 설정 파일이에요.', { prompt_id: 'p2' }), dir);
    assert.equal(asked.status, 0);
    assert(JSON.parse(asked.stdout.trim()).hookSpecificOutput.additionalContext, asked.stdout);
    assert.deepEqual(fires(dir).map(line => [line.guard, line.kind]), [['completion-controller', 'block'], ['best-answer', 'notice']]);
  });

  check('AC2: the same block in one prompt shares the first key (a repeat, not a new incident)', () => {
    const dir = project();
    activeWorkflow(dir, 'p1');
    blockedStop(dir, 'p1');
    blockedStop(dir, 'p1');
    const keys = fires(dir).filter(line => line.guard === 'completion-controller').map(line => line.key);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    activeWorkflow(dir, 'p9');
    blockedStop(dir, 'p9');
    const third = fires(dir).filter(line => line.guard === 'completion-controller').map(line => line.key)[2];
    assert.notEqual(third, keys[0], 'the same block in another prompt is another incident');
  });

  check('AC3: with logs unwritable, stdout and exit code are the same as when it is writable', () => {
    const dir = project();
    const logs = path.join(dir, '.crabshell', 'memory', 'logs');
    fs.writeFileSync(logs, 'not a folder');
    activeWorkflow(dir, 'p1');
    const unwritable = run(CLAUDE_PRE, denyPayload(dir), dir);
    const stopUnwritable = blockedStop(dir, 'p1');
    fs.unlinkSync(logs);
    const writable = run(CLAUDE_PRE, denyPayload(dir), dir);
    const stopWritable = blockedStop(dir, 'p1');
    assert.equal(JSON.parse(stopWritable.stdout.trim()).decision, 'block');
    assert.equal(unwritable.stdout, writable.stdout);
    assert.equal(unwritable.status, writable.status);
    assert.equal(stopUnwritable.stdout, stopWritable.stdout);
    assert.equal(stopUnwritable.status, stopWritable.status);
    assert(fires(dir).length > 0, 'the writable runs recorded');
  });

  check('AC4: at maxBytes the file turns into .1 and the new line starts a fresh file', () => {
    const dir = project({ guardFires: { maxBytes: 10 } });
    const file = firesFile(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const old = JSON.stringify({ guard: 'older', padding: 'x'.repeat(40) }) + '\n';
    fs.writeFileSync(file, old);
    run(CLAUDE_PRE, denyPayload(dir), dir);
    assert.equal(fs.readFileSync(file + '.1', 'utf8'), old);
    assert.deepEqual(fires(dir).map(line => line.guard), ['docs-guard']);
  });

  check('AC5: a Codex PreToolUse deny is recorded with host codex and the model Codex sent', () => {
    const dir = project();
    const fixture = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'fixtures', 'codex', 'pre-tool-use.json'), 'utf8'));
    // Another project's memory outside the temp folder (temp paths are exempt); denied, never written.
    const other = path.join(os.homedir(), 'crabshell guard-fires other project', '.crabshell', 'memory', 'logbook.md');
    const result = run(CODEX_PRE, { ...fixture, cwd: dir, tool_input: { command: `echo note >> "${other}"` } }, dir, { isolateHome: false });
    assert.equal(JSON.parse(result.stdout.trim()).hookSpecificOutput.permissionDecision, 'deny');
    const lines = fires(dir);
    assert.deepEqual(lines.map(line => [line.host, line.kind]), [['codex', 'block']]);
    assert.equal(lines[0].model, fixture.model);
    assert.equal(fs.existsSync(other), false);
  });

  check('D179: a file edit right after agreeing with nothing checked is not denied', () => {
    const dir = project();
    const file = transcript([human('이거 고쳐'), said('맞아요, 고칠게요.')]);
    const target = fwd(path.join(dir, 'src', 'x.js'));
    const result = run(CLAUDE_PRE, { hook_event_name: 'PreToolUse', session_id: 'sess-1', tool_name: 'Edit', transcript_path: file,
      tool_input: { file_path: target, old_string: 'a', new_string: 'b' } }, dir);
    assert(!/"permissionDecision":"deny"/.test(result.stdout), result.stdout);
  });

  check('AC6: a call no guard answers leaves no file', () => {
    const dir = project();
    const result = run(CLAUDE_PRE, { hook_event_name: 'PreToolUse', session_id: 'sess-1', tool_name: 'Glob', tool_input: { pattern: '*.md', path: fwd(dir) } }, dir);
    assert.equal(result.stdout.trim(), '');
    assert.equal(fs.existsSync(firesFile(dir)), false);
  });

  check('AC7: the model comes from the payload, else the transcript tail, else null', () => {
    const dir = project();
    const file = transcript([human('x'), said('first', 'claude-old-model'), said('second', 'claude-tail-model'), { type: 'assistant', message: { model: '<synthetic>', content: [] } }]);
    run(CLAUDE_PRE, denyPayload(dir, { transcript_path: file }), dir);
    run(CLAUDE_PRE, denyPayload(dir, { transcript_path: file, model: 'claude-given-model' }), dir);
    run(CLAUDE_PRE, denyPayload(dir, { transcript_path: path.join(root, 'missing.jsonl') }), dir);
    assert.deepEqual(fires(dir).map(line => line.model), ['claude-tail-model', 'claude-given-model', null]);
  });

  check('each fired item is judged alone: an invalid one is skipped, the valid one kept', () => {
    const dir = project();
    const written = recordFires(dir, { host: 'claude', event: 'PreToolUse', payload: {}, fired: [
      { guard: 'kept-guard', channel: 'reason', text: 'Blocked because of a thing' },
      { guard: '', channel: 'reason', text: 'no name' },
      { guard: 'odd-channel', channel: 'log', text: 'not sent to anyone' },
      { guard: 'no-text', channel: 'context', text: '' },
    ] });
    assert.equal(written, 1);
    assert.deepEqual(fires(dir).map(line => [line.guard, line.kind, line.words]), [['kept-guard', 'block', 'Blocked because of a thing']]);
  });

  check('absolute paths in the kept words are masked; relative ones stay', () => {
    assert.equal(firstWords('Wrong path: C:/Users/someone/x.md and "/home/someone/y" or ~/z, keep .crabshell/ticket/', 9),
      'Wrong path: <path> and <path> or <path> keep .crabshell/ticket/');
  });
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
