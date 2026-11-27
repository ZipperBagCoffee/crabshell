'use strict';
// D187_T003: a corrupt state file is copied aside before it is overwritten, a file written
// by a newer Crabshell is never overwritten, an unreadable index keeps delta_temp.txt, and
// completion-control's cut excerpts say they were cut.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readState } = require('./core/state-file');
const { readIndexSafe, updateIndex } = require('./core/memory-index-file');
const { writeJson } = require('./utils');
const control = require('./core/completion-control');
const { runExecutionLifecycle } = require('./core/execution-lifecycle');
const { keepHead } = require('./core/cut');
const { INDEX_FILE, DELTA_TEMP_FILE } = require('./constants');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crabshell-state-files-'));
let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}
let projects = 0;
function project() {
  const dir = path.join(base, `p${++projects}`);
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  return { dir, mem: path.join(dir, '.crabshell', 'memory') };
}
const copiesOf = (mem, name) => fs.readdirSync(mem).filter(f => f.startsWith(name + '.corrupt-'));
function quiet(fn) { // returns what writeJson printed to stderr
  const write = process.stderr.write;
  let out = '';
  process.stderr.write = chunk => { out += chunk; return true; };
  try { fn(); } finally { process.stderr.write = write; }
  return out;
}

try {
  check('readState: ok, missing, corrupt, newer', () => {
    const { mem } = project();
    const file = path.join(mem, 'x.json');
    assert.strictEqual(readState(file, { version: 1, defaults: {} }).status, 'missing');
    fs.writeFileSync(file, '{"version":1,"a":1}');
    assert.strictEqual(readState(file, { version: 1, defaults: {} }).status, 'ok');
    fs.writeFileSync(file, '{"version":9}');
    assert.strictEqual(readState(file, { version: 1, defaults: {} }).status, 'newer');
    fs.writeFileSync(file, '{"vers');
    const res = readState(file, { version: 1, defaults: { d: 1 } });
    assert.strictEqual(res.status, 'corrupt');
    assert.deepStrictEqual(res.value, { d: 1 });
  });

  check('AC1: a corrupt memory-index.json is kept as .corrupt-<time> once, then overwritten', () => {
    const { mem } = project();
    const file = path.join(mem, INDEX_FILE);
    const original = '{"version":1,"rotatedFiles":[';
    fs.writeFileSync(file, original);
    const archive = path.join(mem, 'memory_1.md');
    fs.writeFileSync(archive, 'x');
    updateIndex(archive, 1, mem);
    readIndexSafe(file); // a second read must not add a second copy
    const copies = copiesOf(mem, INDEX_FILE);
    assert.strictEqual(copies.length, 1);
    assert.ok(/\.corrupt-\d{14}$/.test(copies[0]));
    assert.strictEqual(fs.readFileSync(path.join(mem, copies[0]), 'utf8'), original);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).rotatedFiles.length, 1);
  });

  check('AC2: a newer memory-index.json is not overwritten and says so', () => {
    const { mem } = project();
    const file = path.join(mem, INDEX_FILE);
    const original = '{"version":7,"rotatedFiles":[],"future":true}';
    fs.writeFileSync(file, original);
    const archive = path.join(mem, 'memory_1.md');
    fs.writeFileSync(archive, 'x');
    const err = quiet(() => updateIndex(archive, 1, mem));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), original);
    assert.ok(/newer Crabshell \(version 7\); not overwritten/.test(err), err);
  });

  check('AC2: a newer completion-control.json is not overwritten', () => {
    const { dir, mem } = project();
    const file = path.join(mem, control.STATE_FILE);
    const original = '{"schemaVersion":5,"sessions":{"a":{"x":1}},"lastSessionId":"a"}';
    fs.writeFileSync(file, original);
    const err = quiet(() => control.saveState(dir, { requestExcerpt: 'hi' }, 's1'));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), original);
    assert.ok(/not overwritten/.test(err), err);
  });

  check('AC2: a newer best-answer.json is not overwritten', () => {
    const { dir, mem } = project();
    const best = require('./best-answer');
    const file = path.join(mem, best.STATE_FILE);
    const original = '{"schemaVersion":3,"sessions":{}}';
    fs.writeFileSync(file, original);
    // stopStep records "asked" through saveEntry; any write path ends in writeJson
    const state = require('./core/state-file').readState(file, { version: 1, versionField: 'schemaVersion' });
    assert.strictEqual(state.status, 'newer');
    const err = quiet(() => writeJson(file, state.value));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), original);
    assert.ok(/not overwritten/.test(err), err);
    assert.ok(dir);
  });

  check('a corrupt completion-control.json is copied aside before saveState overwrites it', () => {
    const { dir, mem } = project();
    const file = path.join(mem, control.STATE_FILE);
    fs.writeFileSync(file, '{broken');
    control.saveState(dir, { requestExcerpt: 'hi' }, 's1');
    assert.strictEqual(copiesOf(mem, control.STATE_FILE).length, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).sessions.s1.requestExcerpt, 'hi');
  });

  check('AC3: delta_temp.txt stays when the index is corrupt or newer, goes when it is fine', () => {
    for (const [content, kept] of [['{"version":1,', true], ['{"version":4}', true], ['{"version":1}', false]]) {
      const { dir, mem } = project();
      fs.writeFileSync(path.join(mem, INDEX_FILE), content);
      fs.writeFileSync(path.join(mem, DELTA_TEMP_FILE), 'queued');
      runExecutionLifecycle(dir, { session_id: 's' }, { host: 'claude' });
      assert.strictEqual(fs.existsSync(path.join(mem, DELTA_TEMP_FILE)), kept, content);
    }
  });

  check('AC4: completion-control cuts carry the marker', () => {
    const { dir, mem } = project();
    const long = 'x'.repeat(5000);
    control.saveState(dir, {
      requestExcerpt: 'r',
      observation: { command: long, passed: true, exitCode: 0, observedAt: 'now' },
      lastStop: { action: 'block', reason: long },
    }, 's1');
    const entry = JSON.parse(fs.readFileSync(path.join(mem, control.STATE_FILE), 'utf8')).sessions.s1;
    assert.ok(/\[… \d+ chars cut\]$/.test(entry.recovery.lastCheck.command));
    assert.ok(entry.recovery.lastCheck.command.length <= 400);
    assert.ok(/\[… \d+ chars cut\]$/.test(entry.recovery.remaining));
    assert.ok(entry.recovery.remaining.length <= 700);
    const started = control.noteExecutionAuthorization(dir, { session_id: 's2', prompt: '구현해줘 ' + long, hook_event_name: 'UserPromptSubmit' });
    if (started.recorded) assert.ok(/\[… \d+ chars cut\]$/.test(started.state.requestExcerpt));
    assert.strictEqual(keepHead('short', 10), 'short');
  });
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
