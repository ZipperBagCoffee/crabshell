'use strict';

// D178_T001: scripts/guard-record.js — blocks found in session transcripts (--backfill), the
// per-guard summary (--summary) and the wired-guard check (--check). Fixture transcripts and
// projects live under the OS temp folder.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { wiredNames } = require('./guard-record');
const { firesFile } = require('./core/guard-fires');

const SCRIPT = path.join(__dirname, 'guard-record.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-guard-record-'));
let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}

function run(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

const project = path.join(root, 'project');
fs.mkdirSync(path.join(project, '.crabshell', 'memory'), { recursive: true });
const transcripts = path.join(root, 'transcripts');
const sessionDir = path.join(transcripts, 'some-project');
fs.mkdirSync(path.join(sessionDir, 'sess-a', 'subagents'), { recursive: true });

const SYCO = 'Crabshell sycophancy-guard: you agreed ("맞아요") without checking anything in this turn.';
const DENY = 'Direct write to .crabshell/discussion/ blocked: this session has not loaded the discussing skill.';
const lines = [
  { type: 'user', cwd: project, sessionId: 'sess-a', promptId: 'pr1', message: { role: 'user', content: '그거 틀렸잖아' } },
  { type: 'assistant', sessionId: 'sess-a', message: { id: 'm1', model: 'claude-old', content: [{ type: 'text', text: '맞아요.' }] } },
  { type: 'attachment', sessionId: 'sess-a', timestamp: '2026-11-14T08:00:00.000Z', attachment: { type: 'hook_blocking_error', hookEvent: 'Stop', blockingError: { blockingError: SYCO } } },
  { type: 'assistant', sessionId: 'sess-a', message: { id: 'm2', model: 'claude-old', content: [{ type: 'text', text: '확인해 볼게요.' }] } },
  { type: 'assistant', sessionId: 'sess-a', message: { id: 'm2', model: 'claude-old', content: [{ type: 'tool_use', name: 'Read', input: {} }] } },
  { type: 'user', sessionId: 'sess-a', promptId: 'pr1', timestamp: '2026-11-15T09:00:00.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true, content: `PreToolUse:Write hook error: ${DENY}` }] } },
  { type: 'user', sessionId: 'sess-a', promptId: 'pr2', message: { role: 'user', content: '다시 물어볼게' } },
  { type: 'attachment', sessionId: 'sess-a', timestamp: '2026-11-15T10:00:00.000Z', attachment: { type: 'hook_blocking_error', hookEvent: 'Stop', blockingError: { blockingError: SYCO } } },
  { type: 'api-request-blob', sessionId: 'sess-a', message: { content: [{ type: 'tool_result', content: `PreToolUse:Write hook error: ${DENY}` }] } },
  { type: 'user', sessionId: 'sess-a', message: { content: [{ type: 'tool_result', content: 'grep output: PreToolUse:Write hook error: quoted, not a block' }] } },
  { type: 'attachment', sessionId: 'sess-a', attachment: { type: 'hook_blocking_error', hookEvent: 'Stop' } },
];
fs.writeFileSync(path.join(sessionDir, 'sess-a.jsonl'), lines.map(line => JSON.stringify(line)).join('\n') + '\n{"type":"assistant", broken\n');
fs.writeFileSync(path.join(sessionDir, 'sess-a', 'subagents', 'agent-1.jsonl'), JSON.stringify(
  { type: 'attachment', sessionId: 'sess-a', timestamp: '2026-11-16T00:00:00.000Z', attachment: { type: 'hook_blocking_error', hookEvent: 'SubagentStop', blockingError: { blockingError: 'Crabshell web-guard: read the source.' } } }) + '\n');

const backfillFile = path.join(project, '.crabshell', 'memory', 'guard-fires', 'backfill.jsonl');
const readBackfill = () => fs.readFileSync(backfillFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));

try {
  check('AC1: --backfill keeps the two real blocks and the subagent one, skips the blob copy, the quoted text, the textless block and the broken line', () => {
    const result = run(['--backfill', '--project-dir', project, '--transcripts', transcripts, '--workers', '2']);
    assert.equal(result.status, 0, result.stderr);
    const fires = readBackfill();
    assert.deepEqual(fires.map(fire => [fire.event, fire.tool, fire.guard]),
      [['Stop', null, 'sycophancy-guard'], ['PreToolUse', 'Write', null], ['Stop', null, 'sycophancy-guard'], ['SubagentStop', null, 'web-guard']]);
    assert.notEqual(fires[0].key, fires[2].key, 'the same block in another prompt is another incident');
    assert.equal(fires[1].key, require('./core/guard-fires').fireKey('sess-a', 'PreToolUse', 'tu1', DENY), 'a deny is keyed by its tool call, as the live record is');
    assert.equal(fires[0].model, 'claude-old');
    assert.equal(fires[0].next, 'Read');
    assert(fires.every(fire => fire.backfilled === true && /^[0-9a-f]{16}$/.test(fire.key)));
    assert.match(result.stderr, /1 broken lines/);
    assert.match(result.stderr, /1 blocks without text/);
    const projects = JSON.parse(fs.readFileSync(path.join(project, '.crabshell', 'memory', 'guard-fires', 'projects.json'), 'utf8'));
    assert.deepEqual(projects.liveLogs, []);
  });

  check('AC3: --summary prints keep, injector, no-fire, live/backfilled and grouping lines', () => {
    fs.writeFileSync(path.join(project, '.crabshell', 'guard-record.json'), JSON.stringify({ guards: [
      { guard: 'sycophancy-guard', kind: 'guard', why: [{ version: 'v1.0.0', ref: 'D001', text: 'Agreeing without checking.' }],
        predicts: [{ case: 'An unchecked agreement is sent back.', source: 'test' }], misses: [], keep: { words: 'most useful', date: '2026-11-20' }, history: [] },
      { guard: 'docs-guard', kind: 'guard', why: [], predicts: [], misses: [], history: [] },
      { guard: 'inject-rules', kind: 'injector', why: [], predicts: [], misses: [], history: [] },
      { guard: 'quiet-guard', kind: 'guard', why: [], predicts: [], misses: [{ date: '2026-01-01', text: 'Missed once.', source: 'D002' }], history: [{ version: 'v0.9.0', change: 'added', ref: 'abc1234' }] },
    ] }));
    fs.mkdirSync(path.dirname(firesFile(project)), { recursive: true });
    const sycoKey = readBackfill()[0].key;
    fs.writeFileSync(firesFile(project), [
      { at: '2026-11-20T00:00:00.000Z', guard: 'sycophancy-guard', kind: 'block', model: 'claude-new', key: sycoKey, words: 'Crabshell sycophancy-guard: you' },
      { at: '2026-11-20T00:01:00.000Z', guard: 'docs-guard', kind: 'notice', model: 'claude-new', key: 'k-notice', words: 'Note' },
    ].map(line => JSON.stringify(line)).join('\n') + '\n');
    const result = run(['--summary', '--project-dir', project, '--transcripts', transcripts]);
    assert.equal(result.status, 0, result.stderr);
    const out = result.stdout;
    assert(out.includes('sycophancy-guard — Agreeing without checking. (v1.0.0, D001)'), out);
    assert(out.includes('  keep: most useful (2026-11-20)'), out);
    assert(out.includes('  predicts: An unchecked agreement is sent back.'), out);
    // The live block and its transcript copy share a key: counted once, as live, with the next action from the transcript.
    assert(out.includes('  claude-new: 1 live, 0 backfilled blocks; 0 notices; 0 repeats (2026-11-20 to 2026-11-20)'), out);
    assert(out.includes('  claude-old: 0 live, 1 backfilled blocks; 0 notices; 0 repeats (2026-11-15 to 2026-11-15)'), out);
    assert(out.includes('    after a block: 1 called a tool, 0 answered in text only, 0 not captured'), out);
    assert(out.includes('    reviewed 0 of 1: 0 caught, 0 false alarm, 0 unclear'), out);
    assert(out.includes('  injects every time; not a fire'), out);
    assert(out.includes('quiet-guard — no reason recorded'), out);
    assert(out.includes('  no fires recorded'), out);
    assert(out.includes('  missed: 2026-01-01 Missed once.'), out);
    assert(out.includes('  history: v0.9.0 added (abc1234)'), out);
    assert(out.includes('web-guard — not in the record'), out);
    assert(out.includes('Blocks not matched to a guard'), out);
  });

  check('AC3: a groups.json prefix names an unnamed block', () => {
    fs.writeFileSync(path.join(project, '.crabshell', 'memory', 'guard-fires', 'groups.json'), JSON.stringify({ prefixes: [{ prefix: 'Direct write to', guard: 'docs-guard' }] }));
    const out = run(['--summary', '--project-dir', project, '--transcripts', transcripts]).stdout;
    assert(!out.includes('Blocks not matched to a guard'), out);
    const docs = out.slice(out.indexOf('docs-guard — '), out.indexOf('\n\n', out.indexOf('docs-guard — ')));
    assert(docs.includes('  claude-old: 0 live, 1 backfilled blocks; 0 notices; 0 repeats (2026-11-15 to 2026-11-15)'), docs);
    assert(docs.includes('  claude-new: 0 live, 0 backfilled blocks; 1 notices; 0 repeats (2026-11-20 to 2026-11-20)'), docs);
  });

  check('AC4: --check names each wired guard missing from the record and exits 1; a full record exits 0', () => {
    const wired = wiredNames();
    assert(wired.includes('web-guard') && wired.includes('best-answer') && wired.includes('inject-rules'), wired.join(','));
    assert(!wired.includes('sycophancy-guard'), 'a removed guard is not wired');
    assert(!wired.includes('pre-tool-use') && !wired.includes('post-tool-use'), 'dispatchers are expanded, not listed');
    const missing = run(['--check', '--project-dir', project]);
    assert.equal(missing.status, 1);
    assert(missing.stdout.includes('not in the record: best-answer'), missing.stdout);
    assert(missing.stdout.includes('not in the record: web-guard'), missing.stdout);
    fs.writeFileSync(path.join(project, '.crabshell', 'guard-record.json'), JSON.stringify({ guards: wired.map(guard => ({ guard })) }));
    const full = run(['--check', '--project-dir', project]);
    assert.equal(full.status, 0, full.stdout);
  });
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
