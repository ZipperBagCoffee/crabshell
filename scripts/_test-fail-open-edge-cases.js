'use strict';
/**
 * Fail-open regressions retained after D110 legacy orchestration retirement.
 *
 * 3 cases:
 *  1) retired verifier state is ignored while normal rules still inject.
 *  2) utils.js load failure remains fail-open for every retained hook module.
 *  3) lock-contention instrumentation failure preserves lock semantics.
 *
 * Spawn-based per case, sandbox CLAUDE_PROJECT_DIR. Critical pattern: any
 * setup that mutates the live scripts/ directory (Case 1 rename) MUST use
 * try/finally + process.on('exit') restore to guarantee restoration even on
 * test crash.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPTS_DIR = __dirname;
const INJECT_SCRIPT = path.join(SCRIPTS_DIR, 'inject-rules.js');
const NODE = process.execPath;

let passed = 0;
let failed = 0;
const tmpDirs = [];

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

function makeSandbox(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p136t002-failopen-' + prefix + '-'));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function statePath(sandbox) {
  return path.join(sandbox, '.crabshell', 'memory', 'behavior-verifier-state.json');
}

// ---------- Case 1 — retired verifier state is ignored without breaking rules injection ----------
//
// We craft an entry whose `ts` is an object — when `new Date(e.ts)` is called
// the date is Invalid; `pad(d.getUTCHours())` returns NaN-padded; non-fatal.
// To FORCE a throw we instead poison `e.reason` to be an object with a getter
// that throws when String() coerces it.
(function() {
  const sb = makeSandbox('c1');
  // Build a state with a poisoned ringBuffer entry.
  // The reader does: `String(e.reason || '').slice(0, 80)`. If e.reason is an
  // object whose toString throws, the historical per-entry renderer would throw.
  // The retired consumer must ignore the entire state instead.
  // We can't write a function/getter through JSON, so we instead use a value
  // that triggers a real throw chain inside the render path. The most reliable:
  // make the ENTIRE ringBuffer not an array (Array.isArray check fails first,
  // so render is skipped — that doesn't exercise the catch). Instead, make
  // the entry an array (truthy) but its rendering path throws.
  //
  // Concretely, set ringBuffer to an array where one entry is `e` such that
  // `String(e.reason || '')` triggers a TypeError. JSON cannot encode getters,
  // so we pass `e` as a literal that the JS engine will coerce normally and
  // NOT throw on. Pure JSON cannot represent a throwing toString.
  //
  // Adjusted approach: instead of forcing a render throw, we verify the
  // STRUCTURAL fail-open guarantees by passing a non-array ringBuffer (which
  // is the most common runtime corruption — sub-agent wrote a string instead
  // of preserving the array). The Array.isArray guard at L769 ensures the
  // ring buffer section is skipped, and dispatch instruction still emits.
  // This exercises the type-guard fail-open path.
  const state = {
    taskId: 'verify-c5',
    lastResponseId: 'sess-c5',
    status: 'pending',
    launchedAt: new Date().toISOString(),
    verdicts: null,
    dispatchOverdue: false,
    triggerReason: 'stop',
    lastFiredAt: new Date().toISOString(),
    lastFiredTurn: 0,
    missedCount: 0,
    escalationLevel: 0,
    // POISON: ringBuffer is a string, not an array — Array.isArray guard fails,
    // ring buffer section skipped, but dispatch still emits.
    ringBuffer: 'corrupted-not-an-array',
    turnType: 'user-facing',
    lastUpdatedAt: new Date().toISOString()
  };
  fs.writeFileSync(statePath(sb), JSON.stringify(state, null, 2), 'utf8');

  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sb });
  delete env.CRABSHELL_BACKGROUND;
  delete env.CRABSHELL_AGENT;
  const r = spawnSync(NODE, [INJECT_SCRIPT], {
    input: JSON.stringify({ prompt: 'test prompt' }),
    timeout: 10000, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], env
  });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout || '{}'); } catch { parsed = null; }
  const ctx = (parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext) || '';

  // Expected: exit 0; retired ring-buffer and dispatch surfaces are both absent,
  // while the normal quick-check remains available.
  const noRingBuffer = !ctx.includes('## Watcher Recent Verdicts');
  const noDispatch = !ctx.includes('(Behavior Verifier) Dispatch Required');
  const normalRules = ctx.includes('## Rules Quick-Check');
  const condition = r.status === 0 && noRingBuffer && noDispatch && normalRules;
  ok('1 retired verifier state → no ring buffer/dispatch + normal rules preserved',
     condition,
     'exit=' + r.status + ' noRingBuffer=' + noRingBuffer + ' noDispatch=' + noDispatch
     + ' normalRules=' + normalRules
     + ' ctx=' + JSON.stringify(ctx.slice(0, 200)));
})();

// ---------- Case 2 — utils.js load failure → all hooks fail-open via inline check ----------
//
// D106 IA-10 (P142_T002 AC-7): rename scripts/utils.js → scripts/utils.js.bak so
// any hook that does `require('./utils')` throws MODULE_NOT_FOUND. With
// CRABSHELL_BACKGROUND=1 set, every hook MUST fail-open (exit 0) because the
// inline `process.env.CRABSHELL_BACKGROUND === '1'` early-exit runs BEFORE the
// utils.js require statement (F1 mitigation invariant).
//
// Defense-in-depth restore: try/finally + process.on('exit') (mirrors Case 1
// pattern). If the test crashes between rename and restore, exit handler still
// restores utils.js so subsequent test runs don't break the live scripts/ dir.
(function() {
  const liveUtils = path.join(SCRIPTS_DIR, 'utils.js');
  const bakUtils = path.join(SCRIPTS_DIR, 'utils.js.failopen-test.bak');
  let renamed = false;
  // Defense-in-depth restore: even if the test crashes, process.on('exit') runs.
  const restore = () => {
    if (renamed && fs.existsSync(bakUtils) && !fs.existsSync(liveUtils)) {
      try { fs.renameSync(bakUtils, liveUtils); } catch (_) {}
    }
  };
  process.on('exit', restore);

  // Retained hook-capable modules (every script in scripts/ that contains the inline
  // CRABSHELL_BACKGROUND === '1' early-exit, excluding utils.js itself).
  // deferral-guard.js removed (P152_T001 AC-4 — file deleted).
  const HOOK_FILES = [
    'counter.js',
    'doc-watchdog.js',
    'docs-guard.js',
    'inject-rules.js',
    'load-memory.js',
    'log-guard.js',
    'path-guard.js',
    'post-compact.js',
    'pre-compact.js',
    'pressure-guard.js',
    'regressing-guard.js',
    'regressing-loop-guard.js',
    'scope-guard.js',
    'skill-tracker.js',
    'subagent-context.js',
    'sycophancy-guard.js',
    'verification-sequence.js',
    'verify-guard.js'
  ];

  try {
    if (!fs.existsSync(liveUtils)) {
      ok('2 utils.js load fail → retained hooks fail-open', false,
         'precondition: utils.js missing — cannot rename');
      return;
    }
    fs.renameSync(liveUtils, bakUtils);
    renamed = true;

    const env = Object.assign({}, process.env, { CRABSHELL_BACKGROUND: '1' });
    delete env.CRABSHELL_AGENT;

    const failures = [];
    for (const hookName of HOOK_FILES) {
      const hookPath = path.join(SCRIPTS_DIR, hookName);
      if (!fs.existsSync(hookPath)) {
        failures.push(hookName + ' (missing)');
        continue;
      }
      const r = spawnSync(NODE, [hookPath], {
        input: '',
        timeout: 5000, encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'], env
      });
      if (r.status !== 0) {
        failures.push(hookName + ' (exit=' + r.status
          + ' stderr=' + JSON.stringify((r.stderr || '').slice(0, 100)) + ')');
      }
    }

    ok('2 utils.js load fail → all retained hook-capable modules fail-open (CRABSHELL_BACKGROUND=1 inline early-exit)',
       failures.length === 0,
       failures.length > 0 ? 'failed=' + failures.join('; ') : 'all ' + HOOK_FILES.length + ' modules exit 0');
  } finally {
    // Synchronous restore — must succeed so subsequent test runs (and the live
    // plugin) see utils.js back in place.
    if (renamed && fs.existsSync(bakUtils)) {
      fs.renameSync(bakUtils, liveUtils);
      renamed = false;
    }
  }
})();

// ---------- Case 3 — lock-contention.json unwritable → instrumentation silent skip, lock semantics preserved ----------
//
// D107 cycle 5 F-4 (P147 AC-6 + RA1 R-1 fail-open invariant): make
// .crabshell/memory/lock-contention.json a DIRECTORY (not a file) so the
// instrumentation `writeJson` call inside `_recordContention` throws on
// rename-to-directory (EISDIR / EPERM on Win32). The instrumentation MUST
// silently swallow the error and the lock acquire/release MUST proceed
// normally with correct boolean return semantics:
//   - first acquireIndexLock → true (lock created)
//   - second acquireIndexLock → false (lock held)
//   - releaseIndexLock → no throw
//   - third acquireIndexLock after release → true (lock available again)
//
// In-process L1 — direct execution of utils.js exports, no spawn needed.
(function() {
  // Use a fresh sandbox; require utils.js fresh against a clean temp dir.
  const sb = makeSandbox('c3');
  const memoryDir = path.join(sb, '.crabshell', 'memory');
  // POISON: make lock-contention.json a directory so writeJson temp+rename fails.
  fs.mkdirSync(path.join(memoryDir, 'lock-contention.json'));

  // Require utils with cleared cache so it picks up no stale module state.
  const utilsPath = path.join(SCRIPTS_DIR, 'utils.js');
  delete require.cache[utilsPath];
  const { acquireIndexLock, releaseIndexLock } = require(utilsPath);

  let r1, r2, r3;
  let releaseThrew = false;
  try {
    r1 = acquireIndexLock(memoryDir);
    r2 = acquireIndexLock(memoryDir);
    try { releaseIndexLock(memoryDir); } catch (e) { releaseThrew = true; }
    r3 = acquireIndexLock(memoryDir);
    try { releaseIndexLock(memoryDir); } catch {}
  } catch (e) {
    // Any throw out of acquire/release violates fail-open invariant.
    ok('3 lock-contention.json as directory → instrumentation silent skip + lock semantics preserved',
       false, 'unexpected throw: ' + (e && e.message));
    return;
  }

  const condition = r1 === true && r2 === false && !releaseThrew && r3 === true;
  ok('3 lock-contention.json as directory → instrumentation silent skip + lock semantics preserved',
     condition,
     'r1=' + r1 + ' r2=' + r2 + ' releaseThrew=' + releaseThrew + ' r3=' + r3);
})();

// Cleanup
for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
