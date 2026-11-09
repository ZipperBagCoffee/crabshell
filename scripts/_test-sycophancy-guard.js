'use strict';
// D162: the restored sycophancy guard. Agreeing with the person while nothing was checked
// in the turn is sent back once at Stop and blocks a file write; a check earlier in the
// turn, a phrase inside code or quotes, and the answer after a block pass.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const guard = require('./sycophancy-guard');
const { legacyClaudeStopReasons } = require('./completion-controller');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-sycophancy-'));
let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}

const prompt = text => ({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const say = text => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const call = (name, id = name) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
const result = id => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
let count = 0;
function transcript(entries) {
  const file = path.join(base, `session-${++count}.jsonl`);
  fs.writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  return file;
}
const stop = (entries, extra = {}) => {
  const file = transcript(entries);
  const last = [...entries].reverse().find(entry => entry.type === 'assistant' && entry.message.content[0].type === 'text');
  return guard.stopReason({ hook_event_name: 'Stop', transcript_path: file, last_assistant_message: last ? last.message.content[0].text : '', ...extra });
};

try {
  check('Stop sends back an answer that agrees when nothing was checked in the turn', () => {
    const reason = stop([prompt('그거 틀렸잖아'), say('맞아요, 제가 틀렸어요.')]);
    assert(reason && reason.includes('"맞아요"'), String(reason));
  });

  check('Stop passes the same answer after a tool checked the claim in this turn', () => {
    assert.equal(stop([prompt('그거 틀렸잖아'), call('Read'), result('Read'), say('맞아요, 파일을 보니 그 줄이 없어요.')]), null);
  });

  check('a check made before the person spoke again does not count for this turn', () => {
    const reason = stop([prompt('먼저 질문'), call('Read'), result('Read'), say('읽었어요.'), prompt('그거 틀렸잖아'), say("You're right, my mistake.")]);
    assert(reason && /you'?re right/i.test(reason), String(reason));
  });

  check('a phrase inside code or quotes is not agreement; plain answers pass', () => {
    assert.equal(stop([prompt('예시 보여줘'), say('패턴 예: `맞아요` 그리고\n```\nyou are right\n```')]), null);
    assert.equal(stop([prompt('이거 뭐야?'), say('이건 설정 파일이에요.')]), null);
  });

  check('the answer that follows a block passes (stop_hook_active)', () => {
    assert.equal(stop([prompt('그거 틀렸잖아'), say('맞아요.')], { stop_hook_active: true }), null);
  });

  check('the Claude Stop checks carry the reason, and an unreadable transcript fails open', () => {
    const file = transcript([prompt('그거 틀렸잖아'), say('말씀이 맞습니다.')]);
    const reasons = legacyClaudeStopReasons({ hook_event_name: 'Stop', transcript_path: file, last_assistant_message: '말씀이 맞습니다.' }, base);
    assert(reasons.some(reason => reason.includes('sycophancy-guard')), JSON.stringify(reasons));
    assert.equal(guard.stopReason({ transcript_path: path.join(base, 'missing.jsonl'), last_assistant_message: '맞아요.' }), null);
  });

  check('a file write right after unchecked agreement is blocked; after a check it passes', () => {
    const blocked = guard.writeReason({ tool_name: 'Edit', transcript_path: transcript([prompt('이거 고쳐'), say('맞아요, 고칠게요.'), call('Edit')]) });
    assert(blocked && blocked.includes('"맞아요"'), String(blocked));
    assert.equal(guard.writeReason({ tool_name: 'Edit', transcript_path: transcript([prompt('이거 고쳐'), call('Grep'), result('Grep'), say('맞아요, 그 줄이 틀렸네요.'), call('Edit')]) }), null);
  });

  check('the PreToolUse dispatch denies that write', () => {
    const file = transcript([prompt('이거 고쳐'), say('맞아요, 고칠게요.'), call('Edit')]);
    const payload = { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(base, 'x.txt'), old_string: 'a', new_string: 'b' }, transcript_path: file, cwd: base };
    const env = { ...process.env, CLAUDE_PROJECT_DIR: base };
    delete env.CRABSHELL_BACKGROUND;
    const run = spawnSync(process.execPath, [path.join(__dirname, 'adapters', 'claude', 'pre-tool-use.js')], { input: JSON.stringify(payload), env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert(/sycophancy-guard/.test(run.stdout + run.stderr), run.stdout + run.stderr);
  });
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

console.log(`sycophancy-guard: ${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed ? 1 : 0);
