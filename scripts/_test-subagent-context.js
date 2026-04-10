'use strict';

/**
 * _test-subagent-context.js — Tests for subagent-context.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const NODE = process.execPath;
const SCRIPT = path.join(__dirname, 'subagent-context.js');

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
// Test 1: Exits 0 (fail-open)
// ============================================================
test('Exits 0 (fail-open)', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    const { exitCode } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0, got ' + exitCode);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 2: Outputs valid JSON
// ============================================================
test('Outputs valid JSON', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    const { exitCode, stdout } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0');
    let parsed;
    try { parsed = JSON.parse(stdout.trim()); } catch (e) { throw new Error('output is not valid JSON: ' + stdout.substring(0, 200)); }
    assert(typeof parsed === 'object', 'output should be JSON object');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 3: JSON has correct hookSpecificOutput structure
// ============================================================
test('JSON has hookSpecificOutput.hookEventName = SubagentStart', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    const { stdout } = runScript(tmpDir);
    const parsed = JSON.parse(stdout.trim());
    assert(parsed.hookSpecificOutput, 'should have hookSpecificOutput');
    assert(parsed.hookSpecificOutput.hookEventName === 'SubagentStart',
      'hookEventName should be SubagentStart, got: ' + parsed.hookSpecificOutput.hookEventName);
    assert(typeof parsed.hookSpecificOutput.additionalContext === 'string',
      'additionalContext should be string');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 4: additionalContext under 2000 chars
// ============================================================
test('additionalContext is under 2000 chars', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    setupProject(tmpDir, { projectConcept: 'Test project with a very long description. '.repeat(50) });
    const { stdout } = runScript(tmpDir);
    const parsed = JSON.parse(stdout.trim());
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert(ctx.length <= 2000, 'additionalContext should be <= 2000 chars, got ' + ctx.length);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 5: Contains COMPRESSED_CHECKLIST content
// ============================================================
test('additionalContext contains COMPRESSED_CHECKLIST content', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    const { stdout } = runScript(tmpDir);
    const parsed = JSON.parse(stdout.trim());
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert(ctx.includes('Understanding-First') || ctx.includes('Rules Quick-Check'),
      'should contain checklist content, got: ' + ctx.substring(0, 300));
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 6: Contains project root anchor
// ============================================================
test('additionalContext contains project root anchor', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    const { stdout } = runScript(tmpDir);
    const parsed = JSON.parse(stdout.trim());
    const ctx = parsed.hookSpecificOutput.additionalContext;
    // Should mention the project dir (normalized with forward slashes)
    const expectedDir = tmpDir.replace(/\\/g, '/');
    assert(ctx.includes(expectedDir) || ctx.includes(tmpDir),
      'should contain project root, ctx: ' + ctx.substring(0, 300));
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 7: Contains project concept when project.md exists
// ============================================================
test('additionalContext contains project concept', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    setupProject(tmpDir, { projectConcept: 'UniqueProjectConceptXYZ789' });
    const { stdout } = runScript(tmpDir);
    const parsed = JSON.parse(stdout.trim());
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert(ctx.includes('UniqueProjectConceptXYZ789'), 'should include project concept, ctx: ' + ctx.substring(0, 400));
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 8: Contains active regressing state
// ============================================================
test('additionalContext contains active regressing state', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    setupProject(tmpDir, {
      regressingState: {
        active: true,
        phase: 'execution',
        cycle: 1,
        totalCycles: 3,
        planId: 'P099',
        ticketIds: ['P099_T001']
      }
    });
    const { stdout } = runScript(tmpDir);
    const parsed = JSON.parse(stdout.trim());
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert(ctx.includes('Regressing State') || ctx.includes('execution'),
      'should include regressing state, ctx: ' + ctx.substring(0, 400));
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 9: Logs to stderr with [CRABSHELL] SubagentStart prefix
// ============================================================
test('Logs SubagentStart to stderr', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    const input = JSON.stringify({});
    const { spawnSync } = require('child_process');
    const result = spawnSync(NODE, [SCRIPT], {
      input,
      timeout: 10000,
      encoding: 'utf8',
      env: { ...process.env, HOOK_DATA: input, CLAUDE_PROJECT_DIR: tmpDir }
    });
    const stderrOut = result.stderr || '';
    assert(stderrOut.includes('[CRABSHELL] SubagentStart'), 'stderr should contain [CRABSHELL] SubagentStart, got: ' + stderrOut);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 10: additionalContext contains model routing
// ============================================================
test('additionalContext contains model routing', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    setupProject(tmpDir, {
      projectConcept: 'Test project.\n\n## Model Routing\n| Tier | Model | When |\n|------|-------|------|\n| T1 | Opus | Analysis |\n| T2 | Sonnet | Implementation |\n| T3 | Haiku | Summarization |'
    });
    const { stdout } = runScript(tmpDir);
    const parsed = JSON.parse(stdout.trim());
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert(ctx.includes('Model Routing'), 'should include Model Routing section, ctx: ' + ctx.substring(0, 400));
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 11: model routing stays within 2000 char budget
// ============================================================
test('model routing stays within 2000 char budget', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    const routingSection = '\n\n## Model Routing\n| Tier | Model | When |\n|------|-------|------|\n| T1 | Opus | Analysis, planning, judgment, cross-review |\n| T2 | Sonnet | Implementation, verification, mechanical tasks |\n| T3 | Haiku | Summarization (memory pipeline only) |';
    setupProject(tmpDir, {
      projectConcept: 'Full project with all sections.' + routingSection,
      regressingState: {
        active: true,
        phase: 'execution',
        cycle: 2,
        totalCycles: 3,
        discussion: 'D082',
        planId: 'P109',
        ticketIds: ['P109_T001']
      }
    });
    const { stdout } = runScript(tmpDir);
    const parsed = JSON.parse(stdout.trim());
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert(ctx.length <= 2000, 'additionalContext should be <= 2000 chars with routing, got ' + ctx.length);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// Test 12: missing model routing section handled gracefully
// ============================================================
test('missing model routing section handled gracefully', function() {
  const tmpDir = makeTempDir('subagent-test');
  try {
    // project.md exists but has NO Model Routing section
    setupProject(tmpDir, {
      projectConcept: 'Project without model routing section. Just a normal description.'
    });
    const { exitCode, stdout } = runScript(tmpDir);
    assert(exitCode === 0, 'expected exit 0 when Model Routing section is missing, got ' + exitCode);
    let parsed;
    try { parsed = JSON.parse(stdout.trim()); } catch (e) { throw new Error('output is not valid JSON: ' + stdout.substring(0, 200)); }
    assert(typeof parsed.hookSpecificOutput.additionalContext === 'string',
      'additionalContext should still be a string when Model Routing is missing');
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
