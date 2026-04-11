'use strict';
// Unit tests for scripts/completion-drive-write-guard.js
// Run: node scripts/_test-completion-drive-write-guard.js

const assert = require('assert');
const path = require('path');

// Set required env vars before requiring the module
process.env.CLAUDE_PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const {
  shouldSkipPath,
  isRegressingActive,
  isLightWorkflowActive,
  buildBlockMessage,
} = require(path.join(__dirname, 'completion-drive-write-guard.js'));

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

console.log('\n=== completion-drive-write-guard tests ===\n');

// --- shouldSkipPath: .crabshell/ paths should return true ---

test('shouldSkipPath: .crabshell/plan/P001.md → true', () => {
  assert.strictEqual(shouldSkipPath('.crabshell/plan/P001.md'), true);
});

test('shouldSkipPath: .crabshell/memory/memory.md → true', () => {
  assert.strictEqual(shouldSkipPath('.crabshell/memory/memory.md'), true);
});

test('shouldSkipPath: scripts/completion-drive-guard.js → false', () => {
  assert.strictEqual(shouldSkipPath('scripts/completion-drive-guard.js'), false);
});

test('shouldSkipPath: hooks/hooks.json → false', () => {
  assert.strictEqual(shouldSkipPath('hooks/hooks.json'), false);
});

test('shouldSkipPath: CLAUDE.md → false', () => {
  assert.strictEqual(shouldSkipPath('CLAUDE.md'), false);
});

test('shouldSkipPath: skills/regressing/SKILL.md → false', () => {
  assert.strictEqual(shouldSkipPath('skills/regressing/SKILL.md'), false);
});

// --- buildBlockMessage ---

test('buildBlockMessage includes "completion drive" text', () => {
  const result = buildBlockMessage('scripts/foo.js');
  assert.ok(result.reason.includes('completion drive'), `reason: ${result.reason}`);
});

test('buildBlockMessage includes the file path', () => {
  const result = buildBlockMessage('scripts/foo.js');
  assert.ok(result.reason.includes('scripts/foo.js'), `reason: ${result.reason}`);
});

test('buildBlockMessage returns decision: block', () => {
  const result = buildBlockMessage('scripts/foo.js');
  assert.strictEqual(result.decision, 'block');
});

// --- isRegressingActive: no state file → false ---

test('isRegressingActive returns false when no state file', () => {
  // Temporarily set project dir to a temp location with no regressing-state.json
  const original = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = require('os').tmpdir();
  const result = isRegressingActive();
  process.env.CLAUDE_PROJECT_DIR = original;
  assert.strictEqual(result, false);
});

// --- isLightWorkflowActive: no skill-active file → false ---

test('isLightWorkflowActive returns false when no skill-active file', () => {
  const original = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = require('os').tmpdir();
  const result = isLightWorkflowActive();
  process.env.CLAUDE_PROJECT_DIR = original;
  assert.strictEqual(result, false);
});

// --- Export check: all exported functions exist ---

test('Export check: all exported functions exist', () => {
  assert.strictEqual(typeof shouldSkipPath, 'function', 'shouldSkipPath must be a function');
  assert.strictEqual(typeof isRegressingActive, 'function', 'isRegressingActive must be a function');
  assert.strictEqual(typeof isLightWorkflowActive, 'function', 'isLightWorkflowActive must be a function');
  assert.strictEqual(typeof buildBlockMessage, 'function', 'buildBlockMessage must be a function');
});

// --- isRegressingActive: state file with active:true → returns true ---

test('isRegressingActive returns true when state file has active:true', () => {
  const os = require('os');
  const fs = require('fs');
  const tmpDir = require('path').join(os.tmpdir(), 'crabshell-test-regressing-' + Date.now());
  fs.mkdirSync(require('path').join(tmpDir, '.crabshell', 'memory'), { recursive: true });
  fs.writeFileSync(
    require('path').join(tmpDir, '.crabshell', 'memory', 'regressing-state.json'),
    JSON.stringify({ active: true })
  );
  const original = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  const result = isRegressingActive();
  process.env.CLAUDE_PROJECT_DIR = original;
  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  assert.strictEqual(result, true);
});

// --- isLightWorkflowActive: skill-active.json with valid TTL → returns true ---

test('isLightWorkflowActive returns true when skill-active.json has light-workflow with valid TTL', () => {
  const os = require('os');
  const fs = require('fs');
  const tmpDir = require('path').join(os.tmpdir(), 'crabshell-test-lightworkflow-' + Date.now());
  fs.mkdirSync(require('path').join(tmpDir, '.crabshell', 'memory'), { recursive: true });
  fs.writeFileSync(
    require('path').join(tmpDir, '.crabshell', 'memory', 'skill-active.json'),
    JSON.stringify({ skill: 'light-workflow', activatedAt: new Date().toISOString(), ttl: 900000 })
  );
  const original = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  const result = isLightWorkflowActive();
  process.env.CLAUDE_PROJECT_DIR = original;
  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  assert.strictEqual(result, true);
});

// --- isLightWorkflowActive: TTL expired → returns false ---

test('isLightWorkflowActive returns false when TTL expired', () => {
  const os = require('os');
  const fs = require('fs');
  const tmpDir = require('path').join(os.tmpdir(), 'crabshell-test-ttlexpired-' + Date.now());
  fs.mkdirSync(require('path').join(tmpDir, '.crabshell', 'memory'), { recursive: true });
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  fs.writeFileSync(
    require('path').join(tmpDir, '.crabshell', 'memory', 'skill-active.json'),
    JSON.stringify({ skill: 'light-workflow', activatedAt: oneHourAgo, ttl: 900000 })
  );
  const original = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  const result = isLightWorkflowActive();
  process.env.CLAUDE_PROJECT_DIR = original;
  // Cleanup (file may have been deleted by TTL cleanup in isLightWorkflowActive)
  fs.rmSync(tmpDir, { recursive: true, force: true });
  assert.strictEqual(result, false);
});

// --- Summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
