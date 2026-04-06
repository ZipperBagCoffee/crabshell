// _test-extract-delta.js — Tests for extract-delta.js
// Covers: extractDelta, markMemoryUpdated, cleanupDeltaTemp, markDeltaProcessing, markMemoryAppended
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const scriptPath = path.join(__dirname, 'extract-delta.js');

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
    throw new Error((label || '') + ' expected to include ' + JSON.stringify(substr) + ' in ' + JSON.stringify(String(text).substring(0, 300)));
  }
}

function makeTempDir() {
  const suffix = crypto.randomBytes(8).toString('hex');
  const dir = path.join(os.tmpdir(), 'test-extract-delta-' + suffix);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function cleanupDir(dirPath) {
  try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch (e) {}
}

// Build a minimal project with sessions dir + L1 file
function setupProject(opts) {
  opts = opts || {};
  const tmpDir = makeTempDir();
  const memDir = path.join(tmpDir, '.crabshell', 'memory');
  const sessDir = path.join(memDir, 'sessions');
  ensureDir(memDir);
  if (!opts.noSessions) {
    ensureDir(sessDir);
  }

  if (opts.index) {
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify(opts.index));
  } else {
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({
      version: 1, current: 'logbook.md', rotatedFiles: [], stats: { totalRotations: 0 },
      lastMemoryUpdateTs: opts.lastUpdateTs || null
    }));
  }

  if (opts.l1Lines && !opts.noSessions) {
    const l1Name = '20260101_000000_abc123.l1.jsonl';
    fs.writeFileSync(path.join(sessDir, l1Name), opts.l1Lines.join('\n'));
  }

  return { tmpDir, memDir, sessDir };
}

// Load module exports
const mod = require(scriptPath);

// ============================================================
// 1. Export checks
// ============================================================
test('EXPORT: all functions present', function() {
  const fns = ['extractDelta', 'markDeltaProcessing', 'markMemoryAppended', 'markMemoryUpdated', 'cleanupDeltaTemp'];
  for (const fn of fns) {
    assert(typeof mod[fn] === 'function', fn + ' not exported as function');
  }
});

// ============================================================
// 2. extractDelta — no sessions dir
// ============================================================
test('extractDelta: no sessions dir → { success: false }', function() {
  const { tmpDir, memDir } = setupProject({ noSessions: true });
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.extractDelta();
    assertEqual(result.success, false, 'success');
    assertIncludes(result.reason || '', 'sessions', 'reason mentions sessions');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 3. extractDelta — sessions dir exists but no L1 files
// ============================================================
test('extractDelta: no L1 files → { success: false }', function() {
  const { tmpDir } = setupProject({});
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.extractDelta();
    assertEqual(result.success, false, 'success');
    assert(result.reason, 'has reason field');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 4. extractDelta — valid L1 with new entries → success, delta_temp.txt created
// ============================================================
test('extractDelta: valid L1 new entries → success + delta_temp.txt created', function() {
  const now = new Date().toISOString();
  const lines = [
    JSON.stringify({ ts: now, role: 'user', text: 'Hello world' }),
    JSON.stringify({ ts: now, role: 'assistant', text: 'Hi there' }),
  ];
  const { tmpDir, memDir } = setupProject({ l1Lines: lines });
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.extractDelta();
    assertEqual(result.success, true, 'success');
    const deltaPath = path.join(memDir, 'delta_temp.txt');
    assert(fs.existsSync(deltaPath), 'delta_temp.txt created');
    assert(result.entryCount > 0, 'entryCount > 0');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 5. extractDelta — entries before lastUpdateTs are skipped
// ============================================================
test('extractDelta: entries before lastUpdateTs skipped → no new content', function() {
  const old = '2020-01-01T00:00:00.000Z';
  const future = '2099-01-01T00:00:00.000Z';
  const lines = [
    JSON.stringify({ ts: old, role: 'user', text: 'Old message' }),
  ];
  const { tmpDir } = setupProject({ l1Lines: lines, lastUpdateTs: future });
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.extractDelta();
    assertEqual(result.success, false, 'success should be false (all entries skipped)');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 6. extractDelta — assistant role formatting
// ============================================================
test('extractDelta: assistant role → "◆ Claude:" prefix in delta', function() {
  const now = new Date().toISOString();
  const lines = [
    JSON.stringify({ ts: now, role: 'assistant', text: 'Test assistant message' }),
  ];
  const { tmpDir, memDir } = setupProject({ l1Lines: lines });
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.extractDelta();
    assertEqual(result.success, true, 'success');
    const deltaContent = fs.readFileSync(path.join(memDir, 'delta_temp.txt'), 'utf8');
    assertIncludes(deltaContent, '◆ Claude:', 'Claude prefix');
    assertIncludes(deltaContent, 'Test assistant message', 'message text');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 7. extractDelta — tool role with name → "◆ Tool(Name):" formatting
// ============================================================
test('extractDelta: tool role with name → "◆ Tool(Name):" prefix', function() {
  const now = new Date().toISOString();
  const lines = [
    JSON.stringify({ ts: now, role: 'tool', name: 'Bash', cmd: 'ls -la' }),
  ];
  const { tmpDir, memDir } = setupProject({ l1Lines: lines });
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.extractDelta();
    assertEqual(result.success, true, 'success');
    const deltaContent = fs.readFileSync(path.join(memDir, 'delta_temp.txt'), 'utf8');
    assertIncludes(deltaContent, '◆ Tool(Bash):', 'Tool prefix with name');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 8. extractDelta — tool_result role is skipped
// ============================================================
test('extractDelta: tool_result role skipped', function() {
  const now = new Date().toISOString();
  const lines = [
    JSON.stringify({ ts: now, role: 'tool_result', text: 'Should not appear' }),
    JSON.stringify({ ts: now, role: 'user', text: 'Visible user message' }),
  ];
  const { tmpDir, memDir } = setupProject({ l1Lines: lines });
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.extractDelta();
    assertEqual(result.success, true, 'success');
    const deltaContent = fs.readFileSync(path.join(memDir, 'delta_temp.txt'), 'utf8');
    assert(!deltaContent.includes('Should not appear'), 'tool_result text absent from delta');
    assertIncludes(deltaContent, 'Visible user message', 'user message present');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 9. markMemoryUpdated — uses pendingLastProcessedTs
// ============================================================
test('markMemoryUpdated: uses pendingLastProcessedTs when present', function() {
  const { tmpDir, memDir } = setupProject({
    index: {
      version: 1, current: 'logbook.md', rotatedFiles: [], stats: { totalRotations: 0 },
      lastMemoryUpdateTs: null,
      pendingLastProcessedTs: '2026-03-01T12:00:00.000Z'
    }
  });
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.markMemoryUpdated();
    assert(result, 'returns true');
    const idx = JSON.parse(fs.readFileSync(path.join(memDir, 'memory-index.json'), 'utf8'));
    assertEqual(idx.lastMemoryUpdateTs, '2026-03-01T12:00:00.000Z', 'lastMemoryUpdateTs set from pending');
    assert(!idx.pendingLastProcessedTs, 'pendingLastProcessedTs cleared');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 10. markMemoryUpdated — fallback to wall clock when no pending
// ============================================================
test('markMemoryUpdated: falls back to wall clock when no pendingLastProcessedTs', function() {
  const before = Date.now();
  const { tmpDir, memDir } = setupProject({
    index: {
      version: 1, current: 'logbook.md', rotatedFiles: [], stats: { totalRotations: 0 },
      lastMemoryUpdateTs: null
    }
  });
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.markMemoryUpdated();
    assert(result, 'returns true');
    const idx = JSON.parse(fs.readFileSync(path.join(memDir, 'memory-index.json'), 'utf8'));
    assert(idx.lastMemoryUpdateTs, 'lastMemoryUpdateTs set');
    const ts = new Date(idx.lastMemoryUpdateTs).getTime();
    assert(ts >= before, 'timestamp is recent (>= before)');
    assert(ts <= Date.now() + 1000, 'timestamp is not in the future');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 11. cleanupDeltaTemp — blocked when logbook.md not updated (mtime check)
// ============================================================
test('cleanupDeltaTemp: blocked when logbook mtime not newer than deltaCreatedAtMemoryMtime', function() {
  const { tmpDir, memDir } = setupProject({});
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const deltaPath = path.join(memDir, 'delta_temp.txt');
    const logbookPath = path.join(memDir, 'logbook.md');

    // Write logbook.md first, record its mtime
    fs.writeFileSync(logbookPath, 'old content');
    const logbookMtime = fs.statSync(logbookPath).mtimeMs;

    // Record that delta was created AFTER logbook was written
    fs.writeFileSync(deltaPath, 'delta content');
    const idx = JSON.parse(fs.readFileSync(path.join(memDir, 'memory-index.json'), 'utf8'));
    idx.deltaCreatedAtMemoryMtime = logbookMtime;  // same mtime = not updated since
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify(idx));

    const result = mod.cleanupDeltaTemp();
    assertEqual(result, false, 'cleanupDeltaTemp blocked (returns false)');
    assert(fs.existsSync(deltaPath), 'delta_temp.txt still exists (not deleted)');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 12. markDeltaProcessing — sets deltaProcessing flag in index
// ============================================================
test('markDeltaProcessing: sets deltaProcessing = true in index', function() {
  const { tmpDir, memDir } = setupProject({});
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.markDeltaProcessing();
    assert(result, 'returns true');
    const idx = JSON.parse(fs.readFileSync(path.join(memDir, 'memory-index.json'), 'utf8'));
    assertEqual(idx.deltaProcessing, true, 'deltaProcessing set to true');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 13. markMemoryAppended — sets memoryAppendedInThisRun flag in index
// ============================================================
test('markMemoryAppended: sets memoryAppendedInThisRun = true in index', function() {
  const { tmpDir, memDir } = setupProject({});
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.markMemoryAppended();
    assert(result, 'returns true');
    const idx = JSON.parse(fs.readFileSync(path.join(memDir, 'memory-index.json'), 'utf8'));
    assertEqual(idx.memoryAppendedInThisRun, true, 'memoryAppendedInThisRun set to true');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 14. extractDelta — delta content appended (not overwritten)
// ============================================================
test('extractDelta: appends to delta_temp.txt (does not overwrite)', function() {
  const now = new Date().toISOString();
  const lines = [
    JSON.stringify({ ts: now, role: 'user', text: 'First run message' }),
  ];
  const { tmpDir, memDir } = setupProject({ l1Lines: lines });
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const deltaPath = path.join(memDir, 'delta_temp.txt');

    // Pre-populate delta_temp.txt with existing content
    fs.writeFileSync(deltaPath, 'PRE-EXISTING CONTENT\n');

    const result = mod.extractDelta();
    assertEqual(result.success, true, 'success');
    const content = fs.readFileSync(deltaPath, 'utf8');
    assertIncludes(content, 'PRE-EXISTING CONTENT', 'pre-existing content preserved');
    assertIncludes(content, 'First run message', 'new content appended');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 15. extractDelta — pendingLastProcessedTs set in index after extraction
// ============================================================
test('extractDelta: sets pendingLastProcessedTs in index to max entry ts', function() {
  const ts1 = '2026-01-01T10:00:00.000Z';
  const ts2 = '2026-01-01T11:00:00.000Z';
  const lines = [
    JSON.stringify({ ts: ts1, role: 'user', text: 'Earlier message' }),
    JSON.stringify({ ts: ts2, role: 'assistant', text: 'Later message' }),
  ];
  const { tmpDir, memDir } = setupProject({ l1Lines: lines });
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const result = mod.extractDelta();
    assertEqual(result.success, true, 'success');
    const idx = JSON.parse(fs.readFileSync(path.join(memDir, 'memory-index.json'), 'utf8'));
    assertEqual(idx.pendingLastProcessedTs, ts2, 'pendingLastProcessedTs set to max ts');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// Final results
console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total ===');
process.exit(failed > 0 ? 1 : 0);
