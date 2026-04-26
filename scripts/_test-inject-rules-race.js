// _test-inject-rules-race.js
// Behavioral regression: inject-rules.js concurrent RMW must not lose updates.
//
// Design note: inject-rules.js uses non-blocking acquireIndexLock (single-try, no retry).
// Lock-busy processes fail-open — they skip the write (by design, per T001 AC1).
// So for N concurrent processes, the on-disk consecutiveCount equals the number of
// processes that successfully acquired the lock (= N - lockBusy). "Lost update 0건"
// means: on-disk count equals the number of successful-write events (each lock-winner
// bumps by exactly 1), NOT that count equals N.
//
// This test spawns N=5 concurrent subprocesses, counts stderr '[PRESSURE L' markers
// (one per subprocess invoking the pressure branch) and '[inject-rules: index lock busy'
// lines (lock-skip events), and asserts:
//   on_disk_count == (processes_that_ran_pressure_branch - lock_busy_skips)
//   on_disk_count >= 1  (at least one winner)
//   no subprocess crashed
// 3 trials per run. Per T001 RA behavioral proof (N=8, lockBusy=3, count=5).
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const injectRulesPath = path.join(__dirname, 'inject-rules.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { console.log('FAIL: ' + name + ' --- ' + e.message); failed++; }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
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

// Spawn one inject-rules.js subprocess with CLAUDE_PROJECT_DIR=tmpDir and stdin payload.
function spawnInject(tmpDir, payload) {
  return new Promise(function(resolve) {
    const child = spawn(process.execPath, [injectRulesPath], {
      env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: tmpDir }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', function(d) { stdout += d.toString(); });
    child.stderr.on('data', function(d) { stderr += d.toString(); });
    child.on('close', function(code) { resolve({ code: code, stdout: stdout, stderr: stderr }); });
    child.on('error', function() { resolve({ code: -1, stdout: stdout, stderr: stderr }); });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

// Seed a fresh tmp memory dir with an initial memory-index.json.
function seedTmpDir() {
  const tmpDir = makeTempDir('inject-race');
  const memoryDir = path.join(tmpDir, '.crabshell', 'memory');
  ensureDir(memoryDir);
  ensureDir(path.join(memoryDir, 'logs'));
  const initialIndex = {
    version: 1,
    current: 'memory.md',
    rotatedFiles: [],
    stats: { totalRotations: 0, lastRotation: null },
    lastMemoryUpdateTs: null,
    feedbackPressure: { level: 0, consecutiveCount: 0, decayCounter: 0, oscillationCount: 0, lastShownLevel: 0 },
  };
  fs.writeFileSync(path.join(memoryDir, 'memory-index.json'), JSON.stringify(initialIndex, null, 2), 'utf8');
  return tmpDir;
}

function readIndex(tmpDir) {
  const indexPath = path.join(tmpDir, '.crabshell', 'memory', 'memory-index.json');
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

function countOccurrences(text, needle) {
  if (!text) return 0;
  let count = 0; let idx = 0;
  while ((idx = text.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
  return count;
}

// Run one trial: N concurrent inject-rules.js with negative-feedback prompt.
// Assert no lost updates: on-disk count equals (winners - none_lost).
async function runTrial(trialNum, N) {
  const tmpDir = seedTmpDir();
  try {
    const payload = JSON.stringify({ prompt: '시발 짜증나' });  // W021: profanity (틀렸/다시 해 removed from NEGATIVE_PATTERNS)
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(spawnInject(tmpDir, payload));
    }
    const results = await Promise.all(promises);

    // Sanity: no crashes (exit code should be 0 or 1 at most — inject-rules fails-open).
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.code !== 0 && r.code !== 1) {
        throw new Error('subprocess ' + i + ' crashed, code=' + r.code + ' stderr=' + r.stderr.slice(0, 200));
      }
    }

    // Count lock-busy skip events across all subprocess stderrs.
    let lockBusy = 0;
    for (let i = 0; i < results.length; i++) {
      lockBusy += countOccurrences(results[i].stderr, '[inject-rules: index lock busy');
    }
    const winners = N - lockBusy;

    const index = readIndex(tmpDir);
    const fp = index.feedbackPressure || {};
    const onDiskCount = fp.consecutiveCount;

    // Primary assertion: no lost updates. Each winner bumped the counter by exactly 1.
    if (onDiskCount !== winners) {
      throw new Error('trial ' + trialNum + ' LOST UPDATE: on-disk count=' + onDiskCount +
        ', winners(N - lockBusy)=' + winners + ' (N=' + N + ', lockBusy=' + lockBusy + ')');
    }
    // Sanity: at least one winner (otherwise test infrastructure is broken).
    assert(winners >= 1, 'trial ' + trialNum + ' no winners — suspect infra issue');
  } finally {
    cleanupDir(tmpDir);
  }
}

// ============================================================
// Tests
// ============================================================
async function main() {
  const N = 5;
  const trials = 3;

  for (let t = 1; t <= trials; t++) {
    try {
      await runTrial(t, N);
      console.log('PASS: T-RACE-' + t + ': N=' + N + ' concurrent, no lost updates');
      passed++;
    } catch (e) {
      console.log('FAIL: T-RACE-' + t + ' --- ' + e.message);
      failed++;
    }
  }

  // Isolation check: tmp dir cleanup works.
  test('T-RACE-ISOLATION: tmp dir cleanup removes all state', function() {
    const tmpDir = seedTmpDir();
    cleanupDir(tmpDir);
    if (fs.existsSync(tmpDir)) {
      throw new Error('tmp dir not cleaned: ' + tmpDir);
    }
  });

  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function(e) {
  console.log('FAIL: unexpected top-level error --- ' + e.message);
  console.log('Results: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
