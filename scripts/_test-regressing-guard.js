'use strict';
// Test suite for regressing-guard.js — phase enforcement + IA-2 plan section check
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE = process.execPath;
const SCRIPT = path.join(__dirname, 'regressing-guard.js');

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
 * Run regressing-guard.js as a subprocess with given hookData and env overrides.
 * Returns the exit code (0 = allow, 2 = block).
 */
function runScript(hookData, envOverrides) {
  const input = JSON.stringify(hookData);
  const env = { ...process.env, ...envOverrides };
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
 * Create a temporary project directory with .crabshell/memory/regressing-state.json.
 * Returns { dir, cleanup }.
 */
function createTempProject(stateOverrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regressing-guard-test-'));
  const memDir = path.join(dir, '.crabshell', 'memory');
  fs.mkdirSync(memDir, { recursive: true });

  if (stateOverrides !== null) {
    const defaultState = {
      active: true,
      phase: 'planning',
      planId: null,
      ticketIds: [],
      lastUpdatedAt: new Date().toISOString()
    };
    const state = { ...defaultState, ...stateOverrides };
    fs.writeFileSync(
      path.join(memDir, 'regressing-state.json'),
      JSON.stringify(state, null, 2)
    );
  }

  const cleanup = () => { try { fs.rmSync(dir, { recursive: true }); } catch {} };
  return { dir, cleanup };
}

/**
 * Create a plan document inside the temp project's .crabshell/plan/ directory.
 * sections: object with keys 'analysisResults', 'reviewResults', 'intentCheck' → string content
 */
function createPlanDoc(projectDir, planId, sections) {
  const planDir = path.join(projectDir, '.crabshell', 'plan');
  fs.mkdirSync(planDir, { recursive: true });

  const analysisContent = (sections && sections.analysisResults) || '(Work Agent: write your analysis here BEFORE reporting to user)';
  const reviewContent = (sections && sections.reviewResults) || '(Review Agent: write your review here BEFORE reporting to user)';
  const intentContent = (sections && sections.intentCheck) || '(Orchestrator: write your intent check here BEFORE reporting to user)';

  const content = `# ${planId} - Test Plan

## Intent
Test plan intent.

## Scope
Included: everything
Excluded: nothing

## Plan
- [ ] Step 1: do something

## Agent Execution

### Step A: Work Agent — Analysis + Plan Writing

### Step B: Review Agent — Plan Quality Verification

### Step C: Orchestrator — Intent Check

## Tickets

## Analysis Results (Work Agent)
${analysisContent}

## Review Results (Review Agent)
${reviewContent}

## Intent Check (Orchestrator)
${intentContent}

## Verification Criteria
Observable behavior.

## Log

---
### [2026-04-05 12:00] Created
Initial plan.
`;

  const filePath = path.join(planDir, `${planId}-test-plan.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

/**
 * Build a Write hookData payload targeting a ticket file path.
 */
function ticketWriteHook(projectDir, ticketId) {
  const filePath = path.join(projectDir, '.crabshell', 'ticket', `${ticketId}-test.md`).replace(/\\/g, '/');
  return {
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: '# Ticket' }
  };
}

/**
 * Build a Write hookData payload targeting a plan file path.
 */
function planWriteHook(projectDir, planId) {
  const filePath = path.join(projectDir, '.crabshell', 'plan', `${planId}-test-plan.md`).replace(/\\/g, '/');
  return {
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: '# Plan' }
  };
}

// ============================================================
// TC1: No regressing state → exit 0 (passthrough)
// ============================================================

console.log('\n--- TC1: No regressing state → exit 0 (passthrough) ---');
unitTest('TC1: No regressing-state.json → allow (exit 0)', () => {
  const proj = createTempProject(null); // no state file
  try {
    const hookData = ticketWriteHook(proj.dir, 'P001_T001');
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { proj.cleanup(); }
});

// ============================================================
// TC2: Planning phase + plan doc write → exit 2 (existing behavior)
// ============================================================

console.log('\n--- TC2: Planning phase + plan doc write → exit 2 ---');
unitTest('TC2: Active regressing in "planning" phase + plan doc write → block (exit 2)', () => {
  const proj = createTempProject({ phase: 'planning', planId: null });
  try {
    const hookData = planWriteHook(proj.dir, 'P001');
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 2, `expected exit 2, got ${code}`);
  } finally { proj.cleanup(); }
});

// ============================================================
// TC3: Ticketing phase + ticket doc write → exit 2 (existing behavior: phase gate)
// ============================================================

console.log('\n--- TC3: Ticketing phase + ticket doc write (no planId) → exit 2 ---');
unitTest('TC3: Active regressing in "ticketing" phase + ticket doc write → block (exit 2, phase gate)', () => {
  // No planId set, so IA-2 check is skipped, but phase gate fires
  const proj = createTempProject({ phase: 'ticketing', planId: null });
  try {
    const hookData = ticketWriteHook(proj.dir, 'P001_T001');
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 2, `expected exit 2, got ${code}`);
  } finally { proj.cleanup(); }
});

// ============================================================
// TC4: Active regressing + ticket write + P doc with EMPTY sections → exit 2
// ============================================================

console.log('\n--- TC4: Active regressing + ticket write + P doc with empty sections → exit 2 ---');
unitTest('TC4: Regressing active + ticket write + empty plan sections → block (exit 2)', () => {
  const proj = createTempProject({ phase: 'execution', planId: 'P001', ticketIds: [] });
  try {
    // Create plan doc with empty (placeholder-only) sections
    createPlanDoc(proj.dir, 'P001', {
      analysisResults: '(Work Agent: write your analysis here BEFORE reporting to user)',
      reviewResults: '(Review Agent: write your review here BEFORE reporting to user)',
      intentCheck: '(Orchestrator: write your intent check here BEFORE reporting to user)'
    });
    const hookData = ticketWriteHook(proj.dir, 'P001_T001');
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 2, `expected exit 2, got ${code}`);
  } finally { proj.cleanup(); }
});

// ============================================================
// TC5: Active regressing + ticket write + P doc with POPULATED sections → exit 0
// ============================================================

console.log('\n--- TC5: Active regressing + ticket write + P doc with populated sections → exit 0 ---');
unitTest('TC5: Regressing active + ticket write + populated plan sections → allow (exit 0)', () => {
  const proj = createTempProject({ phase: 'execution', planId: 'P001', ticketIds: [] });
  try {
    // Create plan doc with real content in all sections
    createPlanDoc(proj.dir, 'P001', {
      analysisResults: 'Work Agent analyzed the codebase. Found 3 files to modify. No breaking changes.',
      reviewResults: 'Review Agent verified completeness. Plan addresses all intent points. No gaps found.',
      intentCheck: 'Intent confirmed. Plan aligns with D080 discussion. Approved.'
    });
    const hookData = ticketWriteHook(proj.dir, 'P001_T001');
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { proj.cleanup(); }
});

// ============================================================
// TC6: Active regressing + ticket write + P doc with placeholder text only → exit 2
// ============================================================

console.log('\n--- TC6: Active regressing + ticket write + P doc with old-style placeholder → exit 2 ---');
unitTest('TC6: Regressing active + ticket write + old-style "(Appended after agent execution)" → block (exit 2)', () => {
  const proj = createTempProject({ phase: 'execution', planId: 'P001', ticketIds: [] });
  try {
    // Create plan doc with old-style placeholder that should be treated as empty
    createPlanDoc(proj.dir, 'P001', {
      analysisResults: '(Appended after agent execution)',
      reviewResults: '(Appended after agent execution)',
      intentCheck: '(Appended after agent execution)'
    });
    const hookData = ticketWriteHook(proj.dir, 'P001_T001');
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 2, `expected exit 2, got ${code}`);
  } finally { proj.cleanup(); }
});

// ============================================================
// TC7: Active regressing + non-ticket write → exit 0
// ============================================================

console.log('\n--- TC7: Active regressing + non-ticket write → exit 0 ---');
unitTest('TC7: Regressing active + write to non-ticket file → allow (exit 0)', () => {
  const proj = createTempProject({ phase: 'execution', planId: 'P001', ticketIds: [] });
  try {
    // Writing a regular source file — not a plan or ticket doc
    const hookData = {
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(proj.dir, 'scripts', 'some-script.js').replace(/\\/g, '/'),
        content: 'console.log("hello");'
      }
    };
    const code = runScript(hookData, { CLAUDE_PROJECT_DIR: proj.dir });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { proj.cleanup(); }
});

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
if (failed > 0) {
  process.exit(1);
}
