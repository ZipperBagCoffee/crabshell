'use strict';
// D149_T002: the UserPromptSubmit hook as the host runs it. A pending memory save is
// noticed on the turn's first prompt only; a question turn gets the answer-first wording,
// an execution turn and a turn after a skipped save get before-other-work; the injection
// frequency and the hook's error fallback do not drop the notice. Turn numbers are real
// Claude Code 2.1.319 captures (fixtures/hook-payloads); only the prompt text is varied.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const turnStart = require('./fixtures/hook-payloads/native/claude-UserPromptSubmit-turn-start.json');
const queued = require('./fixtures/hook-payloads/native/claude-UserPromptSubmit-queued.json');
const { MEMORY_DIR, INDEX_FILE, DELTA_TEMP_FILE } = require('./constants');
const { noticeText, NOTICES } = require('./core/memory-notice');
const { FIRST_TURN_RULES } = require('./core/first-turn-context');
// Expected texts come from their sources, so rewording a notice or the rules breaks nothing here.
const CONTRACT = FIRST_TURN_RULES.trim();
const DELTA = NOTICES.delta.header;
const SIGNAL = NOTICES.delta.signal([]);
const firm = noticeText('delta', { firm: true });
const answerFirst = noticeText('delta', { firm: false });
const entry = path.join(__dirname, 'inject-rules.js');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS: ${name}`); } catch (error) { failed++; console.log(`FAIL: ${name} -- ${error.message}`); }
}

const created = [];
function project({ config } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-notice-timing-'));
  created.push(root);
  const memory = path.join(root, '.crabshell', MEMORY_DIR);
  fs.mkdirSync(memory, { recursive: true });
  fs.writeFileSync(path.join(memory, INDEX_FILE), JSON.stringify({ deltaReady: true }));
  fs.writeFileSync(path.join(memory, DELTA_TEMP_FILE), 'pending input line\n'.repeat(2000));
  if (config) fs.writeFileSync(path.join(memory, 'config.json'), JSON.stringify(config));
  return root;
}

function run(root, payload) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root, CRABSHELL_BACKGROUND: '' };
  delete env.CRABSHELL_HOOK_CAPTURE_DIR;
  const result = spawnSync(process.execPath, [entry], { cwd: root, env, input: JSON.stringify({ ...payload, cwd: root }), encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
  const out = result.stdout.trim();
  return { context: out ? JSON.parse(out).hookSpecificOutput.additionalContext : '', stderr: result.stderr };
}

const question = (payload, promptId) => ({ ...payload, prompt_id: promptId || payload.prompt_id, prompt: '됐나?' });
const request = (payload, promptId) => ({ ...payload, prompt_id: promptId || payload.prompt_id, prompt: '진행해' });

(async () => {
  await test('the turn\'s first prompt gets the save notice, a queued prompt of the same turn none, the next turn again', () => {
    const root = project();
    const first = run(root, question(turnStart));
    assert.ok(first.context.includes(DELTA), 'first prompt has the notice');
    assert.ok(first.stderr.includes(SIGNAL));
    const second = run(root, queued);
    assert.ok(!second.context.includes(DELTA), 'queued prompt repeats the notice');
    assert.ok(!second.context.includes(CONTRACT), 'queued prompt repeats the fixed block');
    assert.ok(!second.stderr.includes(SIGNAL), 'queued prompt prints the trigger line');
    const next = run(root, question(turnStart, 'd149-timing-next-turn'));
    assert.ok(next.context.includes(DELTA), 'next turn has the notice again');
  });

  await test('a question turn gets the answer-first wording, an execution turn before-other-work', () => {
    const asked = run(project(), question(turnStart)).context;
    assert.ok(asked.includes(answerFirst) && !asked.includes(firm), asked);
    const requested = run(project(), request(turnStart)).context;
    assert.ok(requested.includes(firm) && !requested.includes(answerFirst), requested);
  });

  await test('a question turn after a skipped save gets before-other-work', () => {
    const root = project();
    run(root, question(turnStart));
    const next = run(root, question(turnStart, 'd149-timing-after-skip')).context;
    assert.ok(next.includes(firm), next);
  });

  await test('with rulesInjectionFrequency 2, an execution prompt that skips the rule block still gets the save notice', () => {
    const out = run(project({ config: { rulesInjectionFrequency: 2 } }), request(turnStart));
    assert.ok(!out.context.includes(CONTRACT), 'this prompt was meant to skip the fixed block');
    assert.ok(out.context.includes(DELTA), 'notice dropped with the skipped block');
  });

  await test('when the hook falls back to the basic rules after an error, the save notice is still there', async () => {
    const root = project();
    const firstTurn = require('./core/first-turn-context');
    const original = firstTurn.buildFirstTurnContext;
    firstTurn.buildFirstTurnContext = () => { throw new Error('forced failure for the fallback path'); };
    const lines = [];
    const log = console.log;
    const errorLog = console.error;
    try {
      delete require.cache[require.resolve('./inject-rules')];
      const { main } = require('./inject-rules');
      console.log = text => lines.push(String(text));
      console.error = () => {};
      await main({ hookData: question(turnStart), projectDir: root });
    } finally {
      console.log = log;
      console.error = errorLog;
      firstTurn.buildFirstTurnContext = original;
      delete require.cache[require.resolve('./inject-rules')];
    }
    const context = lines.map(line => JSON.parse(line).hookSpecificOutput.additionalContext).join('\n');
    assert.ok(context.includes(CONTRACT), 'basic rules missing from the fallback');
    assert.ok(context.includes(DELTA), 'save notice missing from the fallback');
  });

  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\nmemory-notice-timing: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  process.exitCode = failed ? 1 : 0;
})();
