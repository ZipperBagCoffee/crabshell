'use strict';
// Test suite for docs-guard.js — checkInvestigationConstraints + subprocess behavior
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE = 'C:/Program Files/nodejs/node.exe';
const SCRIPT = 'C:/Users/chulg/Documents/memory-keeper-plugin/scripts/docs-guard.js';
const projectDir = 'C:/Users/chulg/Documents/memory-keeper-plugin';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function unitTest(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

/**
 * Run docs-guard.js as a subprocess with given hookData and env overrides.
 * Returns the exit code (0 = allow, 2 = block).
 */
function runScript(hookData, envOverrides) {
  const input = JSON.stringify(hookData);
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, ...envOverrides };
  try {
    execSync(`"${NODE}" "${SCRIPT}"`, {
      input,
      timeout: 5000,
      encoding: 'utf8',
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return 0;
  } catch (e) {
    return e.status || 1;
  }
}

/**
 * Create a temporary project-like directory with .crabshell/memory/skill-active.json.
 * Returns { dir, flagPath, cleanup }.
 */
function createTempProject(skillName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-guard-test-'));
  const memDir = path.join(dir, '.crabshell', 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  const flagPath = path.join(memDir, 'skill-active.json');
  if (skillName) {
    fs.writeFileSync(flagPath, JSON.stringify({
      skill: skillName,
      activatedAt: new Date().toISOString(),
      ttl: 300000
    }));
  }
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true }); } catch {} };
  return { dir, flagPath, cleanup };
}

/**
 * Create a temp investigation file inside a temp project's .crabshell/investigation/ dir.
 * Returns { filePath, cleanup }.
 */
function createTempInvestigationFile(projectDir, content) {
  const invDir = path.join(projectDir, '.crabshell', 'investigation');
  fs.mkdirSync(invDir, { recursive: true });
  const filePath = path.join(invDir, 'I_test.md');
  fs.writeFileSync(filePath, content);
  return filePath;
}

// ============================================================
// SECTION 1: Subprocess tests
// ============================================================

console.log('\n--- Subprocess: TC1 — Edit I doc WITH ## Constraints + active skill → exit 0 ---');
unitTest('TC1: Edit I doc WITH ## Constraints + active skill → allow (exit 0)', () => {
  const proj = createTempProject('investigating');
  try {
    const filePath = createTempInvestigationFile(proj.dir, '# I001\n\n## Constraints\n- fail-open\n');
    const hookData = {
      tool_name: 'Edit',
      tool_input: { file_path: filePath }
    };
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { proj.cleanup(); }
});

console.log('\n--- Subprocess: TC2 — Edit I doc WITHOUT ## Constraints + active skill → exit 2 ---');
unitTest('TC2: Edit I doc WITHOUT ## Constraints + active skill → block (exit 2)', () => {
  const proj = createTempProject('investigating');
  try {
    const filePath = createTempInvestigationFile(proj.dir, '# I001\n\nNo constraints section here.\n');
    const hookData = {
      tool_name: 'Edit',
      tool_input: { file_path: filePath }
    };
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 2, `expected exit 2, got ${code}`);
  } finally { proj.cleanup(); }
});

console.log('\n--- Subprocess: TC3 — Write to NON-EXISTENT I doc + active skill → exit 0 (first creation) ---');
unitTest('TC3: Write to non-existent I doc + active skill → allow (exit 0)', () => {
  const proj = createTempProject('investigating');
  try {
    const invDir = path.join(proj.dir, '.crabshell', 'investigation');
    fs.mkdirSync(invDir, { recursive: true });
    const filePath = path.join(invDir, 'I_new_does_not_exist.md');
    // Ensure it does NOT exist
    try { fs.unlinkSync(filePath); } catch {}
    const hookData = {
      tool_name: 'Write',
      tool_input: { file_path: filePath }
    };
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { proj.cleanup(); }
});

console.log('\n--- Subprocess: TC4 — Write to EXISTING I doc WITHOUT ## Constraints + active skill → exit 2 ---');
unitTest('TC4: Write to existing I doc WITHOUT ## Constraints + active skill → block (exit 2)', () => {
  const proj = createTempProject('investigating');
  try {
    const filePath = createTempInvestigationFile(proj.dir, '# I001\n\nExisting file, no constraints.\n');
    const hookData = {
      tool_name: 'Write',
      tool_input: { file_path: filePath }
    };
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 2, `expected exit 2, got ${code}`);
  } finally { proj.cleanup(); }
});

console.log('\n--- Subprocess: TC5 — Edit plan/ doc (not investigation) + active skill → exit 0 ---');
unitTest('TC5: Edit plan/ doc (not investigation) + active skill → allow (exit 0)', () => {
  const proj = createTempProject('planning');
  try {
    const planDir = path.join(proj.dir, '.crabshell', 'plan');
    fs.mkdirSync(planDir, { recursive: true });
    const filePath = path.join(planDir, 'P001.md');
    fs.writeFileSync(filePath, '# P001\n\nNo constraints needed here.\n');
    const hookData = {
      tool_name: 'Edit',
      tool_input: { file_path: filePath }
    };
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { proj.cleanup(); }
});

console.log('\n--- Subprocess: TC5b — Edit investigation/INDEX.md + active skill → exit 0 (INDEX excluded) ---');
unitTest('TC5b: Edit investigation/INDEX.md + active skill → allow (exit 0)', () => {
  const proj = createTempProject('investigating');
  try {
    const invDir = path.join(proj.dir, '.crabshell', 'investigation');
    fs.mkdirSync(invDir, { recursive: true });
    const filePath = path.join(invDir, 'INDEX.md');
    fs.writeFileSync(filePath, '| ID | Topic | Status |\n| I001 | test | open |\n');
    const hookData = {
      tool_name: 'Edit',
      tool_input: { file_path: filePath }
    };
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { proj.cleanup(); }
});

console.log('\n--- Subprocess: TC6 — Edit I doc WITHOUT ## Constraints + NO active skill → exit 2 ---');
unitTest('TC6: Edit I doc WITHOUT ## Constraints + NO active skill → block (exit 2)', () => {
  const proj = createTempProject(null); // no skill flag
  try {
    const filePath = createTempInvestigationFile(proj.dir, '# I001\n\nNo constraints, no skill.\n');
    const hookData = {
      tool_name: 'Edit',
      tool_input: { file_path: filePath }
    };
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 2, `expected exit 2, got ${code}`);
  } finally { proj.cleanup(); }
});

// ============================================================
// SECTION 2: Unit tests — checkInvestigationConstraints
// ============================================================

const { checkInvestigationConstraints } = require('./docs-guard.js');

console.log('\n--- Unit: TC7 — checkInvestigationConstraints ---');

unitTest('TC7a: non-investigation path → null (skip)', () => {
  const result = checkInvestigationConstraints('/some/.crabshell/plan/P001.md', 'Edit');
  assert(result === null, `expected null, got ${result}`);
});

unitTest('TC7b: investigation path with ## Constraints → null (OK)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-test-'));
  try {
    const fp = path.join(tmp, 'I001.md');
    fs.writeFileSync(fp, '# Test\n\n## Constraints\n- foo\n');
    const result = checkInvestigationConstraints(fp.replace(/\\/g, '/') + '/../investigation/I001.md', 'Edit');
    // Test with actual path containing 'investigation/'
    const invDir = path.join(tmp, 'investigation');
    fs.mkdirSync(invDir, { recursive: true });
    const invFile = path.join(invDir, 'I001.md');
    fs.writeFileSync(invFile, '# Test\n\n## Constraints\n- foo\n');
    const r2 = checkInvestigationConstraints(invFile, 'Edit');
    assert(r2 === null, `expected null for file with Constraints, got ${r2}`);
  } finally { try { fs.rmSync(tmp, { recursive: true }); } catch {} }
});

unitTest('TC7c: investigation path WITHOUT ## Constraints → error string', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-test-'));
  try {
    const invDir = path.join(tmp, 'investigation');
    fs.mkdirSync(invDir, { recursive: true });
    const fp = path.join(invDir, 'I001.md');
    fs.writeFileSync(fp, '# Test\n\nNo constraints section.\n');
    const result = checkInvestigationConstraints(fp, 'Edit');
    assert(typeof result === 'string', `expected error string, got ${result}`);
    assert(result.includes('## Constraints'), `expected mention of ## Constraints in: ${result}`);
  } finally { try { fs.rmSync(tmp, { recursive: true }); } catch {} }
});

unitTest('TC7d: Write to non-existent investigation file → null (allow first creation)', () => {
  const fp = path.join(os.tmpdir(), 'investigation', 'I_nonexistent_xyz.md');
  // Ensure it doesn't exist
  try { fs.unlinkSync(fp); } catch {}
  const result = checkInvestigationConstraints(fp, 'Write');
  assert(result === null, `expected null for non-existent file, got ${result}`);
});

unitTest('TC7e: Write to existing investigation file WITHOUT ## Constraints → error string', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-test-'));
  try {
    const invDir = path.join(tmp, 'investigation');
    fs.mkdirSync(invDir, { recursive: true });
    const fp = path.join(invDir, 'I001.md');
    fs.writeFileSync(fp, '# Test\n\nNo constraints.\n');
    const result = checkInvestigationConstraints(fp, 'Write');
    assert(typeof result === 'string', `expected error string, got ${result}`);
  } finally { try { fs.rmSync(tmp, { recursive: true }); } catch {} }
});

unitTest('TC7f: investigation path (backslash) WITHOUT ## Constraints → error string', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-test-'));
  try {
    const invDir = path.join(tmp, 'investigation');
    fs.mkdirSync(invDir, { recursive: true });
    const fp = path.join(invDir, 'I001.md'); // path.join on Windows uses backslashes
    fs.writeFileSync(fp, '# Test\n\nNo constraints.\n');
    // Simulate Windows backslash path
    const backslashPath = fp.replace(/\//g, '\\');
    const result = checkInvestigationConstraints(backslashPath, 'Edit');
    assert(typeof result === 'string', `expected error string for backslash path, got ${result}`);
  } finally { try { fs.rmSync(tmp, { recursive: true }); } catch {} }
});

unitTest('TC7g: investigation/INDEX.md → null (skip, not an I-document)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-test-'));
  try {
    const invDir = path.join(tmp, 'investigation');
    fs.mkdirSync(invDir, { recursive: true });
    const fp = path.join(invDir, 'INDEX.md');
    fs.writeFileSync(fp, '| ID | Topic | Status |\n| I001 | test | open |\n');
    const result = checkInvestigationConstraints(fp, 'Edit');
    assert(result === null, `expected null for INDEX.md, got ${result}`);
  } finally { try { fs.rmSync(tmp, { recursive: true }); } catch {} }
});

unitTest('TC7h: unreadable file (non-existent) on Edit → null (fail-open)', () => {
  const fp = '/nonexistent/investigation/I001.md';
  const result = checkInvestigationConstraints(fp, 'Edit');
  assert(result === null, `expected null (fail-open) for unreadable file, got ${result}`);
});

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
if (failed > 0) {
  process.exit(1);
}
