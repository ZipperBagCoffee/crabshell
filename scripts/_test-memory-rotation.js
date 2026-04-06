// _test-memory-rotation.js — Tests for memory-rotation.js
// Covers: checkAndRotate — file absent, below threshold, above threshold,
//         carryover content, archive name pattern, index update, lock behavior,
//         custom thresholdTokens config
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const scriptPath = path.join(__dirname, 'memory-rotation.js');

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
  const dir = path.join(os.tmpdir(), 'test-memory-rotation-' + suffix);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function cleanupDir(dirPath) {
  try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch (e) {}
}

// Build a temp project environment for memory-rotation.js
// The module calls getProjectDir() → reads CLAUDE_PROJECT_DIR env
// and constructs memoryDir as projectDir/.crabshell/memory
function setupProject(opts) {
  opts = opts || {};
  const tmpDir = makeTempDir();
  const memDir = path.join(tmpDir, '.crabshell', 'memory');
  ensureDir(memDir);

  // Write index file
  const defaultIndex = {
    version: 1, current: 'logbook.md', rotatedFiles: [],
    stats: { totalRotations: 0, lastRotation: null },
    lastMemoryUpdateTs: null
  };
  fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify(opts.index || defaultIndex));

  return { tmpDir, memDir };
}

// Generate content of approximate byte size
function makeContent(approximateBytes) {
  const line = 'A'.repeat(79) + '\n';  // 80 bytes per line
  const lineCount = Math.ceil(approximateBytes / 80);
  return line.repeat(lineCount);
}

// Load module exports
const mod = require(scriptPath);

// ============================================================
// 1. File absent → returns null
// ============================================================
test('file absent → returns null', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const nonExistentPath = path.join(memDir, 'logbook.md');
    const result = mod.checkAndRotate(nonExistentPath, {});
    assertEqual(result, null, 'result should be null when file absent');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 2. Below threshold → returns null
// ============================================================
test('below threshold → returns null', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const memoryPath = path.join(memDir, 'logbook.md');
    // Write content well below the 23750 token threshold (~95000 bytes)
    fs.writeFileSync(memoryPath, 'Short content - definitely below threshold.\n');
    const result = mod.checkAndRotate(memoryPath, {});
    assertEqual(result, null, 'result should be null below threshold');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 3. Above threshold → rotates, archive created
// ============================================================
test('above threshold → rotates, archive file created', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const memoryPath = path.join(memDir, 'logbook.md');
    // Write content above threshold (23750 tokens * 4 bytes = ~95000 bytes). Write ~100KB.
    const content = makeContent(100000);
    fs.writeFileSync(memoryPath, content);

    const result = mod.checkAndRotate(memoryPath, {});
    assert(result !== null, 'result should not be null (rotation occurred)');
    assert(result.rotated === true, 'result.rotated should be true');
    assert(result.archiveFile, 'result.archiveFile should be set');

    // Archive file should exist in memDir
    const archivePath = path.join(memDir, result.archiveFile);
    assert(fs.existsSync(archivePath), 'archive file created on disk');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 4. Carryover content is tail of original
// ============================================================
test('carryover content is tail of original logbook', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const memoryPath = path.join(memDir, 'logbook.md');

    // Build content: known marker at the end (should survive in carryover)
    const bulkContent = makeContent(100000);
    const tailMarker = '\n## TAIL_MARKER_UNIQUE_12345\nThis is the tail marker content.\n';
    fs.writeFileSync(memoryPath, bulkContent + tailMarker);

    const result = mod.checkAndRotate(memoryPath, {});
    assert(result !== null, 'rotation occurred');

    // After rotation, logbook.md should contain the tail marker (carryover = tail)
    const newContent = fs.readFileSync(memoryPath, 'utf8');
    assertIncludes(newContent, 'TAIL_MARKER_UNIQUE_12345', 'tail marker present in carryover');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 5. Archive filename matches expected pattern (logbook_YYYYMMDD_HHMMSS.md)
// ============================================================
test('archive filename matches logbook_YYYYMMDD_HHMMSS.md pattern', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const memoryPath = path.join(memDir, 'logbook.md');
    fs.writeFileSync(memoryPath, makeContent(100000));

    const result = mod.checkAndRotate(memoryPath, {});
    assert(result !== null, 'rotation occurred');
    assert(/^logbook_\d{8}_\d{6}\.md$/.test(result.archiveFile),
      'archive filename format: got ' + result.archiveFile);
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 6. Index updated — rotatedFiles entry added, totalRotations incremented
// ============================================================
test('index updated: rotatedFiles entry added, totalRotations incremented', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const memoryPath = path.join(memDir, 'logbook.md');
    fs.writeFileSync(memoryPath, makeContent(100000));

    const indexBefore = JSON.parse(fs.readFileSync(path.join(memDir, 'memory-index.json'), 'utf8'));
    assertEqual(indexBefore.stats.totalRotations, 0, 'totalRotations before');
    assertEqual(indexBefore.rotatedFiles.length, 0, 'rotatedFiles.length before');

    const result = mod.checkAndRotate(memoryPath, {});
    assert(result !== null, 'rotation occurred');

    const indexAfter = JSON.parse(fs.readFileSync(path.join(memDir, 'memory-index.json'), 'utf8'));
    assertEqual(indexAfter.stats.totalRotations, 1, 'totalRotations after');
    assertEqual(indexAfter.rotatedFiles.length, 1, 'rotatedFiles.length after');
    assertEqual(indexAfter.rotatedFiles[0].file, result.archiveFile, 'rotatedFiles[0].file matches archiveFile');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 7. Lock prevents concurrent rotation → returns null
// ============================================================
test('existing lock file prevents rotation → returns null', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const memoryPath = path.join(memDir, 'logbook.md');
    fs.writeFileSync(memoryPath, makeContent(100000));

    // Place a fresh lock file (mtime = now, within stale threshold)
    const lockPath = path.join(memDir, '.rotation.lock');
    fs.writeFileSync(lockPath, '99999');  // fake PID

    const result = mod.checkAndRotate(memoryPath, {});
    assertEqual(result, null, 'result should be null when lock held');

    // Cleanup lock
    try { fs.unlinkSync(lockPath); } catch (e) {}
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 8. Lock released after successful rotation
// ============================================================
test('lock released after rotation completes', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const memoryPath = path.join(memDir, 'logbook.md');
    fs.writeFileSync(memoryPath, makeContent(100000));

    const lockPath = path.join(memDir, '.rotation.lock');
    assert(!fs.existsSync(lockPath), 'lock absent before rotation');

    const result = mod.checkAndRotate(memoryPath, {});
    assert(result !== null, 'rotation occurred');
    assert(!fs.existsSync(lockPath), 'lock released after rotation');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 9. Custom thresholdTokens config works
// ============================================================
test('custom thresholdTokens config: small threshold triggers rotation on small file', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const memoryPath = path.join(memDir, 'logbook.md');
    // Write ~500 bytes (well below default 23750-token threshold)
    fs.writeFileSync(memoryPath, makeContent(500));

    // Default threshold: returns null (below 23750 tokens)
    const resultDefault = mod.checkAndRotate(memoryPath, {});
    assertEqual(resultDefault, null, 'default threshold: no rotation for small file');

    // Re-write (was rotated away or just test again)
    fs.writeFileSync(memoryPath, makeContent(500));

    // Custom threshold: 10 tokens (~40 bytes). 500 bytes >> 10 tokens → should rotate.
    const resultCustom = mod.checkAndRotate(memoryPath, { memoryRotation: { thresholdTokens: 10 } });
    assert(resultCustom !== null, 'custom threshold triggered rotation');
    assert(resultCustom.rotated === true, 'result.rotated = true with custom threshold');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 10. Result contains hookOutput field with archive filename
// ============================================================
test('rotation result has hookOutput field referencing archive file', function() {
  const { tmpDir, memDir } = setupProject();
  try {
    process.env.CLAUDE_PROJECT_DIR = tmpDir;
    const memoryPath = path.join(memDir, 'logbook.md');
    fs.writeFileSync(memoryPath, makeContent(100000));

    const result = mod.checkAndRotate(memoryPath, {});
    assert(result !== null, 'rotation occurred');
    assert(typeof result.hookOutput === 'string', 'hookOutput is a string');
    assertIncludes(result.hookOutput, result.archiveFile, 'hookOutput references archiveFile');
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR;
    cleanupDir(tmpDir);
  }
});

// Final results
console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total ===');
process.exit(failed > 0 ? 1 : 0);
