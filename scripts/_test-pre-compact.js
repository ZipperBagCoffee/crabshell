'use strict';

/**
 * _test-pre-compact.js — Tests for pre-compact.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const NODE = process.execPath;
const SCRIPT = path.join(__dirname, 'pre-compact.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log('PASS: ' + name); passed++; }
  catch (e) { console.log('FAIL: ' + name + ' --- ' + e.message); failed++; }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed'); }

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
}

function cleanupDir(dirPath) {
  try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch (e) {}
}

function setupProject(tmpDir, opts = {}) {
  const crabshellDir = path.join(tmpDir, '.crabshell');
  const memoryDir = path.join(crabshellDir, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  if (opts.projectConcept) {
    fs.writeFileSync(path.join(crabshellDir, 'project.md'), opts.projectConcept);
  }

  if (opts.regressingState) {
    fs.writeFileSync(path.join(memoryDir, 'regressing-state.json'), JSON.stringify(opts.regressingState, null, 2));
  }

  if (opts.planIndex) {
    const planDir = path.join(crabshellDir, 'plan');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, 'INDEX.md'), opts.planIndex);
  }

  if (opts.ticketIndex) {
    const ticketDir = path.join(crabshellDir, 'ticket');
    fs.mkdirSync(ticketDir, { recursive: true });
    fs.writeFileSync(path.join(ticketDir, 'INDEX.md'), opts.ticketIndex);
  }
}

function runScript(projectDir, hookData = {}) {
  const input = JSON.stringify(hookData);
  try {
    const result = execSync(`"${NODE}" "${SCRIPT}"`, {
      input,
      timeout: 10000,
      encoding: 'utf8',
      env: { ...process.env, HOOK_DATA: input, CLAUDE_PROJECT_DIR: projectDir },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { exitCode: 0, stdout: result, stderr: '' };
  } catch (e) {
    return { exitCode: e.status || 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

// ============================================================
// Test 1: Fail-open — exits 0 even with no project dir
// ============================================================
test('Fail-open: exits 0 with empty env', function() {
  const tmpDir = makeTempDir('pre-compact-test');
  try {
    const input = JSON.stringify({});
    let exitCode = 0;
    try {
      execSync(`"${NODE}" "${SCRIPT}"`, {
        input,
        timeout: 10000,
        encoding: 'utf8',
        env: { HOOK_DATA: input, CLAUDE_PROJECT_DIR: tmpDir },
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) {
      exitCode = e.status || 1;
    }
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 2: Outputs plain text (not JSON) with CRABSHELL header
// ============================================================
test('Outputs plain text with PRE-COMPACT CONTEXT header', function() {
  const tmpDir = makeTempDir('pre-compact-test');
  try {
    setupProject(tmpDir, { projectConcept: 'My test project.' });
    const { exitCode, stdout } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);
    assert(stdout.includes('CRABSHELL PRE-COMPACT CONTEXT'), 'should contain CRABSHELL PRE-COMPACT CONTEXT, got: ' + stdout.substring(0, 200));
    // Should NOT be parseable as JSON at root level (it's plain text)
    let isJson = false;
    try { JSON.parse(stdout); isJson = true; } catch (e) {}
    assert(!isJson, 'output should be plain text, not JSON');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 3: Includes project concept when project.md exists
// ============================================================
test('Includes project concept from project.md', function() {
  const tmpDir = makeTempDir('pre-compact-test');
  try {
    setupProject(tmpDir, { projectConcept: 'TestProjectConcept123' });
    const { exitCode, stdout } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0');
    assert(stdout.includes('TestProjectConcept123'), 'should include project concept');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 4: Includes active regressing state
// ============================================================
test('Includes active regressing state', function() {
  const tmpDir = makeTempDir('pre-compact-test');
  try {
    setupProject(tmpDir, {
      regressingState: {
        active: true,
        phase: 'execution',
        cycle: 2,
        totalCycles: 3,
        discussion: 'D042',
        planId: 'P099',
        ticketIds: ['P099_T001']
      }
    });
    const { exitCode, stdout } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0');
    assert(stdout.includes('Regressing State'), 'should mention Regressing State');
    assert(stdout.includes('execution'), 'should include phase');
    assert(stdout.includes('D042'), 'should include discussion');
    assert(stdout.includes('P099_T001'), 'should include ticket id');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 5: Inactive regressing state not included
// ============================================================
test('Inactive regressing state not included', function() {
  const tmpDir = makeTempDir('pre-compact-test');
  try {
    setupProject(tmpDir, {
      regressingState: { active: false, phase: 'execution', cycle: 1, totalCycles: 3 }
    });
    const { exitCode, stdout } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0');
    assert(!stdout.includes('Regressing State'), 'should NOT mention Regressing State when inactive');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 6: Active docs (non-done status) are included
// ============================================================
test('Active plan docs included, done docs excluded', function() {
  const tmpDir = makeTempDir('pre-compact-test');
  try {
    const planIndex = `# Plan Index

| ID | Title | Status | Created | Related | Tickets |
|----|-------|--------|---------|---------|---------|
| P001 | Done Plan | done | 2026-01-01 | - | - |
| P002 | Active Plan | active | 2026-01-02 | - | - |
`;
    setupProject(tmpDir, { planIndex });
    const { exitCode, stdout } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0');
    assert(stdout.includes('P002'), 'should include active plan P002');
    assert(!stdout.includes('P001'), 'should NOT include done plan P001');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 7: Logs to stderr with [CRABSHELL] prefix
// ============================================================
test('Logs to stderr with [CRABSHELL] prefix', function() {
  const tmpDir = makeTempDir('pre-compact-test');
  try {
    setupProject(tmpDir, {});
    const input = JSON.stringify({});
    const { spawnSync } = require('child_process');
    const result = spawnSync(NODE, [SCRIPT], {
      input,
      timeout: 10000,
      encoding: 'utf8',
      env: { ...process.env, HOOK_DATA: input, CLAUDE_PROJECT_DIR: tmpDir }
    });
    const stderrOut = result.stderr || '';
    assert(stderrOut.includes('[CRABSHELL]'), 'stderr should contain [CRABSHELL] prefix, got: ' + stderrOut);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log('Results: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
