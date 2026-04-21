'use strict';

/**
 * Tests for scripts/wa-count-pretool.js (P131_T001).
 * Verifies optimistic PreToolUse WA/RA increment on Agent|Task|TaskCreate dispatch.
 *
 * Uses tmp-dir isolation via CLAUDE_PROJECT_DIR override + spawnSync subprocess.
 *
 * Coverage:
 *   Happy paths (AC1, AC3):
 *     - Agent dispatch → waCount +1
 *     - Task dispatch → waCount +1
 *     - TaskCreate dispatch → waCount +1
 *     - RA classification (prompt contains "verify") → raCount +1
 *   Negative paths (AC5):
 *     - Non-Agent tool (Bash) → no change
 *     - Malformed stdin (garbage) → exit 0, no change
 *     - Empty stdin → exit 0, no change
 *   Edge (AC4 double-count):
 *     - Pre starts from seeded waCount=0 → exactly 1 increment
 *   Background (AC6):
 *     - run_in_background=true → waCount/raCount unchanged, backgroundAgentPending set
 *
 * Run: node scripts/_test-wa-count-pretool.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const NODE = process.execPath; // current Node runtime
const SCRIPT = path.join(__dirname, 'wa-count-pretool.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/**
 * Create isolated tmp project dir with seeded wa-count.json.
 * Returns { projectDir, waCountPath, cleanup }.
 */
function makeTmpProject(seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-pretool-test-'));
  const memDir = path.join(dir, '.crabshell', 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  const waPath = path.join(memDir, 'wa-count.json');
  fs.writeFileSync(waPath, JSON.stringify(seed || { waCount: 0, raCount: 0, totalTaskCalls: 0 }));
  return {
    projectDir: dir,
    waCountPath: waPath,
    cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  };
}

/**
 * Run wa-count-pretool.js as a subprocess.
 * @param {string} stdinStr - raw stdin payload (may be invalid JSON)
 * @param {string} projectDir - CLAUDE_PROJECT_DIR
 * @returns {{code:number, stderr:string, stdout:string}}
 */
function runScript(stdinStr, projectDir) {
  // Isolate HOOK_DATA — transcript-utils readStdin uses env fast-path when set
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  delete env.HOOK_DATA;
  delete env.CRABSHELL_BACKGROUND;
  const res = spawnSync(NODE, [SCRIPT], {
    input: stdinStr,
    timeout: 8000,
    encoding: 'utf8',
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  return { code: res.status, stderr: res.stderr || '', stdout: res.stdout || '' };
}

function readWa(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// =============================================================================

console.log('\n=== wa-count-pretool.js ===\n');

// TC1: Agent tool → waCount +1
test('TC1: Agent dispatch → waCount +1', () => {
  const proj = makeTmpProject({ waCount: 0, raCount: 0, totalTaskCalls: 0 });
  try {
    const stdin = JSON.stringify({ tool_name: 'Agent', tool_input: { prompt: 'do something', description: 'implementer' } });
    const res = runScript(stdin, proj.projectDir);
    assertEq(res.code, 0, `exit code (stderr=${res.stderr})`);
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 1, 'waCount');
    assertEq(wa.raCount, 0, 'raCount');
    assertEq(wa.totalTaskCalls, 1, 'totalTaskCalls');
  } finally { proj.cleanup(); }
});

// TC2: Task tool → waCount +1
test('TC2: Task dispatch → waCount +1', () => {
  const proj = makeTmpProject({ waCount: 0, raCount: 0, totalTaskCalls: 0 });
  try {
    const stdin = JSON.stringify({ tool_name: 'Task', tool_input: { prompt: 'implement the feature' } });
    const res = runScript(stdin, proj.projectDir);
    assertEq(res.code, 0, 'exit code');
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 1, 'waCount');
    assertEq(wa.totalTaskCalls, 1, 'totalTaskCalls');
  } finally { proj.cleanup(); }
});

// TC3: TaskCreate tool → waCount +1
test('TC3: TaskCreate dispatch → waCount +1', () => {
  const proj = makeTmpProject({ waCount: 0, raCount: 0, totalTaskCalls: 0 });
  try {
    const stdin = JSON.stringify({ tool_name: 'TaskCreate', tool_input: { prompt: 'build the thing' } });
    const res = runScript(stdin, proj.projectDir);
    assertEq(res.code, 0, 'exit code');
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 1, 'waCount');
    assertEq(wa.totalTaskCalls, 1, 'totalTaskCalls');
  } finally { proj.cleanup(); }
});

// TC4: RA classification (prompt contains "verify") → raCount +1
test('TC4: Agent with "verify" prompt → raCount +1 (not waCount)', () => {
  const proj = makeTmpProject({ waCount: 0, raCount: 0, totalTaskCalls: 0 });
  try {
    const stdin = JSON.stringify({ tool_name: 'Agent', tool_input: { prompt: 'You are Review Agent — verify the output.' } });
    const res = runScript(stdin, proj.projectDir);
    assertEq(res.code, 0, 'exit code');
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 0, 'waCount unchanged');
    assertEq(wa.raCount, 1, 'raCount');
    assertEq(wa.totalTaskCalls, 1, 'totalTaskCalls');
  } finally { proj.cleanup(); }
});

// TC5: Non-Agent tool (Bash) → no change
test('TC5: Non-Agent tool (Bash) → no state change', () => {
  const seed = { waCount: 3, raCount: 2, totalTaskCalls: 5 };
  const proj = makeTmpProject(seed);
  try {
    const stdin = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } });
    const res = runScript(stdin, proj.projectDir);
    assertEq(res.code, 0, 'exit code');
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 3, 'waCount unchanged');
    assertEq(wa.raCount, 2, 'raCount unchanged');
    assertEq(wa.totalTaskCalls, 5, 'totalTaskCalls unchanged');
  } finally { proj.cleanup(); }
});

// TC6: Malformed stdin → exit 0, no change
test('TC6: Malformed JSON stdin → exit 0, no change', () => {
  const seed = { waCount: 1, raCount: 0, totalTaskCalls: 1 };
  const proj = makeTmpProject(seed);
  try {
    const res = runScript('not valid json {{{', proj.projectDir);
    assertEq(res.code, 0, 'exit code must be 0 (fail-open)');
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 1, 'waCount unchanged');
    assertEq(wa.raCount, 0, 'raCount unchanged');
    assertEq(wa.totalTaskCalls, 1, 'totalTaskCalls unchanged');
  } finally { proj.cleanup(); }
});

// TC7: Empty stdin → exit 0, no change
test('TC7: Empty stdin → exit 0, no change', () => {
  const seed = { waCount: 0, raCount: 0, totalTaskCalls: 0 };
  const proj = makeTmpProject(seed);
  try {
    const res = runScript('', proj.projectDir);
    assertEq(res.code, 0, 'exit code must be 0 (fail-open)');
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 0, 'waCount unchanged');
    assertEq(wa.raCount, 0, 'raCount unchanged');
    assertEq(wa.totalTaskCalls, 0, 'totalTaskCalls unchanged');
  } finally { proj.cleanup(); }
});

// TC8: Agent with missing tool_input → treat as WA (fail-safe classifier default)
test('TC8: Agent with no tool_input → waCount +1 (fail-safe default)', () => {
  const proj = makeTmpProject({ waCount: 0, raCount: 0, totalTaskCalls: 0 });
  try {
    const stdin = JSON.stringify({ tool_name: 'Agent' });
    const res = runScript(stdin, proj.projectDir);
    assertEq(res.code, 0, 'exit code');
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 1, 'waCount default-WA');
    assertEq(wa.totalTaskCalls, 1, 'totalTaskCalls');
  } finally { proj.cleanup(); }
});

// TC9 (AC4): exactly-one-increment — back-to-back Agent dispatch, check cumulative
test('TC9: Two Agent dispatches in sequence → waCount +2 exactly (no double-count)', () => {
  const proj = makeTmpProject({ waCount: 0, raCount: 0, totalTaskCalls: 0 });
  try {
    const stdin = JSON.stringify({ tool_name: 'Agent', tool_input: { prompt: 'task 1' } });
    const r1 = runScript(stdin, proj.projectDir);
    assertEq(r1.code, 0, 'r1 exit');
    const r2 = runScript(stdin, proj.projectDir);
    assertEq(r2.code, 0, 'r2 exit');
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 2, 'waCount == 2 (one per dispatch, not four)');
    assertEq(wa.totalTaskCalls, 2, 'totalTaskCalls == 2');
  } finally { proj.cleanup(); }
});

// TC10 (AC6): Background agent — waCount unchanged, backgroundAgentPending set
test('TC10: Agent with run_in_background=true → waCount unchanged, backgroundAgentPending set', () => {
  const proj = makeTmpProject({ waCount: 0, raCount: 0, totalTaskCalls: 0 });
  try {
    const stdin = JSON.stringify({ tool_name: 'Agent', tool_input: { prompt: 'bg task', run_in_background: true } });
    const res = runScript(stdin, proj.projectDir);
    assertEq(res.code, 0, 'exit code');
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 0, 'waCount unchanged (background)');
    assertEq(wa.totalTaskCalls, 1, 'totalTaskCalls still increments');
    if (!wa.backgroundAgentPending || wa.backgroundAgentPending.count !== 1) {
      throw new Error(`backgroundAgentPending.count should be 1, got ${JSON.stringify(wa.backgroundAgentPending)}`);
    }
  } finally { proj.cleanup(); }
});

// =============================================================================
// WA2 edge-case additions (classifyAgent hardening + rarer stdin shapes)
// =============================================================================

console.log('\n=== WA2 edge-case coverage ===\n');

const { classifyAgent } = require('./counter');

// Module-level: classifyAgent fail-open guards
test('WA2-E1: classifyAgent(null) → null (fail-open)', () => {
  assertEq(classifyAgent(null), null, 'null hookData');
});

test('WA2-E2: classifyAgent(undefined) → null', () => {
  assertEq(classifyAgent(undefined), null, 'undefined hookData');
});

test('WA2-E3: classifyAgent({}) → null (no tool_name)', () => {
  assertEq(classifyAgent({}), null);
});

test('WA2-E4: classifyAgent tool_input=null → WA default', () => {
  assertEq(classifyAgent({ tool_name: 'Agent', tool_input: null }), 'WA');
});

test('WA2-E5: classifyAgent prompt=number → WA (string-coercion guard)', () => {
  assertEq(classifyAgent({ tool_name: 'Agent', tool_input: { prompt: 42 } }), 'WA');
});

test('WA2-E6: classifyAgent prompt=object → WA (string-coercion guard)', () => {
  assertEq(classifyAgent({ tool_name: 'Agent', tool_input: { prompt: { x: 'verify' } } }), 'WA');
});

test('WA2-E7: classifyAgent unknown tool_name (Write) → null', () => {
  assertEq(classifyAgent({ tool_name: 'Write' }), null);
});

test('WA2-E8: classifyAgent empty tool_name → null', () => {
  assertEq(classifyAgent({ tool_name: '' }), null);
});

// Subprocess: stdin edge cases
test('WA2-E9: stdin="null" (JSON null) → exit 0, no mutation', () => {
  const proj = makeTmpProject({ waCount: 2, raCount: 1, totalTaskCalls: 3 });
  try {
    const res = runScript('null', proj.projectDir);
    assertEq(res.code, 0, 'fail-open exit 0');
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 2);
    assertEq(wa.raCount, 1);
    assertEq(wa.totalTaskCalls, 3);
  } finally { proj.cleanup(); }
});

test('WA2-E10: stdin={} (empty object) → exit 0, no mutation', () => {
  const proj = makeTmpProject({ waCount: 2, raCount: 0, totalTaskCalls: 2 });
  try {
    const res = runScript('{}', proj.projectDir);
    assertEq(res.code, 0);
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 2);
  } finally { proj.cleanup(); }
});

test('WA2-E11: huge prompt (100KB) → exit 0, waCount +1 (no OOM/timeout)', () => {
  const proj = makeTmpProject({ waCount: 0, raCount: 0, totalTaskCalls: 0 });
  try {
    const bigPrompt = 'x'.repeat(100 * 1024);
    const stdin = JSON.stringify({ tool_name: 'Agent', tool_input: { prompt: bigPrompt } });
    const res = runScript(stdin, proj.projectDir);
    assertEq(res.code, 0, `exit 0 (stderr=${res.stderr.slice(0, 200)})`);
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 1);
  } finally { proj.cleanup(); }
});

test('WA2-E12: run_in_background=false (explicit) → waCount +1, no bg entry', () => {
  const proj = makeTmpProject({ waCount: 0, raCount: 0, totalTaskCalls: 0 });
  try {
    const stdin = JSON.stringify({ tool_name: 'Agent', tool_input: { prompt: 'fg', run_in_background: false } });
    const res = runScript(stdin, proj.projectDir);
    assertEq(res.code, 0);
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 1);
    if (wa.backgroundAgentPending) throw new Error('backgroundAgentPending must NOT be set when run_in_background=false');
  } finally { proj.cleanup(); }
});

test('WA2-E13: background with existing pending → count accumulates', () => {
  const proj = makeTmpProject({
    waCount: 0, raCount: 0, totalTaskCalls: 0,
    backgroundAgentPending: { count: 3, launchedAt: '2026-01-01T00:00:00Z' }
  });
  try {
    const stdin = JSON.stringify({ tool_name: 'Task', tool_input: { prompt: 'bg2', run_in_background: true } });
    const res = runScript(stdin, proj.projectDir);
    assertEq(res.code, 0);
    const wa = readWa(proj.waCountPath);
    assertEq(wa.backgroundAgentPending.count, 4, 'pending count accumulated');
    assertEq(wa.waCount, 0, 'waCount still zero');
  } finally { proj.cleanup(); }
});

test('WA2-E14: CRABSHELL_BACKGROUND=1 → script exits 0 without mutation', () => {
  const proj = makeTmpProject({ waCount: 5, raCount: 0, totalTaskCalls: 5 });
  try {
    const env = { ...process.env, CLAUDE_PROJECT_DIR: proj.projectDir, CRABSHELL_BACKGROUND: '1' };
    delete env.HOOK_DATA;
    const res = spawnSync(NODE, [SCRIPT], {
      input: JSON.stringify({ tool_name: 'Agent', tool_input: { prompt: 'x' } }),
      timeout: 8000,
      encoding: 'utf8',
      env,
    });
    assertEq(res.status, 0, 'exit 0');
    const wa = readWa(proj.waCountPath);
    assertEq(wa.waCount, 5, 'no mutation under CRABSHELL_BACKGROUND=1');
  } finally { proj.cleanup(); }
});

test('WA2-E15: UTF-8 BOM on stdin → exit 0 (must not throw)', () => {
  const proj = makeTmpProject({ waCount: 2, raCount: 0, totalTaskCalls: 2 });
  try {
    const raw = '﻿' + JSON.stringify({ tool_name: 'Agent', tool_input: { prompt: 'x' } });
    const res = runScript(raw, proj.projectDir);
    assertEq(res.code, 0, 'must fail-open');
    const wa = readWa(proj.waCountPath);
    // BOM either breaks parse (waCount stays 2) or tolerated (waCount=3). Both OK.
    if (wa.waCount !== 2 && wa.waCount !== 3) {
      throw new Error(`waCount must be 2 or 3, got ${wa.waCount}`);
    }
  } finally { proj.cleanup(); }
});

test('WA2-E16: RA detected via description (not prompt) → raCount +1', () => {
  const proj = makeTmpProject({ waCount: 0, raCount: 0, totalTaskCalls: 0 });
  try {
    const stdin = JSON.stringify({ tool_name: 'Task', tool_input: { prompt: 'run', description: 'Reviewer pass' } });
    const res = runScript(stdin, proj.projectDir);
    assertEq(res.code, 0);
    const wa = readWa(proj.waCountPath);
    assertEq(wa.raCount, 1);
    assertEq(wa.waCount, 0);
  } finally { proj.cleanup(); }
});

// =============================================================================

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAIL: some tests failed');
  process.exit(1);
} else {
  console.log('PASS: all tests passed');
  process.exit(0);
}
