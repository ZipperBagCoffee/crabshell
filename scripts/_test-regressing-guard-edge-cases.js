'use strict';
// RA-2 edge-case verification for regressing-guard.js (P104_T001)
// Tests: AC-6, AC-7, absent heading, new placeholder, null planId, fail-open
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

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

function runGuard(hookData, projectDir) {
  const input = JSON.stringify(hookData);
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  try {
    execSync(`"${NODE}" "${SCRIPT}"`, {
      input,
      timeout: 5000,
      encoding: 'utf8',
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { code: 0, stdout: '' };
  } catch (e) {
    return { code: e.status || 1, stdout: (e.stdout || '').trim() };
  }
}

function makeTempProject(state, planId, planContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra2-edge-'));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  if (state !== null) {
    fs.writeFileSync(
      path.join(dir, '.crabshell', 'memory', 'regressing-state.json'),
      JSON.stringify(state, null, 2)
    );
  }
  if (planId && planContent !== null) {
    fs.mkdirSync(path.join(dir, '.crabshell', 'plan'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.crabshell', 'plan', `${planId}-test.md`),
      planContent
    );
  }
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true }); } catch {} };
  return { dir, cleanup };
}

function ticketHook(projectDir, ticketId) {
  return {
    tool_name: 'Write',
    tool_input: {
      file_path: path.join(projectDir, '.crabshell', 'ticket', `${ticketId}-test.md`).replace(/\\/g, '/'),
      content: '# Ticket'
    }
  };
}

// ----------------------------------------------------------------
// AC-6: Allow ticket write when P doc sections ARE populated
// ----------------------------------------------------------------
console.log('\n--- AC-6: P doc sections populated → allow ---');
test('AC-6: all three sections populated → exit 0', () => {
  const { dir, cleanup } = makeTempProject(
    { active: true, phase: 'execution', planId: 'P001', ticketIds: [] },
    'P001',
    `# P001 - Test\n\n## Analysis Results (Work Agent)\nWA found 3 files. No breaking changes.\n\n## Review Results (Review Agent)\nRA verified completeness.\n\n## Intent Check (Orchestrator)\nIntent confirmed.\n`
  );
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    assert(r.code === 0, `expected exit 0, got ${r.code}. stdout: ${r.stdout}`);
  } finally { cleanup(); }
});

test('AC-6: only one section populated → exit 2 (partial empty still blocks)', () => {
  const { dir, cleanup } = makeTempProject(
    { active: true, phase: 'execution', planId: 'P001', ticketIds: [] },
    'P001',
    `# P001 - Test\n\n## Analysis Results (Work Agent)\nWA found 3 files.\n\n## Review Results (Review Agent)\n(Review Agent: write your review here BEFORE reporting to user)\n\n## Intent Check (Orchestrator)\n(Orchestrator: write your intent check here BEFORE reporting to user)\n`
  );
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    assert(r.code === 2, `expected exit 2, got ${r.code}. stdout: ${r.stdout}`);
  } finally { cleanup(); }
});

// ----------------------------------------------------------------
// AC-7: Allow ticket write when no regressing state active
// ----------------------------------------------------------------
console.log('\n--- AC-7: No regressing state → allow ---');
test('AC-7a: state.active = false → exit 0', () => {
  const { dir, cleanup } = makeTempProject(
    { active: false, phase: 'execution', planId: 'P001', ticketIds: [] },
    null, null
  );
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    assert(r.code === 0, `expected exit 0, got ${r.code}`);
  } finally { cleanup(); }
});

test('AC-7b: no regressing-state.json file → exit 0', () => {
  const { dir, cleanup } = makeTempProject(null, null, null);
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    assert(r.code === 0, `expected exit 0, got ${r.code}`);
  } finally { cleanup(); }
});

// ----------------------------------------------------------------
// Edge: Heading ABSENT (no ## Analysis Results at all)
// ----------------------------------------------------------------
console.log('\n--- Edge: heading absent → fail-open ---');
test('Absent heading: no section headings at all → exit 0 (fail-open)', () => {
  const { dir, cleanup } = makeTempProject(
    { active: true, phase: 'execution', planId: 'P001', ticketIds: [] },
    'P001',
    `# P001 - Test\n\n## Intent\nSome intent.\n\n## Plan\n- [ ] Step 1\n`
    // No ## Analysis Results, ## Review Results, ## Intent Check
  );
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    assert(r.code === 0, `expected exit 0 (fail-open for absent headings), got ${r.code}. stdout: ${r.stdout}`);
  } finally { cleanup(); }
});

test('Absent heading: only one section heading present (others absent) → exit 2 for present-empty, allow for absent', () => {
  // Analysis Results present but empty, Review Results and Intent Check absent
  const { dir, cleanup } = makeTempProject(
    { active: true, phase: 'execution', planId: 'P001', ticketIds: [] },
    'P001',
    `# P001 - Test\n\n## Analysis Results (Work Agent)\n(Work Agent: write your analysis here BEFORE reporting to user)\n\n## Verification Criteria\nSomething.\n`
    // Review Results and Intent Check headings absent
  );
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    // Analysis Results IS present and empty → should block
    assert(r.code === 2, `expected exit 2 (Analysis Results present+empty), got ${r.code}. stdout: ${r.stdout}`);
  } finally { cleanup(); }
});

// ----------------------------------------------------------------
// Edge: New actionable placeholder text
// ----------------------------------------------------------------
console.log('\n--- Edge: new actionable placeholder → block ---');
test('New WA placeholder "(Work Agent: write your analysis here BEFORE reporting to user)" → exit 2', () => {
  const { dir, cleanup } = makeTempProject(
    { active: true, phase: 'execution', planId: 'P001', ticketIds: [] },
    'P001',
    `# P001 - Test\n\n## Analysis Results (Work Agent)\n(Work Agent: write your analysis here BEFORE reporting to user)\n\n## Review Results (Review Agent)\n(Review Agent: write your review here BEFORE reporting to user)\n\n## Intent Check (Orchestrator)\n(Orchestrator: write your intent check here BEFORE reporting to user)\n`
  );
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    assert(r.code === 2, `expected exit 2 (placeholder = empty), got ${r.code}. stdout: ${r.stdout}`);
  } finally { cleanup(); }
});

test('Placeholder with trailing text beyond parens → not treated as empty → exit 0', () => {
  // "(Work Agent: write your analysis here BEFORE reporting to user) plus extra" — NOT pure parenthetical
  const { dir, cleanup } = makeTempProject(
    { active: true, phase: 'execution', planId: 'P001', ticketIds: [] },
    'P001',
    `# P001 - Test\n\n## Analysis Results (Work Agent)\n(Work Agent: write your analysis here BEFORE reporting to user) plus extra content\n\n## Review Results (Review Agent)\nActual review content here.\n\n## Intent Check (Orchestrator)\nActual intent check here.\n`
  );
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    // The body is NOT a pure parenthetical (has extra text) so it should be treated as populated
    assert(r.code === 0, `expected exit 0 (body has extra text beyond pure parens), got ${r.code}. stdout: ${r.stdout}`);
  } finally { cleanup(); }
});

// ----------------------------------------------------------------
// Edge: planId is null/undefined
// ----------------------------------------------------------------
console.log('\n--- Edge: null planId → skip IA-2 check ---');
test('state.planId = null → IA-2 skipped, exit 0 (no plan to validate)', () => {
  const { dir, cleanup } = makeTempProject(
    { active: true, phase: 'execution', planId: null, ticketIds: [] },
    null, null
  );
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    assert(r.code === 0, `expected exit 0 (planId null = IA-2 skipped), got ${r.code}`);
  } finally { cleanup(); }
});

test('state.planId undefined (key missing) → IA-2 skipped, exit 0', () => {
  const state = { active: true, phase: 'execution', ticketIds: [] };
  // No planId key at all
  const { dir, cleanup } = makeTempProject(state, null, null);
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    assert(r.code === 0, `expected exit 0 (planId undefined = IA-2 skipped), got ${r.code}`);
  } finally { cleanup(); }
});

// ----------------------------------------------------------------
// Edge: fail-open on all error paths
// ----------------------------------------------------------------
console.log('\n--- Edge: fail-open on error paths ---');
test('planId set but plan directory missing entirely → exit 0 (fail-open)', () => {
  // State says P001 but no .crabshell/plan/ directory created
  const { dir, cleanup } = makeTempProject(
    { active: true, phase: 'execution', planId: 'P001', ticketIds: [] },
    null, null  // no plan dir or file
  );
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    assert(r.code === 0, `expected exit 0 (plan dir missing = fail-open), got ${r.code}`);
  } finally { cleanup(); }
});

test('planId set, plan dir exists, but no matching plan file → exit 0 (fail-open)', () => {
  const { dir, cleanup } = makeTempProject(
    { active: true, phase: 'execution', planId: 'P001', ticketIds: [] },
    'P002',  // creates P002-test.md but state says P001
    `# P002 - Wrong plan\n\n## Analysis Results (Work Agent)\nContent here.\n`
  );
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    assert(r.code === 0, `expected exit 0 (no matching plan file = fail-open), got ${r.code}`);
  } finally { cleanup(); }
});

test('Malformed state JSON → exit 0 (fail-open)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra2-edge-'));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.crabshell', 'memory', 'regressing-state.json'),
    '{ this is not valid JSON }'
  );
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true }); } catch {} };
  try {
    const r = runGuard(ticketHook(dir, 'P001_T001'), dir);
    assert(r.code === 0, `expected exit 0 (malformed JSON = fail-open), got ${r.code}`);
  } finally { cleanup(); }
});

test('Non-ticket, non-plan file write → always exit 0 regardless of state', () => {
  const { dir, cleanup } = makeTempProject(
    { active: true, phase: 'execution', planId: 'P001', ticketIds: [] },
    null, null
  );
  try {
    const hook = {
      tool_name: 'Write',
      tool_input: { file_path: `${dir}/scripts/foo.js`, content: 'x' }
    };
    const r = runGuard(hook, dir);
    assert(r.code === 0, `expected exit 0, got ${r.code}`);
  } finally { cleanup(); }
});

// ----------------------------------------------------------------
// Summary
// ----------------------------------------------------------------
console.log(`\n=== RA-2 Edge Case Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
if (failed > 0) process.exit(1);
