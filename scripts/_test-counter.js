// _test-counter.js — Comprehensive tests for counter.js
// Covers: exports, getCounter, setCounter, getConfig, parseArg,
//         cleanupDuplicateL1, dedupeL1, compress, subprocess (check/reset/final),
//         phase advancement, edge cases, locking
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const counterPath = path.join(__dirname, 'counter.js');
const nodePath = process.execPath.replace(/\\/g, '/');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { console.log('FAIL: ' + name + ' --- ' + e.message); failed++; }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error((label || '') + ' expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function assertIncludes(text, substr, label) {
  if (typeof text !== 'string' || !text.includes(substr)) {
    throw new Error((label || '') + ' expected to include ' + JSON.stringify(substr) + ' in ' + JSON.stringify(String(text).substring(0, 200)));
  }
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function cleanupDir(dirPath) {
  try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch (e) {}
}

// Helper: run counter.js check with HOOK_DATA env var (avoids stdin piping issues)
function runCheck(tmpDir, hookData) {
  return execSync(`"${nodePath}" "${counterPath}" check --project-dir="${tmpDir}"`, {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir, HOOK_DATA: JSON.stringify(hookData) },
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

// Helper: set up a minimal temp project with counter and index
function setupProject() {
  const tmpDir = makeTempDir('tc');
  const memDir = path.join(tmpDir, '.crabshell', 'memory');
  const sessDir = path.join(memDir, 'sessions');
  ensureDir(memDir);
  ensureDir(sessDir);
  fs.writeFileSync(path.join(memDir, 'counter.json'), JSON.stringify({ counter: 0 }));
  fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({
    version: 1, current: 'logbook.md', rotatedFiles: [], stats: { totalRotations: 0 }
  }));
  return { tmpDir, memDir, sessDir };
}

// Load module exports
const mod = require(counterPath);

// ============================================================
// 1. Export checks
// ============================================================
test('EXPORT: all functions present', function() {
  const fns = ['getCounter', 'setCounter', 'getConfig', 'cleanupDuplicateL1', 'dedupeL1', 'parseArg', 'compress'];
  for (const fn of fns) {
    assert(typeof mod[fn] === 'function', fn + ' not exported as function');
  }
});

test('EXPORT: module.exports does not include internal functions', function() {
  const keys = Object.keys(mod);
  assert(!keys.includes('check'), 'check should not be exported');
  assert(!keys.includes('final'), 'final should not be exported');
  assert(!keys.includes('reset'), 'reset should not be exported');
  assert(!keys.includes('readStdin'), 'readStdin should not be exported');
});

// ============================================================
// 2. getCounter / setCounter
// ============================================================
test('getCounter: returns 0 when no counter file', function() {
  const tmpDir = makeTempDir('counter-get');
  ensureDir(path.join(tmpDir, '.crabshell', 'memory'));
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    assertEqual(mod.getCounter(), 0, 'default counter');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('getCounter: returns value from existing file', function() {
  const tmpDir = makeTempDir('counter-existing');
  const memDir = path.join(tmpDir, '.crabshell', 'memory');
  ensureDir(memDir);
  fs.writeFileSync(path.join(memDir, 'counter.json'), JSON.stringify({ counter: 99 }));
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    assertEqual(mod.getCounter(), 99, 'existing counter');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('setCounter: writes and getCounter reads back', function() {
  const tmpDir = makeTempDir('counter-set');
  ensureDir(path.join(tmpDir, '.crabshell', 'memory'));
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    mod.setCounter(42);
    assertEqual(mod.getCounter(), 42, 'counter after set');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('setCounter: overwrites previous value', function() {
  const tmpDir = makeTempDir('counter-overwrite');
  ensureDir(path.join(tmpDir, '.crabshell', 'memory'));
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    mod.setCounter(10);
    mod.setCounter(20);
    assertEqual(mod.getCounter(), 20, 'overwritten counter');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('setCounter: creates counter.json with correct format', function() {
  const tmpDir = makeTempDir('counter-format');
  ensureDir(path.join(tmpDir, '.crabshell', 'memory'));
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    mod.setCounter(7);
    const counterFile = path.join(tmpDir, '.crabshell', 'memory', 'counter.json');
    assert(fs.existsSync(counterFile), 'counter.json should exist');
    const data = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
    assertEqual(data.counter, 7, 'counter field');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('getCounter: corrupted counter.json returns 0', function() {
  const tmpDir = makeTempDir('counter-corrupt');
  const memDir = path.join(tmpDir, '.crabshell', 'memory');
  ensureDir(memDir);
  fs.writeFileSync(path.join(memDir, 'counter.json'), '{not valid json!!!');
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    assertEqual(mod.getCounter(), 0, 'corrupted returns 0');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('getCounter: counter.json with counter=0 returns 0', function() {
  const tmpDir = makeTempDir('counter-zero');
  const memDir = path.join(tmpDir, '.crabshell', 'memory');
  ensureDir(memDir);
  fs.writeFileSync(path.join(memDir, 'counter.json'), JSON.stringify({ counter: 0 }));
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    assertEqual(mod.getCounter(), 0, 'zero counter');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('getCounter: counter.json missing counter field returns 0', function() {
  const tmpDir = makeTempDir('counter-nofield');
  const memDir = path.join(tmpDir, '.crabshell', 'memory');
  ensureDir(memDir);
  fs.writeFileSync(path.join(memDir, 'counter.json'), JSON.stringify({ other: 'stuff' }));
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    assertEqual(mod.getCounter(), 0, 'missing field returns 0');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 3. getConfig
// ============================================================
test('getConfig: returns defaults when no config file', function() {
  const tmpDir = makeTempDir('config-default');
  ensureDir(path.join(tmpDir, '.crabshell', 'memory'));
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    const config = mod.getConfig();
    assertEqual(config.saveInterval, 15, 'default saveInterval');
    assertEqual(config.keepRaw, false, 'default keepRaw');
    assertEqual(config.quietStop, true, 'default quietStop');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('getConfig: reads project-level config', function() {
  const tmpDir = makeTempDir('config-project');
  const memDir = path.join(tmpDir, '.crabshell', 'memory');
  ensureDir(memDir);
  fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify({ saveInterval: 30, keepRaw: true }));
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    const config = mod.getConfig();
    assertEqual(config.saveInterval, 30, 'project saveInterval');
    assertEqual(config.keepRaw, true, 'project keepRaw');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('getConfig: corrupted config.json falls back to global defaults', function() {
  const tmpDir = makeTempDir('config-corrupt');
  const memDir = path.join(tmpDir, '.crabshell', 'memory');
  ensureDir(memDir);
  fs.writeFileSync(path.join(memDir, 'config.json'), 'BROKEN JSON');
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    const config = mod.getConfig();
    assert(config !== null && config !== undefined, 'should return config object');
    assert(typeof config.saveInterval === 'number', 'should have numeric saveInterval');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 4. parseArg
// ============================================================
test('parseArg: extracts --key=value', function() {
  assertEqual(mod.parseArg(['--context=5', '--deep'], 'context'), '5');
});

test('parseArg: returns null when key not found', function() {
  assertEqual(mod.parseArg(['--deep', '--regex'], 'context'), null);
});

test('parseArg: handles empty args', function() {
  assertEqual(mod.parseArg([], 'key'), null);
});

test('parseArg: value with equals sign in value', function() {
  assertEqual(mod.parseArg(['--filter=a=b'], 'filter'), 'a=b');
});

test('parseArg: empty value after equals', function() {
  assertEqual(mod.parseArg(['--key='], 'key'), '');
});

test('parseArg: multiple args, selects correct key', function() {
  assertEqual(mod.parseArg(['--limit=20', '--context=5', '--deep'], 'limit'), '20');
});

test('parseArg: first match wins', function() {
  assertEqual(mod.parseArg(['--x=first', '--x=second'], 'x'), 'first');
});

// ============================================================
// 5. cleanupDuplicateL1
// ============================================================
test('cleanupDuplicateL1: removes smaller duplicate from same session', function() {
  const tmpDir = makeTempDir('cleanup-l1');
  ensureDir(tmpDir);
  const ts = '2026-01-01T00:00:00.000Z';
  const smallContent = JSON.stringify({ ts: ts, role: 'user', content: 'hi' });
  const bigContent = JSON.stringify({ ts: ts, role: 'user', content: 'hi' }) + '\n' +
    JSON.stringify({ ts: ts, role: 'assistant', content: 'hello there, how are you doing today?' });
  const smallFile = path.join(tmpDir, '2026-01-01_0000_abc12345.l1.jsonl');
  const bigFile = path.join(tmpDir, '2026-01-01_0010_abc12345.l1.jsonl');
  fs.writeFileSync(smallFile, smallContent);
  fs.writeFileSync(bigFile, bigContent);
  mod.cleanupDuplicateL1(bigFile);
  assert(!fs.existsSync(smallFile), 'smaller file should be deleted');
  assert(fs.existsSync(bigFile), 'larger file should remain');
  cleanupDir(tmpDir);
});

test('cleanupDuplicateL1: keeps files from different sessions', function() {
  const tmpDir = makeTempDir('cleanup-l1-diff');
  ensureDir(tmpDir);
  const file1 = path.join(tmpDir, '2026-01-01_0000.l1.jsonl');
  const file2 = path.join(tmpDir, '2026-01-02_0000.l1.jsonl');
  fs.writeFileSync(file1, JSON.stringify({ ts: '2026-01-01T00:00:00Z', role: 'user', content: 'a' }));
  fs.writeFileSync(file2, JSON.stringify({ ts: '2026-01-02T00:00:00Z', role: 'user', content: 'b' }));
  mod.cleanupDuplicateL1(file2);
  assert(fs.existsSync(file1), 'different-session file should remain');
  assert(fs.existsSync(file2), 'new file should remain');
  cleanupDir(tmpDir);
});

test('cleanupDuplicateL1: no crash on empty sessions dir', function() {
  const tmpDir = makeTempDir('cleanup-l1-empty');
  ensureDir(tmpDir);
  const content = JSON.stringify({ ts: '2026-01-01T00:00:00Z', role: 'user', content: 'a' });
  const file = path.join(tmpDir, 'only.l1.jsonl');
  fs.writeFileSync(file, content);
  mod.cleanupDuplicateL1(file);
  assert(fs.existsSync(file), 'only file should remain');
  cleanupDir(tmpDir);
});

test('cleanupDuplicateL1: new file with invalid JSON first line is no-op', function() {
  const tmpDir = makeTempDir('cleanup-l1-invalid');
  ensureDir(tmpDir);
  const badFile = path.join(tmpDir, 'bad.l1.jsonl');
  fs.writeFileSync(badFile, 'not json');
  mod.cleanupDuplicateL1(badFile);
  assert(fs.existsSync(badFile), 'file should remain');
  cleanupDir(tmpDir);
});

test('cleanupDuplicateL1: existing file with invalid JSON is skipped', function() {
  const tmpDir = makeTempDir('cleanup-l1-badexisting');
  ensureDir(tmpDir);
  const ts = '2026-01-01T00:00:00Z';
  const badFile = path.join(tmpDir, 'bad.l1.jsonl');
  fs.writeFileSync(badFile, 'garbage data here');
  const goodFile = path.join(tmpDir, 'good.l1.jsonl');
  fs.writeFileSync(goodFile, JSON.stringify({ ts, role: 'user', content: 'hello world extended text' }));
  mod.cleanupDuplicateL1(goodFile);
  assert(fs.existsSync(badFile), 'bad file should remain (skipped)');
  assert(fs.existsSync(goodFile), 'good file should remain');
  cleanupDir(tmpDir);
});

test('cleanupDuplicateL1: does not delete larger file from same session', function() {
  const tmpDir = makeTempDir('cleanup-l1-larger');
  ensureDir(tmpDir);
  const ts = '2026-01-01T00:00:00Z';
  const largerExisting = path.join(tmpDir, 'existing.l1.jsonl');
  fs.writeFileSync(largerExisting, JSON.stringify({ ts, role: 'user', content: 'large' }) + '\n' +
    JSON.stringify({ ts, role: 'assistant', content: 'very large content here to make this file bigger' }));
  const smallerNew = path.join(tmpDir, 'new.l1.jsonl');
  fs.writeFileSync(smallerNew, JSON.stringify({ ts, role: 'user', content: 'sm' }));
  mod.cleanupDuplicateL1(smallerNew);
  assert(fs.existsSync(largerExisting), 'larger existing file should remain');
  assert(fs.existsSync(smallerNew), 'new file should remain');
  cleanupDir(tmpDir);
});

// ============================================================
// 6. dedupeL1
// ============================================================
test('dedupeL1: removes smaller duplicates from same session', function() {
  const tmpDir = makeTempDir('dedupe-test');
  const sessDir = path.join(tmpDir, '.crabshell', 'memory', 'sessions');
  ensureDir(sessDir);
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    const ts = '2026-03-01T00:00:00Z';
    const small = path.join(sessDir, 'a.l1.jsonl');
    fs.writeFileSync(small, JSON.stringify({ ts, role: 'user', content: 'a' }));
    const large = path.join(sessDir, 'b.l1.jsonl');
    fs.writeFileSync(large, JSON.stringify({ ts, role: 'user', content: 'a' }) + '\n' +
      JSON.stringify({ ts, role: 'assistant', content: 'longer content to increase file size' }));
    mod.dedupeL1();
    assert(!fs.existsSync(small), 'smaller duplicate should be deleted');
    assert(fs.existsSync(large), 'larger file should remain');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('dedupeL1: no duplicates no deletions', function() {
  const tmpDir = makeTempDir('dedupe-nodup');
  const sessDir = path.join(tmpDir, '.crabshell', 'memory', 'sessions');
  ensureDir(sessDir);
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    fs.writeFileSync(path.join(sessDir, 'a.l1.jsonl'), JSON.stringify({ ts: '2026-01-01T00:00:00Z', role: 'user', content: 'a' }));
    fs.writeFileSync(path.join(sessDir, 'b.l1.jsonl'), JSON.stringify({ ts: '2026-01-02T00:00:00Z', role: 'user', content: 'b' }));
    mod.dedupeL1();
    assert(fs.existsSync(path.join(sessDir, 'a.l1.jsonl')), 'a should remain');
    assert(fs.existsSync(path.join(sessDir, 'b.l1.jsonl')), 'b should remain');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('dedupeL1: no sessions directory no crash', function() {
  const tmpDir = makeTempDir('dedupe-nosess');
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    mod.dedupeL1();
    assert(true, 'no crash');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 7. compress
// ============================================================
test('compress: archives files older than 30 days', function() {
  const tmpDir = makeTempDir('compress-test');
  const sessDir = path.join(tmpDir, '.crabshell', 'memory', 'sessions');
  ensureDir(sessDir);
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);
    const pad = n => String(n).padStart(2, '0');
    const oldName = `${oldDate.getFullYear()}-${pad(oldDate.getMonth()+1)}-${pad(oldDate.getDate())}_session.md`;
    fs.writeFileSync(path.join(sessDir, oldName), '# Old session\nSome content');
    mod.compress();
    assert(!fs.existsSync(path.join(sessDir, oldName)), 'old file should be archived');
    assert(fs.existsSync(path.join(sessDir, 'archive')), 'archive dir should be created');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('compress: keeps recent files', function() {
  const tmpDir = makeTempDir('compress-recent');
  const sessDir = path.join(tmpDir, '.crabshell', 'memory', 'sessions');
  ensureDir(sessDir);
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const recentName = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_session.md`;
    fs.writeFileSync(path.join(sessDir, recentName), '# Recent session');
    mod.compress();
    assert(fs.existsSync(path.join(sessDir, recentName)), 'recent file should remain');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('compress: ignores week- and archive- prefixed files', function() {
  const tmpDir = makeTempDir('compress-ignore');
  const sessDir = path.join(tmpDir, '.crabshell', 'memory', 'sessions');
  ensureDir(sessDir);
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    fs.writeFileSync(path.join(sessDir, 'week-2025-01.md'), '# Week summary');
    fs.writeFileSync(path.join(sessDir, 'archive-note.md'), '# Archive');
    mod.compress();
    assert(fs.existsSync(path.join(sessDir, 'week-2025-01.md')), 'week file should remain');
    assert(fs.existsSync(path.join(sessDir, 'archive-note.md')), 'archive file should remain');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

test('compress: empty sessions dir no crash', function() {
  const tmpDir = makeTempDir('compress-empty');
  const sessDir = path.join(tmpDir, '.crabshell', 'memory', 'sessions');
  ensureDir(sessDir);
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  try {
    mod.compress();
    assert(true, 'no crash');
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origEnv;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 8. Subprocess: reset
// ============================================================
test('SUBPROCESS reset: counter.json becomes 0', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'counter.json'), JSON.stringify({ counter: 15 }));
    const out = execSync(`"${nodePath}" "${counterPath}" reset --project-dir="${tmpDir}"`, {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir }
    });
    assertIncludes(out, 'Counter reset', 'reset output');
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 0, 'counter after reset');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 9. Subprocess: check — counter increment
// ============================================================
test('SUBPROCESS check: counter increments', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    runCheck(tmpDir, { tool_name: 'Read', session_id: 'test1234abcd' });
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 1, 'counter after 1 check');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: multiple increments accumulate', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    for (let i = 0; i < 3; i++) {
      runCheck(tmpDir, { tool_name: 'Read', session_id: 'test1234abcd' });
    }
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 3, 'counter after 3 checks');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: at interval counter resets to 0', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'counter.json'), JSON.stringify({ counter: 14 }));
    runCheck(tmpDir, { tool_name: 'Read', session_id: 'test1234abcd' });
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 0, 'counter resets at interval');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: custom interval from config', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify({ saveInterval: 3 }));
    fs.writeFileSync(path.join(memDir, 'counter.json'), JSON.stringify({ counter: 2 }));
    runCheck(tmpDir, { tool_name: 'Read', session_id: 'test1234abcd' });
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 0, 'counter resets at custom interval');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: counter below interval does not reset', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'counter.json'), JSON.stringify({ counter: 5 }));
    runCheck(tmpDir, { tool_name: 'Read', session_id: 'test1234abcd' });
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 6, 'counter should be 6');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 10. Subprocess: check — TaskCreate pressure reset
// ============================================================
test('SUBPROCESS check: TaskCreate resets pressure to L0', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({
      version: 1, current: 'logbook.md', rotatedFiles: [], stats: { totalRotations: 0 },
      feedbackPressure: { level: 2, consecutiveCount: 3, decayCounter: 0, lastDetectedAt: new Date().toISOString() }
    }));
    runCheck(tmpDir, { tool_name: 'TaskCreate', session_id: 'test5678efgh' });
    const idx = JSON.parse(fs.readFileSync(path.join(memDir, 'memory-index.json'), 'utf8'));
    assertEqual(idx.feedbackPressure.level, 0, 'pressure level');
    assertEqual(idx.feedbackPressure.consecutiveCount, 0, 'consecutiveCount');
    assertEqual(idx.feedbackPressure.decayCounter, 0, 'decayCounter');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: TaskCreate with no pressure no crash', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    runCheck(tmpDir, { tool_name: 'TaskCreate', session_id: 'test5678efgh' });
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 1, 'counter increments');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: TaskCreate with L3 pressure resets all fields', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({
      version: 1, current: 'logbook.md', rotatedFiles: [], stats: {},
      feedbackPressure: { level: 3, consecutiveCount: 5, decayCounter: 2, lastDetectedAt: '2026-01-01' }
    }));
    runCheck(tmpDir, { tool_name: 'TaskCreate', session_id: 'testpressure' });
    const idx = JSON.parse(fs.readFileSync(path.join(memDir, 'memory-index.json'), 'utf8'));
    assertEqual(idx.feedbackPressure.level, 0, 'level');
    assertEqual(idx.feedbackPressure.consecutiveCount, 0, 'count');
    assertEqual(idx.feedbackPressure.decayCounter, 0, 'decay');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: TaskCreate with pressure.level=0 is no-op', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({
      version: 1, current: 'logbook.md', rotatedFiles: [], stats: {},
      feedbackPressure: { level: 0, consecutiveCount: 0, decayCounter: 0 }
    }));
    runCheck(tmpDir, { tool_name: 'TaskCreate', session_id: 'testnopress' });
    // Should not modify anything (level is already 0, guard: level > 0)
    const idx = JSON.parse(fs.readFileSync(path.join(memDir, 'memory-index.json'), 'utf8'));
    assertEqual(idx.feedbackPressure.level, 0, 'level unchanged');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 11. Subprocess: check — Skill phase advancement
// ============================================================
test('SUBPROCESS check: Skill planning advances to ticketing', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'planning', cycle: 1, totalCycles: 3,
      discussion: 'D001', lastUpdatedAt: new Date().toISOString()
    }));
    runCheck(tmpDir, { tool_name: 'Skill', tool_input: { skill: 'planning' }, session_id: 'testreg1' });
    const state = JSON.parse(fs.readFileSync(path.join(memDir, 'regressing-state.json'), 'utf8'));
    assertEqual(state.phase, 'ticketing', 'phase');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: Skill discussing advances to planning', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'discussing', cycle: 1, totalCycles: 3,
      discussion: 'D001', lastUpdatedAt: new Date().toISOString()
    }));
    runCheck(tmpDir, { tool_name: 'Skill', tool_input: { skill: 'crabshell:discussing' }, session_id: 'testreg2' });
    const state = JSON.parse(fs.readFileSync(path.join(memDir, 'regressing-state.json'), 'utf8'));
    assertEqual(state.phase, 'planning', 'phase');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: Skill ticketing advances to execution', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'ticketing', cycle: 1, totalCycles: 3,
      discussion: 'D001', planId: 'P001', lastUpdatedAt: new Date().toISOString()
    }));
    runCheck(tmpDir, { tool_name: 'Skill', tool_input: { skill: 'ticketing' }, session_id: 'testreg3' });
    const state = JSON.parse(fs.readFileSync(path.join(memDir, 'regressing-state.json'), 'utf8'));
    assertEqual(state.phase, 'execution', 'phase');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: non-matching Skill does not advance', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'planning', cycle: 1, totalCycles: 3,
      discussion: 'D001', lastUpdatedAt: new Date().toISOString()
    }));
    runCheck(tmpDir, { tool_name: 'Skill', tool_input: { skill: 'ticketing' }, session_id: 'testreg4' });
    const state = JSON.parse(fs.readFileSync(path.join(memDir, 'regressing-state.json'), 'utf8'));
    assertEqual(state.phase, 'planning', 'phase not changed');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: Skill without regressing-state no crash', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    runCheck(tmpDir, { tool_name: 'Skill', tool_input: { skill: 'planning' }, session_id: 'testreg5' });
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 1, 'counter increments');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: non-Skill tool ignored for phase', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'planning', cycle: 1, totalCycles: 3,
      discussion: 'D001', lastUpdatedAt: new Date().toISOString()
    }));
    runCheck(tmpDir, { tool_name: 'Read', session_id: 'testreg6' });
    const state = JSON.parse(fs.readFileSync(path.join(memDir, 'regressing-state.json'), 'utf8'));
    assertEqual(state.phase, 'planning', 'phase unchanged');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS check: inactive regressing not advanced', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: false, phase: 'planning', cycle: 1, totalCycles: 3,
      discussion: 'D001', lastUpdatedAt: new Date().toISOString()
    }));
    runCheck(tmpDir, { tool_name: 'Skill', tool_input: { skill: 'planning' }, session_id: 'testreg7' });
    const state = JSON.parse(fs.readFileSync(path.join(memDir, 'regressing-state.json'), 'utf8'));
    assertEqual(state.phase, 'planning', 'inactive not advanced');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 12. Edge cases
// ============================================================
test('EDGE: missing .crabshell/memory/ directory created by check', function() {
  const tmpDir = makeTempDir('edge-nodir');
  try {
    runCheck(tmpDir, { tool_name: 'Read', session_id: 'edgetest1' });
    const counterFile = path.join(tmpDir, '.crabshell', 'memory', 'counter.json');
    assert(fs.existsSync(counterFile), 'counter.json created');
    const data = JSON.parse(fs.readFileSync(counterFile, 'utf8'));
    assertEqual(data.counter, 1, 'counter=1');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('EDGE: corrupted counter.json recovered by check', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'counter.json'), 'NOT JSON!!!');
    runCheck(tmpDir, { tool_name: 'Read', session_id: 'edgetest2' });
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 1, 'recovered');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('EDGE: corrupted memory-index.json TaskCreate no crash', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), '{broken json}');
    runCheck(tmpDir, { tool_name: 'TaskCreate', session_id: 'edgetest3' });
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 1, 'counter increments');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('EDGE: empty hookData still increments counter', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    execSync(`"${nodePath}" "${counterPath}" check --project-dir="${tmpDir}"`, {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir, HOOK_DATA: '{}' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 1, 'counter increments');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('EDGE: hookData with no session_id works', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    runCheck(tmpDir, { tool_name: 'Read' });
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 1, 'counter increments');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('EDGE: hookData with empty string session_id works', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    runCheck(tmpDir, { tool_name: 'Read', session_id: '' });
    const data = JSON.parse(fs.readFileSync(path.join(memDir, 'counter.json'), 'utf8'));
    assertEqual(data.counter, 1, 'counter increments');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 13. Subprocess: usage/help
// ============================================================
test('SUBPROCESS: no command shows usage', function() {
  const out = execSync(`"${nodePath}" "${counterPath}"`, { encoding: 'utf8' });
  assertIncludes(out, 'Usage: counter.js', 'usage');
  assertIncludes(out, 'check', 'check');
  assertIncludes(out, 'final', 'final');
  assertIncludes(out, 'reset', 'reset');
  assertIncludes(out, 'compress', 'compress');
  assertIncludes(out, 'dedupe-l1', 'dedupe-l1');
});

test('SUBPROCESS: reset outputs confirmation', function() {
  const { tmpDir } = setupProject();
  try {
    const out = execSync(`"${nodePath}" "${counterPath}" reset --project-dir="${tmpDir}"`, {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir }
    });
    assertIncludes(out, 'Counter reset', 'reset confirmation');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 14. Locking structural checks
// ============================================================
test('LOCK: counter.js uses acquireIndexLock', function() {
  const src = fs.readFileSync(counterPath, 'utf8');
  assert(src.includes('acquireIndexLock'), 'counter.js should use acquireIndexLock');
  assert(src.includes('releaseIndexLock'), 'counter.js should use releaseIndexLock');
});

test('LOCK: no raw fs.writeFileSync for memory-index in check()', function() {
  const src = fs.readFileSync(counterPath, 'utf8');
  const checkStart = src.indexOf('async function check()');
  const checkEnd = src.indexOf('async function final()');
  const checkBody = src.slice(checkStart, checkEnd);
  assert(!checkBody.includes('fs.writeFileSync(idxPath'), 'no raw writeFileSync for idxPath');
});

test('LOCK: inject-rules.js uses acquireIndexLock', function() {
  const src = fs.readFileSync(path.join(__dirname, 'inject-rules.js'), 'utf8');
  assert(src.includes('acquireIndexLock'), 'inject-rules.js should use acquireIndexLock');
  assert(src.includes('releaseIndexLock'), 'inject-rules.js should use releaseIndexLock');
});

test('LOCK: load-memory.js uses writeJson for pressure decay', function() {
  const src = fs.readFileSync(path.join(__dirname, 'load-memory.js'), 'utf8');
  const pressureStart = src.indexOf('pressure decay');
  const pressureEnd = src.indexOf('stale regressing');
  if (pressureStart !== -1 && pressureEnd !== -1) {
    const section = src.slice(pressureStart, pressureEnd);
    assert(section.includes('writeJson'), 'pressure decay should use writeJson');
    assert(!section.includes('fs.writeFileSync'), 'should NOT use raw writeFileSync');
  } else {
    assert(src.includes('writeJson'), 'load-memory.js should use writeJson');
  }
});

test('LOCK: INDEX_LOCK_FILE constant exists', function() {
  const constants = require(path.join(__dirname, 'constants.js'));
  assert(typeof constants.INDEX_LOCK_FILE === 'string', 'INDEX_LOCK_FILE should be string');
});

test('LOCK: INDEX_LOCK_FILE differs from LOCK_FILE', function() {
  const constants = require(path.join(__dirname, 'constants.js'));
  assert(constants.INDEX_LOCK_FILE !== constants.LOCK_FILE,
    'INDEX_LOCK_FILE must differ from LOCK_FILE');
});

// ============================================================
// 15. Module structure
// ============================================================
test('MODULE: require.main === module guard exists', function() {
  const src = fs.readFileSync(counterPath, 'utf8');
  assert(src.includes('if (require.main === module)'), 'guard exists');
});

test('MODULE: switch block inside main guard', function() {
  const src = fs.readFileSync(counterPath, 'utf8');
  const guard = src.indexOf('if (require.main === module)');
  const switchBlock = src.indexOf("switch (command)");
  assert(guard !== -1, 'guard exists');
  assert(switchBlock > guard, 'switch after guard');
});

test('MODULE: module.exports guard exists', function() {
  const src = fs.readFileSync(counterPath, 'utf8');
  assert(src.includes('if (require.main !== module)'), 'export guard');
  assert(src.includes('module.exports'), 'module.exports');
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(60));
console.log('_test-counter.js: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
console.log('='.repeat(60));
process.exit(failed > 0 ? 1 : 0);
