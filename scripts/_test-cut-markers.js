'use strict';
// D187_T002: every place that cuts text or a list for the memory path leaves a marker
// that says something was cut and how much; text within its limit is returned unchanged.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { keepHead, keepTail, keepFirst, keepLast, marker } = require('./core/cut');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cut-markers-'));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); } catch (error) { failed++; console.log('FAIL ' + name + ' ' + error.stack); }
}
// The marker's first character after "[" is an ellipsis; "." matches it.
const CUT = /\[. (\d+) chars cut\]/;
function project(name) {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, '.crabshell', 'memory', 'sessions'), { recursive: true });
  return root;
}

// AC1: boundaries are the limit, limit + 1 and a very long text.
for (const options of [{}, { lineBoundary: true }]) {
  const tag = options.lineBoundary ? ' (line boundary)' : '';
  const line = 'abcdefghi\n';
  const make = length => line.repeat(Math.ceil(length / line.length)).slice(0, length);
  const separator = options.lineBoundary ? 1 : 0;
  test('keepHead: at the limit the text is unchanged' + tag, () => {
    assert.strictEqual(keepHead(make(200), 200, options), make(200));
  });
  test('keepTail: at the limit the text is unchanged' + tag, () => {
    assert.strictEqual(keepTail(make(200), 200, options), make(200));
  });
  for (const length of [201, 5000, 1234567]) {
    test('keepHead: ' + length + ' chars cut to 200 stays in the limit and counts the dropped chars' + tag, () => {
      const text = make(length);
      const out = keepHead(text, 200, options);
      assert.ok(out.length <= 200, 'length ' + out.length);
      const found = out.match(CUT);
      assert.ok(found, out);
      const kept = out.slice(0, found.index - separator);
      assert.strictEqual(Number(found[1]), text.length - kept.length);
      assert.ok(text.startsWith(kept));
    });
    test('keepTail: ' + length + ' chars cut to 200 stays in the limit and counts the dropped chars' + tag, () => {
      const text = make(length);
      const out = keepTail(text, 200, options);
      assert.ok(out.length <= 200, 'length ' + out.length);
      const found = out.match(CUT);
      assert.ok(found && found.index === 0, out);
      const kept = out.slice(found[0].length + separator);
      assert.strictEqual(Number(found[1]), text.length - kept.length);
      assert.ok(text.endsWith(kept));
    });
  }
}
test('keepFirst and keepLast mark the left-out items', () => {
  const items = Array.from({ length: 12 }, (_, index) => 'item ' + index);
  assert.deepStrictEqual(keepFirst(items, 12), items);
  const first = keepFirst(items, 10);
  assert.strictEqual(first.length, 11);
  assert.strictEqual(first[10], marker(2, 'more'));
  const last = keepLast(items, 10, { label: 'earlier entries left out' });
  assert.strictEqual(last[0], marker(2, 'earlier entries left out'));
  assert.strictEqual(last[10], 'item 11');
});

// AC2: each cutting place shows the marker for a large input.
test('refine-raw: a long command and a long tool result carry the marker', () => {
  const { refineLine } = require('./refine-raw');
  const command = refineLine({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo ' + 'x'.repeat(900) } }] } });
  assert.ok(command.cmd.length <= 200 && CUT.test(command.cmd), command.cmd);
  const result = refineLine({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'y'.repeat(900) }] } });
  assert.ok(result.output.length <= 200 && CUT.test(result.output), result.output);
});
test('refine-raw: an edit summary says how many lines and characters it left out', () => {
  const { refineLine } = require('./refine-raw');
  const many = Array.from({ length: 9 }, (_, i) => 'line ' + i).join('\n');
  const edited = refineLine({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.js', old_string: many, new_string: 'z'.repeat(400) } }] } });
  const [oldSide, newSide] = edited.diff.split('\n+');
  assert.ok(oldSide.includes(marker(6, 'more lines')), edited.diff);
  assert.ok(CUT.test(newSide) && newSide.length <= 100, newSide);
});
test('extract-delta: first run keeps 50 entries with a marker', () => {
  const root = project('delta');
  const sessionsDir = path.join(root, '.crabshell', 'memory', 'sessions');
  const lines = [];
  for (let i = 0; i < 80; i++) lines.push(JSON.stringify({ ts: '2026-01-01T00:' + String(i).padStart(2, '0') + ':00.000Z', role: 'user', text: 'entry ' + i }));
  fs.writeFileSync(path.join(sessionsDir, '2026-01-01_aaaaaaaa.l1.jsonl'), lines.join('\n') + '\n');
  const saved = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = root;
  try {
    const { extractDelta } = require('./extract-delta');
    const result = extractDelta();
    assert.ok(result.success, JSON.stringify(result));
    const delta = fs.readFileSync(path.join(root, '.crabshell', 'memory', 'delta_temp.txt'), 'utf8');
    assert.ok(delta.includes(marker(30, 'earlier entries left out')), delta.slice(0, 300));
    assert.ok(delta.includes('entry 79') && !delta.includes('entry 29\n'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = saved;
  }
});
test('memory-context: unreflected text, logbook tail and the budgeted parts carry markers', () => {
  const { getUnreflectedL1Content, buildMemoryContext } = require('./core/memory-context');
  const l1 = path.join(base, 'unreflected.l1.jsonl');
  const entries = Array.from({ length: 60 }, (_, index) => JSON.stringify({ role: 'assistant', text: 'z'.repeat(60) + index + 'w'.repeat(300) }));
  fs.writeFileSync(l1, entries.join('\n'));
  const summary = getUnreflectedL1Content(l1, '');
  assert.ok(/earlier entries not checked/.test(summary[0]), summary[0]);
  assert.ok(summary.slice(1).every(text => text.length <= 200 && CUT.test(text)));

  const root = project('context');
  const blocks = Array.from({ length: 200 }, (_, index) => '## 2026-09-01_00' + String(index % 60).padStart(2, '0') + ' (local 09-01_0000)\n- item ' + index + ' ' + 'detail '.repeat(40));
  fs.writeFileSync(path.join(root, '.crabshell', 'memory', 'logbook.md'), blocks.join('\n\n') + '\n');
  const context = buildMemoryContext(root, { source: 'startup', maxChars: 9500 });
  assert.ok(context.length <= 9500);
  assert.ok(/earlier lines left out\]/.test(context) || CUT.test(context), 'no marker in the recent sessions');
});
test('recovery-context: a record over the block limit ends with the marker', () => {
  const c = require('./core/completion-control');
  const root = project('recovery');
  c.noteExecutionAuthorization(root, { session_id: 'session', prompt_id: 'turn1', prompt: 'Implement the goal', cwd: root });
  const file = c.statePath(root);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const state of Object.values(data.sessions || {})) if (state.recovery) state.recovery.remaining = 'r'.repeat(5000);
  fs.writeFileSync(file, JSON.stringify(data));
  const out = require('./core/recovery-context').buildRecoveryContext(root, 'session');
  assert.ok(out.length <= 3501 && CUT.test(out), out.slice(-200));
});
test('inject-rules: matching sections beyond the shown ones are counted', () => {
  const { getRelevantMemorySnippets } = require('./inject-rules');
  const root = project('snippets');
  const sections = Array.from({ length: 6 }, (_, index) => '## 2020-01-0' + (index + 1) + '_0000 (local x)\nalphaterm betaterm ' + 'filler '.repeat(40 + index));
  // A long last section pushes the matching ones out of the tail SessionStart already loads.
  const pad = '## 2020-03-01_0000 (local x)\n' + Array.from({ length: 80 }, (_, index) => 'pad ' + index).join('\n');
  fs.writeFileSync(path.join(root, '.crabshell', 'memory', 'logbook.md'), sections.join('\n\n') + '\n\n' + pad + '\n');
  const out = getRelevantMemorySnippets(root, 'alphaterm betaterm');
  assert.ok(out && out.length <= 2000, out && String(out.length));
  assert.ok(/\[. \d+ more snippets\]/.test(out), out);
  const big = Array.from({ length: 2 }, (_, index) => '## 2020-02-0' + (index + 1) + '_0000 (local x)\nalphaterm ' + 'filler '.repeat(400));
  fs.writeFileSync(path.join(root, '.crabshell', 'memory', 'logbook.md'), big.join('\n\n') + '\n\n' + pad + '\n');
  const cut = getRelevantMemorySnippets(root, 'alphaterm betaterm');
  assert.ok(cut.length <= 2000 && (CUT.test(cut) || /more snippets/.test(cut)), cut);
});
test('project-memory: lines and characters cut by the readers carry markers', () => {
  const { readProjectConcept, readModelRouting } = require('./core/project-memory');
  const root = project('concept');
  const body = Array.from({ length: 40 }, (_, index) => 'line ' + index).join('\n');
  fs.writeFileSync(path.join(root, '.crabshell', 'project.md'), body + '\n## Model Routing\n' + 'routing detail\n'.repeat(80));
  assert.ok(/\[. \d+ more lines\]/.test(readProjectConcept(root, 20, 1000)));
  const chars = readProjectConcept(root, 40, 100);
  assert.ok(chars.length <= 100 && CUT.test(chars), chars);
  const routing = readModelRouting(root, 300);
  assert.ok(routing.length <= 300 && CUT.test(routing), routing);
});
test('codex-memory: load and search mark what they leave out', () => {
  const { spawnSync } = require('child_process');
  const root = project('codex');
  const memory = path.join(root, '.crabshell', 'memory');
  fs.writeFileSync(path.join(memory, 'logbook.md'), Array.from({ length: 150 }, (_, index) => 'log line ' + index).join('\n'));
  const run = args => spawnSync(process.execPath, [path.join(__dirname, 'codex-memory.js'), ...args, '--project-dir=' + root], {
    cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root, PLUGIN_DATA: path.join(base, 'codex-data') },
  });
  const loaded = run(['load']);
  assert.ok(/\[. 70 earlier lines left out\]/.test(loaded.stdout), loaded.stdout.slice(0, 300) + loaded.stderr);
  const searched = run(['search', 'log', '--limit=5']);
  assert.ok(/\[. \d+ more matches\]/.test(searched.stdout), searched.stdout.slice(-300) + searched.stderr);
});
test('rotation and legacy migration: the kept tail leads with a note naming what was left out', () => {
  const { withCarryoverNote, extractTailByTokens } = require('./core/memory-index-file');
  const full = Array.from({ length: 400 }, (_, index) => 'logbook line ' + index).join('\n');
  const tail = extractTailByTokens(full, 200);
  const noted = withCarryoverNote(full, tail, 'memory_20260101_0000.md');
  const found = noted.match(/^\[. (\d+) chars of earlier logbook are in memory_20260101_0000\.md\]\n/);
  assert.ok(found, noted.slice(0, 120));
  assert.strictEqual(Number(found[1]), full.length - tail.length);
  assert.strictEqual(withCarryoverNote('short', 'short', 'a.md'), 'short');
  assert.ok(/chars of earlier logbook left out\]/.test(withCarryoverNote(full, tail)));
});

fs.rmSync(base, { recursive: true, force: true });
console.log(passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
