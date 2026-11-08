'use strict';
// D149_T001: memory notices (pending save, pending archive summaries, the Codex note) are
// decided once per host turn. An execution request saves before other work; any other turn
// answers first and saves in the same response; a notice given answer-first that saw no
// progress by the next turn comes back as before-other-work. Turn numbers come from real
// Claude Code 2.1.319 captures (fixtures/hook-payloads).

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const turnStart = require('./fixtures/hook-payloads/native/claude-UserPromptSubmit-turn-start.json');
const queued = require('./fixtures/hook-payloads/native/claude-UserPromptSubmit-queued.json');
const { notePrompt } = require('./core/turn-state');
const { readSessionState, writeSessionState, stateFile } = require('./core/session-state');
const { MEMORY_DIR, INDEX_FILE, DELTA_TEMP_FILE } = require('./constants');

let notice;
try { notice = require('./core/memory-notice'); } catch (error) { notice = { loadError: error }; }

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); } catch (error) { failed++; console.log(`FAIL: ${name} -- ${error.message}`); }
}

const created = [];
function project({ delta = false, rotated = [], index = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-memory-notice-'));
  created.push(root);
  const memory = path.join(root, '.crabshell', MEMORY_DIR);
  fs.mkdirSync(memory, { recursive: true });
  const fullIndex = { ...index };
  if (delta) {
    fullIndex.deltaReady = true;
    // Enough input to pass the pending threshold (core/memory-notice checkDeltaPending).
    fs.writeFileSync(path.join(memory, DELTA_TEMP_FILE), 'pending input line\n'.repeat(2000));
  }
  if (rotated.length) fullIndex.rotatedFiles = rotated.map(file => ({ file, summaryGenerated: false }));
  fs.writeFileSync(path.join(memory, INDEX_FILE), JSON.stringify(fullIndex));
  return { root, memory, index: fullIndex };
}

const nextTurn = { ...turnStart, prompt_id: 'd149-next-turn-0000' };
const thirdTurn = { ...turnStart, prompt_id: 'd149-third-turn-0000' };
const noTurn = { session_id: turnStart.session_id, hook_event_name: 'UserPromptSubmit', prompt: 'What changed?' };

function decide(p, payload, { intent = 'question', newTurn = true, host = 'claude' } = {}) {
  return notice.memoryNotices(p.root, payload, { host, intent, newTurn, index: p.index });
}

// The expected wording comes from the notice module itself: these tests check which notice
// is chosen and when, not how it is phrased, so rewording a notice breaks none of them.
const firm = (name, files) => notice.noticeText(name, { firm: true, files });
const answerFirst = (name, files) => notice.noticeText(name, { firm: false, files });

test('module loads', () => {
  assert.ok(!notice.loadError, notice.loadError && notice.loadError.message);
});

test('each notice has two different wordings, both carrying its trigger and its skill call', () => {
  for (const [name, row] of Object.entries(notice.NOTICES)) {
    assert.notStrictEqual(firm(name), answerFirst(name), name);
    for (const text of [firm(name), answerFirst(name)]) {
      assert.ok(text.includes(row.header), `${name} header`);
      assert.ok(text.includes(`skill="${row.skill}"`), `${name} skill call`);
    }
  }
});

// AC1 — the turn's first prompt is told apart from a queued prompt of the same turn.
test('notePrompt: first prompt of a turn is newTurn, a queued prompt of the same turn is not', () => {
  const p = project();
  assert.strictEqual(notePrompt(p.root, turnStart, { intent: 'question', userAuthored: true }).newTurn, true);
  assert.strictEqual(notePrompt(p.root, queued, { intent: 'default', userAuthored: false }).newTurn, false);
  assert.strictEqual(notePrompt(p.root, nextTurn, { intent: 'question', userAuthored: true }).newTurn, true);
});

test('notePrompt: a same-turn prompt keeps other fields of the turn record; a new turn starts clean', () => {
  const p = project();
  notePrompt(p.root, turnStart, { intent: 'question', userAuthored: true });
  const stored = readSessionState(p.root, turnStart.session_id, 'turn', null);
  writeSessionState(p.root, turnStart.session_id, 'turn', { ...stored, extraField: 'kept' });
  notePrompt(p.root, queued, { intent: 'default', userAuthored: false });
  assert.strictEqual(readSessionState(p.root, turnStart.session_id, 'turn', null).extraField, 'kept');
  notePrompt(p.root, nextTurn, { intent: 'question', userAuthored: true });
  assert.strictEqual(readSessionState(p.root, turnStart.session_id, 'turn', null).extraField, undefined);
});

test('notePrompt: a payload without a turn number counts as a new turn every time', () => {
  const p = project();
  assert.strictEqual(notePrompt(p.root, noTurn, { intent: 'question', userAuthored: true }).newTurn, true);
  assert.strictEqual(notePrompt(p.root, noTurn, { intent: 'question', userAuthored: true }).newTurn, true);
});

// AC2 — wording by intent; nothing on a later prompt of the turn.
test('a question turn gets the answer-first save notice', () => {
  const p = project({ delta: true });
  const out = decide(p, turnStart, { intent: 'question' });
  assert.strictEqual(out.context, answerFirst('delta'));
  assert.deepStrictEqual(out.stderr, [notice.NOTICES.delta.signal([])]);
});

test('an execution turn gets the before-other-work save notice', () => {
  const p = project({ delta: true });
  assert.strictEqual(decide(p, turnStart, { intent: 'execution' }).context, firm('delta'));
});

test('a later prompt of the same turn gets no memory notice', () => {
  const p = project({ delta: true });
  decide(p, turnStart, { intent: 'question' });
  const out = decide(p, queued, { intent: 'default', newTurn: false });
  assert.strictEqual(out.context, '');
  assert.deepStrictEqual(out.stderr, []);
});

// AC3 — a missed answer-first notice comes back as before-other-work.
test('answer-first notice with no progress by the next turn comes back before other work', () => {
  const p = project({ delta: true });
  assert.strictEqual(decide(p, turnStart, { intent: 'question' }).context, answerFirst('delta'));
  assert.strictEqual(decide(p, nextTurn, { intent: 'question' }).context, firm('delta'));
});

test('progress on the save (a prepared job) keeps the next turn answer-first', () => {
  const p = project({ delta: true });
  decide(p, turnStart, { intent: 'question' });
  p.index.deltaJob = { id: 'job-after-notice', status: 'ready' };
  assert.strictEqual(decide(p, nextTurn, { intent: 'question' }).context, answerFirst('delta'));
});

test('after a before-other-work notice the next question turn is answer-first again', () => {
  const p = project({ delta: true });
  decide(p, turnStart, { intent: 'question' });
  assert.strictEqual(decide(p, nextTurn, { intent: 'question' }).context, firm('delta'));
  assert.strictEqual(decide(p, thirdTurn, { intent: 'question' }).context, answerFirst('delta'));
});

test('without a turn number every prompt gets the before-other-work notice (old behavior)', () => {
  const p = project({ delta: true });
  assert.strictEqual(decide(p, noTurn, { intent: 'question' }).context, firm('delta'));
  assert.strictEqual(decide(p, noTurn, { intent: 'question' }).context, firm('delta'));
});

// AC4 — Codex, nothing pending, archive summaries.
test('Codex gets only its pending note, never a Claude skill trigger', () => {
  const p = project({ delta: true, rotated: ['logbook_20260101_000000.md'] });
  const out = decide(p, { ...turnStart, turn_id: 'codex-turn' }, { intent: 'question', host: 'codex' });
  assert.ok(out.context.includes(notice.CODEX_PENDING), out.context);
  for (const row of Object.values(notice.NOTICES)) {
    assert.ok(!(out.context + out.stderr.join('\n')).includes(row.header), out.context);
  }
});

test('nothing pending gives nothing and clears the record', () => {
  const p = project({ delta: true });
  decide(p, turnStart, { intent: 'question' });
  fs.rmSync(path.join(p.memory, DELTA_TEMP_FILE));
  p.index.deltaReady = false;
  const out = decide(p, nextTurn, { intent: 'question' });
  assert.strictEqual(out.context, '');
  const record = readSessionState(p.root, turnStart.session_id, notice.STATE_NAME, {});
  assert.strictEqual(record.delta, undefined);
});

test('archive summaries follow the same rules and name the files', () => {
  const files = ['logbook_20260101_000000.md'];
  const p = project({ rotated: files });
  assert.strictEqual(decide(p, turnStart, { intent: 'question' }).context, answerFirst('rotate', files));
  assert.strictEqual(decide(p, nextTurn, { intent: 'question' }).context, firm('rotate', files));
});

test('the pending-save size comes from the project config, with the module default otherwise', () => {
  const small = 'x'.repeat(Math.floor(notice.MIN_DELTA_SIZE / 2));
  const withoutConfig = project({ index: { deltaReady: true } });
  fs.writeFileSync(path.join(withoutConfig.memory, DELTA_TEMP_FILE), small);
  assert.strictEqual(decide(withoutConfig, turnStart, { intent: 'execution' }).context, '');
  const withConfig = project({ index: { deltaReady: true } });
  fs.writeFileSync(path.join(withConfig.memory, DELTA_TEMP_FILE), small);
  fs.writeFileSync(path.join(withConfig.memory, 'config.json'), JSON.stringify({ deltaMinBytes: small.length - 1 }));
  assert.strictEqual(decide(withConfig, turnStart, { intent: 'execution' }).context, firm('delta'));
});

// AC5 — a broken record never throws and errs toward saving first.
test('a corrupt notice record gives the before-other-work notice without throwing', () => {
  const p = project({ delta: true });
  const file = stateFile(p.root, turnStart.session_id, notice.STATE_NAME);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not json');
  assert.strictEqual(decide(p, turnStart, { intent: 'question' }).context, firm('delta'));
});

for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nmemory-notice: ${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exitCode = failed ? 1 : 0;
