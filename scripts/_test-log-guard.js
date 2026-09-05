// Comprehensive log-guard.js test — Integration lens (WA3)
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const scriptPath = path.join(__dirname, 'log-guard.js');
const nodePath = process.execPath;
const projectDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'crabshell-log-guard-'));
for (const dir of ['ticket', 'discussion', 'plan', 'memory']) {
  fs.mkdirSync(path.join(projectDir, '.crabshell', dir), { recursive: true });
}

// --- Unit test imports (direct function testing) ---
const {
  extractStatusFromRow,
  extractIdFromRow,
  detectStatusChanges,
  detectStatusChangesWrite,
  isExemptTransition,
  findDocumentFile,
  parseLogEntries,
  isCreatedEntry,
  isStatusChangeEntry,
  validateLogForTerminal,
  validatePendingSections,
  checkRegressingCycleGuard,
  ALL_STATUSES,
  TERMINAL_STATUSES,
  MIN_ENTRY_BODY_LENGTH,
  INDEX_PATTERN,
  PLAN_DOC_PATTERN,
  TICKET_DOC_PATTERN,
} = require('./log-guard');

let passed = 0;
let failed = 0;

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

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label || ''} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- Integration test helper ---

function runScript(hookData) {
  const json = JSON.stringify(hookData);
  try {
    const result = execSync(
      `"${nodePath}" "${scriptPath}"`,
      {
        input: json,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
        timeout: 5000,
        encoding: 'utf8'
      }
    );
    return { exitCode: 0, stdout: result };
  } catch (e) {
    return { exitCode: e.status, stdout: e.stdout || '' };
  }
}

// --- Temp file helpers for integration tests ---

const tmpTicketDir = path.join(projectDir, '.crabshell', 'ticket');
const tmpDiscDir = path.join(projectDir, '.crabshell', 'discussion');
const tmpDocFile = path.join(tmpTicketDir, 'P999_T001-test-doc.md');
const tmpDiscFile = path.join(tmpDiscDir, 'D999-test-discussion.md');

// Save originals for restore
function createTempDoc(logContent) {
  const content = `# P999_T001 - Test Document

## Intent
Test document for log-guard tests.

## Log

${logContent}`;
  fs.writeFileSync(tmpDocFile, content, 'utf8');
}

function cleanupTempDoc() {
  try { fs.unlinkSync(tmpDocFile); } catch {}
}

function cleanupTempDisc() {
  try { fs.unlinkSync(tmpDiscFile); } catch {}
}

// ============================================================
// UNIT TESTS: extractStatusFromRow
// ============================================================

test('extractStatusFromRow: valid ticket row', () => {
  assertEqual(extractStatusFromRow('| P001_T001 | Some title | done | 2026-03-15 | P001 |'), 'done', 'status');
});

test('extractStatusFromRow: valid discussion row', () => {
  assertEqual(extractStatusFromRow('| D001 | Discussion title | concluded | 2026-03-15 | P001 |'), 'concluded', 'status');
});

test('extractStatusFromRow: status with extra spaces', () => {
  assertEqual(extractStatusFromRow('|  P001_T001  |  Title  |  in-progress  |  2026-03-15  |  P001  |'), 'in-progress', 'status');
});

test('extractStatusFromRow: invalid — not a table row', () => {
  assertEqual(extractStatusFromRow('Some random text'), null, 'status');
});

test('extractStatusFromRow: invalid — header separator', () => {
  assertEqual(extractStatusFromRow('|----|-------|--------|---------|------|'), null, 'status');
});

test('extractStatusFromRow: invalid — too few columns', () => {
  assertEqual(extractStatusFromRow('| P001 | Title |'), null, 'status');
});

test('extractStatusFromRow: null input', () => {
  assertEqual(extractStatusFromRow(null), null, 'status');
});

test('extractStatusFromRow: non-status in column 3', () => {
  assertEqual(extractStatusFromRow('| P001 | Title | 2026-03-15 | done |'), null, 'status');
});

// ============================================================
// UNIT TESTS: extractIdFromRow
// ============================================================

test('extractIdFromRow: ticket ID', () => {
  assertEqual(extractIdFromRow('| P001_T001 | Title | done | 2026 | P001 |'), 'P001_T001', 'id');
});

test('extractIdFromRow: discussion ID', () => {
  assertEqual(extractIdFromRow('| D052 | Title | open | 2026 | |'), 'D052', 'id');
});

test('extractIdFromRow: investigation ID', () => {
  assertEqual(extractIdFromRow('| I033 | Title | concluded | 2026 | |'), 'I033', 'id');
});

test('extractIdFromRow: plan ID', () => {
  assertEqual(extractIdFromRow('| P075 | Title | draft | 2026 | |'), 'P075', 'id');
});

test('extractIdFromRow: invalid ID format', () => {
  assertEqual(extractIdFromRow('| X999 | Title | done | 2026 |'), null, 'id');
});

// ============================================================
// UNIT TESTS: detectStatusChanges
// ============================================================

test('detectStatusChanges: single status change detected', () => {
  const old = '| P001_T001 | Title | todo | 2026-03-15 | P001 |';
  const nw = '| P001_T001 | Title | done | 2026-03-15 | P001 |';
  const result = detectStatusChanges(old, nw);
  assertEqual(result.length, 1, 'count');
  assertEqual(result[0].fromStatus, 'todo', 'from');
  assertEqual(result[0].toStatus, 'done', 'to');
  assertEqual(result[0].docId, 'P001_T001', 'docId');
});

test('detectStatusChanges: in-progress→verified detected', () => {
  const old = '| P073_T002 | Some work | in-progress | 2026-03-29 | P073 |';
  const nw = '| P073_T002 | Some work | verified | 2026-03-29 | P073 |';
  const result = detectStatusChanges(old, nw);
  assertEqual(result.length, 1, 'count');
  assertEqual(result[0].toStatus, 'verified', 'to');
});

test('EC-6: Non-status edit (title change) → no change detected', () => {
  const old = '| P001_T001 | Old Title | done | 2026-03-15 | P001 |';
  const nw = '| P001_T001 | New Title | done | 2026-03-15 | P001 |';
  const result = detectStatusChanges(old, nw);
  assertEqual(result.length, 0, 'should be empty');
});

test('EC-9: New row addition → no change detected', () => {
  const old = '| P001_T001 | Title | done | 2026-03-15 | P001 |';
  const nw = '| P001_T001 | Title | done | 2026-03-15 | P001 |\n| P001_T002 | New ticket | todo | 2026-03-16 | P001 |';
  const result = detectStatusChanges(old, nw);
  assertEqual(result.length, 0, 'should be empty — no existing row changed status');
});

test('detectStatusChanges: null inputs → empty array', () => {
  assertEqual(detectStatusChanges(null, null).length, 0, 'null,null');
  assertEqual(detectStatusChanges('', '').length, 0, 'empty,empty');
});

test('detectStatusChanges: multi-row with one status change', () => {
  const old = '| P001_T001 | Title A | done | 2026 | P001 |\n| P001_T002 | Title B | todo | 2026 | P001 |';
  const nw = '| P001_T001 | Title A | done | 2026 | P001 |\n| P001_T002 | Title B | in-progress | 2026 | P001 |';
  const result = detectStatusChanges(old, nw);
  assertEqual(result.length, 1, 'count');
  assertEqual(result[0].docId, 'P001_T002', 'docId');
  assertEqual(result[0].fromStatus, 'todo', 'from');
  assertEqual(result[0].toStatus, 'in-progress', 'to');
});

test('detectStatusChanges: batch edit with 2 status changes', () => {
  const old = '| P001_T001 | A | todo | 2026 | P001 |\n| P001_T002 | B | in-progress | 2026 | P001 |';
  const nw = '| P001_T001 | A | in-progress | 2026 | P001 |\n| P001_T002 | B | done | 2026 | P001 |';
  const result = detectStatusChanges(old, nw);
  assertEqual(result.length, 2, 'count');
});

// ============================================================
// UNIT TESTS: isExemptTransition
// ============================================================

test('Exempt: todo→in-progress', () => {
  assert(isExemptTransition('todo', 'in-progress'), 'should be exempt');
});

test('Exempt: draft→approved', () => {
  assert(isExemptTransition('draft', 'approved'), 'should be exempt');
});

test('Exempt: blocked→in-progress', () => {
  assert(isExemptTransition('blocked', 'in-progress'), 'should be exempt');
});

test('Exempt: any→abandoned', () => {
  assert(isExemptTransition('todo', 'abandoned'), 'should be exempt');
  assert(isExemptTransition('in-progress', 'abandoned'), 'should be exempt');
  assert(isExemptTransition('done', 'abandoned'), 'should be exempt');
});

test('Not exempt: in-progress→done', () => {
  assert(!isExemptTransition('in-progress', 'done'), 'should NOT be exempt');
});

test('Not exempt: done→verified', () => {
  assert(!isExemptTransition('done', 'verified'), 'should NOT be exempt');
});

test('Not exempt: open→concluded', () => {
  assert(!isExemptTransition('open', 'concluded'), 'should NOT be exempt');
});

// ============================================================
// UNIT TESTS: parseLogEntries + validateLogForTerminal
// ============================================================

test('parseLogEntries: document with work + created entries', () => {
  const content = `# Test

## Log

---
### [2026-03-29 10:00] Created
Initial creation of the document.

---
### [2026-03-29 11:00] Work Complete
Implemented feature X with full tests passing. All 6 acceptance criteria verified.

---
### [2026-03-29 12:00] Status Change: todo → done
`;
  const entries = parseLogEntries(content);
  assertEqual(entries.length, 3, 'total entries');
  assert(isCreatedEntry(entries[0]), 'first should be Created');
  assert(!isCreatedEntry(entries[1]), 'second should not be Created');
  assert(isStatusChangeEntry(entries[2]), 'third should be Status Change');
});

test('parseLogEntries: Discussion Log heading', () => {
  const content = `# Test

## Discussion Log

---
### [2026-03-29 10:00] Started
Discussion started with analysis of the problem space and constraints.

---
### [2026-03-29 11:00] Key Decision
Decided to use approach B after comparing three alternatives with evidence.
`;
  const entries = parseLogEntries(content);
  assertEqual(entries.length, 2, 'count');
});

test('parseLogEntries: no Log section → empty', () => {
  const content = `# Test

## Intent
Something.
`;
  const entries = parseLogEntries(content);
  assertEqual(entries.length, 0, 'count');
});

test('validateLogForTerminal: substantive work entries → valid', () => {
  const entries = [
    { type: 'Created', timestamp: '2026-03-29 10:00', body: 'Initial creation.', bodyLength: 17 },
    { type: 'Implementation complete', timestamp: '2026-03-29 11:00', body: 'Implemented feature X with full test coverage passing all criteria.', bodyLength: 66 },
  ];
  const result = validateLogForTerminal(entries, 'done', 'P001_T001');
  assert(result.valid, 'should be valid');
});

test('validateLogForTerminal: only Created entry → invalid', () => {
  const entries = [
    { type: 'Created', timestamp: '2026-03-29 10:00', body: 'Initial creation.', bodyLength: 17 },
  ];
  const result = validateLogForTerminal(entries, 'done', 'P001_T001');
  assert(!result.valid, 'should be invalid');
  assert(result.reason.includes('P001_T001'), 'reason should mention docId');
});

test('validateLogForTerminal: empty entries → invalid', () => {
  const result = validateLogForTerminal([], 'done', 'P001_T001');
  assert(!result.valid, 'should be invalid');
});

test('Bypass 1: short rubber-stamp entry → invalid', () => {
  const entries = [
    { type: 'Created', timestamp: '2026-03-29 10:00', body: 'Init.', bodyLength: 5 },
    { type: 'Done', timestamp: '2026-03-29 11:00', body: 'Done.', bodyLength: 5 },
  ];
  const result = validateLogForTerminal(entries, 'done', 'P001_T001');
  assert(!result.valid, `should be invalid (body < ${MIN_ENTRY_BODY_LENGTH})`);
});

// ============================================================
// INTEGRATION TESTS: full script execution
// ============================================================

test('Integration: Edit on non-INDEX.md file → allow', () => {
  const r = runScript({
    tool_name: 'Edit',
    tool_input: { file_path: '.crabshell/ticket/P001_T001-test.md', old_string: 'old', new_string: 'new' }
  });
  assertEqual(r.exitCode, 0, 'exitCode');
});

test('Integration: Edit on INDEX.md outside .crabshell/ → allow', () => {
  const r = runScript({
    tool_name: 'Edit',
    tool_input: { file_path: 'docs/INDEX.md', old_string: 'old', new_string: 'new' }
  });
  assertEqual(r.exitCode, 0, 'exitCode');
});

test('EC-6 Integration: non-status edit on INDEX.md → allow', () => {
  const r = runScript({
    tool_name: 'Edit',
    tool_input: {
      file_path: '.crabshell/ticket/INDEX.md',
      old_string: '| P001_T001 | Old Title | done | 2026-03-15 | P001 |',
      new_string: '| P001_T001 | New Title | done | 2026-03-15 | P001 |'
    }
  });
  assertEqual(r.exitCode, 0, 'exitCode');
});

test('EC-9 Integration: new row addition → allow', () => {
  const r = runScript({
    tool_name: 'Edit',
    tool_input: {
      file_path: '.crabshell/ticket/INDEX.md',
      old_string: '| P075_T002 | Multi-agent analytical lenses in SKILL.md | todo | 2026-03-29 | P075 |',
      new_string: '| P075_T002 | Multi-agent analytical lenses in SKILL.md | todo | 2026-03-29 | P075 |\n| P076_T001 | New ticket | todo | 2026-03-29 | P076 |'
    }
  });
  assertEqual(r.exitCode, 0, 'exitCode');
});

test('EC-1/Exempt Integration: todo→in-progress → allow (even without log)', () => {
  const r = runScript({
    tool_name: 'Edit',
    tool_input: {
      file_path: '.crabshell/ticket/INDEX.md',
      old_string: '| P075_T002 | Multi-agent analytical lenses in SKILL.md | todo | 2026-03-29 | P075 |',
      new_string: '| P075_T002 | Multi-agent analytical lenses in SKILL.md | in-progress | 2026-03-29 | P075 |'
    }
  });
  assertEqual(r.exitCode, 0, 'exitCode');
});

test('Exempt Integration: any→abandoned → allow', () => {
  const r = runScript({
    tool_name: 'Edit',
    tool_input: {
      file_path: '.crabshell/ticket/INDEX.md',
      old_string: '| P075_T002 | Multi-agent analytical lenses in SKILL.md | todo | 2026-03-29 | P075 |',
      new_string: '| P075_T002 | Multi-agent analytical lenses in SKILL.md | abandoned | 2026-03-29 | P075 |'
    }
  });
  assertEqual(r.exitCode, 0, 'exitCode');
});

test('Terminal transition: in-progress→done WITH substantive log → allow', () => {
  createTempDoc(`---
### [2026-03-29 10:00] Created
Test doc initial creation for guard testing.

---
### [2026-03-29 11:00] Implementation Complete
Implemented all acceptance criteria. Feature X works with full test coverage passing.
`);
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 0, 'exitCode');
  } finally {
    cleanupTempDoc();
  }
});

test('Terminal transition: in-progress→done WITHOUT log → BLOCK', () => {
  createTempDoc(`---
### [2026-03-29 10:00] Created
Test doc initial creation for guard testing.
`);
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 2, 'exitCode');
    assert(r.stdout.includes('"decision":"block"') || r.stdout.includes('"decision": "block"'), 'should have block decision');
  } finally {
    cleanupTempDoc();
  }
});

test('Terminal transition: done→verified WITHOUT work log → BLOCK', () => {
  createTempDoc(`---
### [2026-03-29 10:00] Created
Test doc initial creation for guard testing.
`);
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | verified | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 2, 'exitCode');
  } finally {
    cleanupTempDoc();
  }
});

test('Terminal transition: open→concluded for discussion WITHOUT work log → BLOCK', () => {
  fs.writeFileSync(tmpDiscFile, `# D999 - Test Discussion

## Discussion Log

---
### [2026-03-29 10:00] Created
Started the discussion about test topic.
`, 'utf8');
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/discussion/INDEX.md',
        old_string: '| D999 | Test Discussion | open | 2026-03-29 | |',
        new_string: '| D999 | Test Discussion | concluded | 2026-03-29 | |'
      }
    });
    assertEqual(r.exitCode, 2, 'exitCode');
  } finally {
    cleanupTempDisc();
  }
});

test('EC-7: Orphaned INDEX entry (no document file) → fail-open (allow)', () => {
  cleanupTempDoc();
  const r = runScript({
    tool_name: 'Edit',
    tool_input: {
      file_path: '.crabshell/ticket/INDEX.md',
      old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
      new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
    }
  });
  assertEqual(r.exitCode, 0, 'exitCode — fail-open when document file missing');
});

test('EC-10: No skill-active bypass — blocks regardless of skill state', () => {
  createTempDoc(`---
### [2026-03-29 10:00] Created
Test doc initial creation for guard testing.
`);
  const flagPath = path.join(projectDir, '.crabshell', 'memory', 'skill-active.json');
  let originalFlag = null;
  try { originalFlag = fs.readFileSync(flagPath, 'utf8'); } catch {}

  const flagDir = path.dirname(flagPath);
  if (!fs.existsSync(flagDir)) fs.mkdirSync(flagDir, { recursive: true });
  fs.writeFileSync(flagPath, JSON.stringify({
    skill: 'ticketing',
    activatedAt: new Date().toISOString(),
    ttl: 300000
  }), 'utf8');

  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 2, 'exitCode — skill-active should NOT bypass');
  } finally {
    cleanupTempDoc();
    if (originalFlag !== null) {
      fs.writeFileSync(flagPath, originalFlag, 'utf8');
    } else {
      try { fs.unlinkSync(flagPath); } catch {}
    }
  }
});

test('EC-4: Status Change entries do not count as work log', () => {
  createTempDoc(`---
### [2026-03-29 10:00] Created
Test doc initial creation for guard testing.

---
### [2026-03-29 11:00] Status Change: todo → in-progress
Status changed from todo to in-progress for work start.
`);
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 2, 'exitCode — Status Change entries should not count');
  } finally {
    cleanupTempDoc();
  }
});

test('Non-terminal transition: in-progress→blocked → allow (no log needed)', () => {
  createTempDoc(`---
### [2026-03-29 10:00] Created
Test doc initial creation for guard testing.
`);
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | blocked | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 0, 'exitCode');
  } finally {
    cleanupTempDoc();
  }
});

test('Integration: empty/malformed hook data → allow (fail-open)', () => {
  const r1 = runScript({});
  assertEqual(r1.exitCode, 0, 'exitCode empty');

  const r2 = runScript({ tool_name: 'Edit' });
  assertEqual(r2.exitCode, 0, 'exitCode no input');
});

test('Integration: Windows backslash path in file_path', () => {
  createTempDoc(`---
### [2026-03-29 10:00] Created
Test doc initial creation for guard testing.

---
### [2026-03-29 11:00] Work Complete
Implemented feature X with full test coverage passing all acceptance criteria.
`);
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell\\ticket\\INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 0, 'exitCode — backslash should be normalized');
  } finally {
    cleanupTempDoc();
  }
});

test('Integration: absolute path to INDEX.md', () => {
  const r = runScript({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(projectDir, '.crabshell', 'ticket', 'INDEX.md'),
      old_string: '| P075_T002 | Title | todo | 2026-03-29 | P075 |',
      new_string: '| P075_T002 | Title | in-progress | 2026-03-29 | P075 |'
    }
  });
  assertEqual(r.exitCode, 0, 'exitCode — exempt transition');
});

test('Integration: Read tool → allow (not Write|Edit)', () => {
  const r = runScript({ tool_name: 'Read', tool_input: { file_path: '.crabshell/ticket/INDEX.md' } });
  assertEqual(r.exitCode, 0, 'exitCode');
});

test('Integration: Write to non-INDEX.md file → allow (trigger 2 only for plan/ticket)', () => {
  const r = runScript({
    tool_name: 'Write',
    tool_input: { file_path: 'src/app.js', content: 'console.log("hello")' }
  });
  assertEqual(r.exitCode, 0, 'exitCode');
});

// ============================================================
// ADVERSARIAL TESTS (WA4): bypass resistance scenarios
// ============================================================

test('ADV-1: Bypass 1 — rubber-stamp "### [date] x" (empty body) → BLOCK', () => {
  // LLM writes minimal entry type with no body
  createTempDoc(`---
### [2026-03-29 10:00] Created
Init.

---
### [2026-03-29 11:00] x
`);
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 2, 'exitCode — empty body entry should be blocked');
  } finally {
    cleanupTempDoc();
  }
});

test('ADV-2: Bypass 1 — rubber-stamp short entry "done" → BLOCK', () => {
  createTempDoc(`---
### [2026-03-29 10:00] Created
Initial creation.

---
### [2026-03-29 11:00] Work Log
done
`);
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 2, 'exitCode — 4-char body should be blocked');
    assert(r.stdout.includes(String(MIN_ENTRY_BODY_LENGTH)), 'reason should mention char limit');
  } finally {
    cleanupTempDoc();
  }
});

test('ADV-3: Bypass 1 — exactly 30 chars body → BLOCK (need >30, not >=30)', () => {
  // Body is exactly 30 chars: "123456789012345678901234567890"
  createTempDoc(`---
### [2026-03-29 10:00] Created
Init.

---
### [2026-03-29 11:00] Work Log
123456789012345678901234567890
`);
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 2, 'exitCode — exactly 30 chars (not >30) should block');
  } finally {
    cleanupTempDoc();
  }
});

test('ADV-4: Bypass 1 — 31 chars body → ALLOW (just over threshold)', () => {
  createTempDoc(`---
### [2026-03-29 10:00] Created
Init.

---
### [2026-03-29 11:00] Work Log
1234567890123456789012345678901
`);
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 0, 'exitCode — 31 chars (>30) should allow');
  } finally {
    cleanupTempDoc();
  }
});

test('ADV-5: ADVERSARIAL — status change via row with extra whitespace still detected', () => {
  createTempDoc(`---
### [2026-03-29 10:00] Created
Created the document for guard testing.
`);
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '|  P999_T001  |  Test doc  |  in-progress  |  2026-03-29  |  P999  |',
        new_string: '|  P999_T001  |  Test doc  |  done  |  2026-03-29  |  P999  |'
      }
    });
    // Only Created entry → should block even with extra spaces in row
    assertEqual(r.exitCode, 2, 'exitCode — extra whitespace rows should still be parsed');
  } finally {
    cleanupTempDoc();
  }
});

test('ADV-6: ADVERSARIAL — batch: 2 terminal changes, one doc has log, one does not → BLOCK', () => {
  const tmpDoc2 = path.join(tmpTicketDir, 'P999_T002-test-doc2.md');
  // T001 has substantive log
  createTempDoc(`---
### [2026-03-29 10:00] Created
Initial creation for batch test document one.

---
### [2026-03-29 11:00] Work Log
Completed all acceptance criteria. Full implementation done with tests.
`);
  // T002 has only Created
  fs.writeFileSync(tmpDoc2, `# P999_T002 - Test Document 2

## Log

---
### [2026-03-29 10:00] Created
Created second document for batch test.
`, 'utf8');

  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Doc1 | in-progress | 2026 | P999 |\n| P999_T002 | Doc2 | in-progress | 2026 | P999 |',
        new_string: '| P999_T001 | Doc1 | done | 2026 | P999 |\n| P999_T002 | Doc2 | done | 2026 | P999 |'
      }
    });
    // T002 lacks work log → entire batch should block
    assertEqual(r.exitCode, 2, 'exitCode — batch should block if ANY doc lacks substantive log');
  } finally {
    cleanupTempDoc();
    try { fs.unlinkSync(tmpDoc2); } catch {}
  }
});

test('ADV-7: ADVERSARIAL — batch: 2 terminal + 1 exempt in same edit → only checks terminal', () => {
  const tmpDoc2 = path.join(tmpTicketDir, 'P999_T002-test-doc2.md');
  const tmpDoc3 = path.join(tmpTicketDir, 'P999_T003-test-doc3.md');

  // T001: has substantive log (terminal change done→verified)
  createTempDoc(`---
### [2026-03-29 10:00] Created
Initial creation for batch/exempt test document.

---
### [2026-03-29 11:00] Verification Complete
All tests pass. Verified against acceptance criteria with full evidence.
`);
  // T002: todo→in-progress (exempt, no log needed)
  fs.writeFileSync(tmpDoc2, `# P999_T002 - Test
## Log
---
### [2026-03-29 10:00] Created
Created.
`, 'utf8');
  // T003: has substantive log (terminal change in-progress→done)
  fs.writeFileSync(tmpDoc3, `# P999_T003 - Test
## Log
---
### [2026-03-29 10:00] Created
Created for the third batch test document.

---
### [2026-03-29 11:00] Work Complete
Feature implemented and acceptance criteria all met.
`, 'utf8');

  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Doc1 | done | 2026 | P999 |\n| P999_T002 | Doc2 | todo | 2026 | P999 |\n| P999_T003 | Doc3 | in-progress | 2026 | P999 |',
        new_string: '| P999_T001 | Doc1 | verified | 2026 | P999 |\n| P999_T002 | Doc2 | in-progress | 2026 | P999 |\n| P999_T003 | Doc3 | done | 2026 | P999 |'
      }
    });
    // T001: done→verified (terminal, has log) → OK
    // T002: todo→in-progress (exempt) → OK
    // T003: in-progress→done (terminal, has log) → OK
    assertEqual(r.exitCode, 0, 'exitCode — all terminal transitions have logs, exempt is exempt');
  } finally {
    cleanupTempDoc();
    try { fs.unlinkSync(tmpDoc2); } catch {}
    try { fs.unlinkSync(tmpDoc3); } catch {}
  }
});

test('ADV-8: ADVERSARIAL — Write tool on INDEX.md also triggers Trigger 1', () => {
  // Create a temp plan doc with only Created entry
  const planDir = path.join(projectDir, '.crabshell', 'plan');
  const tmpPlanDoc = path.join(planDir, 'P999-test-write-plan.md');
  fs.writeFileSync(tmpPlanDoc, `# P999 - Write Test Plan

## Log

---
### [2026-03-29 10:00] Created
Created plan for Write trigger testing purposes.
`, 'utf8');

  // Test Write detection at unit level (can't safely overwrite real INDEX.md)
  const tmpPlanIndex = path.join(planDir, 'INDEX_write_test.md');
  fs.writeFileSync(tmpPlanIndex, '| P999 | Write Test | approved | 2026 | | |', 'utf8');

  try {
    const changes = detectStatusChangesWrite(
      tmpPlanIndex.replace(/\\/g, '/'),
      '| P999 | Write Test | done | 2026 | | |'
    );
    assertEqual(changes.length, 1, 'Write should detect status change');
    assertEqual(changes[0].docId, 'P999');
    assertEqual(changes[0].fromStatus, 'approved');
    assertEqual(changes[0].toStatus, 'done');
  } finally {
    try { fs.unlinkSync(tmpPlanDoc); } catch {}
    try { fs.unlinkSync(tmpPlanIndex); } catch {}
  }
});

test('ADV-9: Unit — parseLogEntries body length excludes separator lines (---)', () => {
  // Verify that --- lines and blank lines are not counted in body length
  const content = `# Doc
## Log

---
### [2026-03-29 10:00] Work Log
---


---
short
---
`;
  const entries = parseLogEntries(content);
  assertEqual(entries.length, 1);
  // Body should only contain "short" (5 chars), not the --- or blank lines
  assertEqual(entries[0].body, 'short');
  assertEqual(entries[0].bodyLength, 5);
});

test('ADV-10: Unit — parseLogEntries with Log section followed by another ## section', () => {
  const content = `# Doc

## Log

---
### [2026-03-29 10:00] Created
Created the document for section boundary testing.

---
### [2026-03-29 11:00] Work Log
Implemented the feature with comprehensive testing coverage.

## Final Verification

Some verification content that should NOT be parsed as log entry.
### [2026-03-29 12:00] Fake Entry
This should not appear.
`;
  const entries = parseLogEntries(content);
  assertEqual(entries.length, 2, 'should only parse entries in Log section');
  assertEqual(entries[0].type, 'Created');
  assertEqual(entries[1].type, 'Work Log');
});

test('ADV-11: Unit — checkRegressingCycleGuard returns null when not regressing', () => {
  // Ensure function returns null (no block) for non-regressing context
  const result = checkRegressingCycleGuard(
    '.crabshell/plan/P999-test.md',
    projectDir
  );
  // No regressing state file or not active → should return null
  // (depends on actual state, but in test context this is fine)
  // The test verifies the function doesn't crash and returns null-ish
  assert(result === null || (result && !result.shouldBlock), 'should not block outside regressing');
});

test('ADV-12: Unit — validateLogForTerminal with only StatusChange entries → INVALID', () => {
  const entries = [
    { type: 'Created', timestamp: '2026-03-29 10:00', body: 'Init.', bodyLength: 5 },
    { type: 'Status Change: todo → in-progress', timestamp: '2026-03-29 11:00',
      body: 'Status transition happened automatically.', bodyLength: 41 },
    { type: 'Status Change: in-progress → done', timestamp: '2026-03-29 12:00',
      body: 'Marking as done after completion of work.', bodyLength: 41 },
  ];
  const result = validateLogForTerminal(entries, 'verified', 'P001_T001');
  assert(!result.valid, 'Status Change entries should not count — no real work logged');
});

test('ADV-13: Unit — multiple short non-Created entries, none > 30 chars → INVALID', () => {
  const entries = [
    { type: 'Created', timestamp: '2026-03-29', body: 'Init.', bodyLength: 5 },
    { type: 'Work Log', timestamp: '2026-03-29', body: 'started work', bodyLength: 12 },
    { type: 'Review', timestamp: '2026-03-29', body: 'looks good to me', bodyLength: 16 },
    { type: 'Done', timestamp: '2026-03-29', body: 'all done now', bodyLength: 12 },
  ];
  const result = validateLogForTerminal(entries, 'done', 'P001_T001');
  assert(!result.valid, 'multiple short entries should still fail');
  assert(result.reason.includes('3'), 'reason should mention count of work entries found');
});

test('ADV-14: Integration — Write to INDEX.md with no status changes → allow', () => {
  const r = runScript({
    tool_name: 'Write',
    tool_input: {
      file_path: '.crabshell/ticket/INDEX.md',
      content: '| P075_T002 | Same Title | todo | 2026-03-29 | P075 |'
    }
  });
  // Since we read the actual INDEX.md and compare, no status change should be found
  // (the content doesn't match any existing row's ID in the file format)
  assertEqual(r.exitCode, 0, 'exitCode — no status change in Write');
});

// ============================================================
// UNIT TESTS: validatePendingSections
// ============================================================

test('validatePendingSections: ticket with all pending sections → invalid', () => {
  const content = `# P001_T001 - Test Ticket

## Execution Results (Work Agent)
(pending)

## Verification Results (Review Agent)
(pending)

## Orchestrator Evaluation
(pending)

## Log

---
### [2026-03-29 10:00] Created
Created ticket.
`;
  const result = validatePendingSections(content, 'P001_T001');
  assert(!result.valid, 'should be invalid');
  assert(result.reason.includes('Execution Results'), 'reason should mention Execution Results');
  assert(result.reason.includes('Verification Results'), 'reason should mention Verification Results');
  assert(result.reason.includes('Orchestrator Evaluation'), 'reason should mention Orchestrator Evaluation');
});

test('validatePendingSections: ticket with only Execution Results pending → invalid', () => {
  const content = `# P001_T001 - Test Ticket

## Execution Results (Work Agent)
(pending)

## Verification Results (Review Agent)
All criteria verified. Tests pass.

## Orchestrator Evaluation
Approved. All good.

## Log

---
### [2026-03-29 10:00] Created
Created ticket.
`;
  const result = validatePendingSections(content, 'P001_T001');
  assert(!result.valid, 'should be invalid');
  assert(result.reason.includes('Execution Results'), 'reason should mention Execution Results');
  assert(!result.reason.includes('Verification Results'), 'reason should NOT mention Verification Results');
  assert(!result.reason.includes('Orchestrator Evaluation'), 'reason should NOT mention Orchestrator Evaluation');
});

test('validatePendingSections: ticket with actual content in all sections → valid', () => {
  const content = `# P001_T001 - Test Ticket

## Execution Results (Work Agent)
Implemented feature X. All acceptance criteria met.

## Verification Results (Review Agent)
Verified all criteria. Tests pass with full coverage.

## Orchestrator Evaluation
4-factor evaluation complete. PASS.

## Log

---
### [2026-03-29 10:00] Created
Created ticket.
`;
  const result = validatePendingSections(content, 'P001_T001');
  assert(result.valid, 'should be valid');
});

test('validatePendingSections: non-ticket (discussion) → skipped (valid)', () => {
  const content = `# D001 - Test Discussion

## Execution Results (Work Agent)
(pending)

## Log

---
### [2026-03-29 10:00] Created
Created.
`;
  const result = validatePendingSections(content, 'D001');
  assert(result.valid, 'should be valid — non-ticket documents are not checked');
});

test('validatePendingSections: non-ticket (plan) → skipped (valid)', () => {
  const content = `# P001 - Test Plan

## Execution Results (Work Agent)
(pending)
`;
  const result = validatePendingSections(content, 'P001');
  assert(result.valid, 'should be valid — plans are not checked');
});

test('validatePendingSections: null content → valid', () => {
  const result = validatePendingSections(null, 'P001_T001');
  assert(result.valid, 'should be valid for null content');
});

test('validatePendingSections: ticket without result sections at all → valid', () => {
  const content = `# P001_T001 - Test Ticket

## Intent
Some intent.

## Log

---
### [2026-03-29 10:00] Created
Created ticket.
`;
  const result = validatePendingSections(content, 'P001_T001');
  assert(result.valid, 'should be valid — no result sections means nothing to check');
});

// ============================================================
// INTEGRATION TESTS: pending section check
// ============================================================

test('Pending Integration: ticket with (pending) in Execution Results → BLOCK', () => {
  const content = `# P999_T001 - Test Document

## Intent
Test document for pending guard tests.

## Execution Results (Work Agent)
(pending)

## Verification Results (Review Agent)
All verified. Tests pass with full coverage and evidence.

## Orchestrator Evaluation
Approved after review.

## Log

---
### [2026-03-29 10:00] Created
Test doc initial creation for guard testing.

---
### [2026-03-29 11:00] Implementation Complete
Implemented all acceptance criteria. Feature X works with full test coverage passing.
`;
  fs.writeFileSync(tmpDocFile, content, 'utf8');
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 2, 'exitCode — should block due to pending Execution Results');
    assert(r.stdout.includes('"decision":"block"') || r.stdout.includes('"decision": "block"'), 'should have block decision');
    assert(r.stdout.includes('pending'), 'reason should mention pending');
  } finally {
    cleanupTempDoc();
  }
});

test('Pending Integration: ticket with actual content in all sections → ALLOW', () => {
  const content = `# P999_T001 - Test Document

## Intent
Test document for pending guard tests.

## Execution Results (Work Agent)
Implemented feature X. All acceptance criteria met with evidence.

## Verification Results (Review Agent)
Verified all criteria. Tests pass with full coverage. P/O/G table complete.

## Orchestrator Evaluation
4-factor evaluation: Correctness PASS, Completeness PASS, Methodology PASS, Quality PASS.

## Log

---
### [2026-03-29 10:00] Created
Test doc initial creation for guard testing.

---
### [2026-03-29 11:00] Implementation Complete
Implemented all acceptance criteria. Feature X works with full test coverage passing.
`;
  fs.writeFileSync(tmpDocFile, content, 'utf8');
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/ticket/INDEX.md',
        old_string: '| P999_T001 | Test doc | in-progress | 2026-03-29 | P999 |',
        new_string: '| P999_T001 | Test doc | done | 2026-03-29 | P999 |'
      }
    });
    assertEqual(r.exitCode, 0, 'exitCode — should allow (all sections filled)');
  } finally {
    cleanupTempDoc();
  }
});

test('Pending Integration: discussion with (pending) → NOT checked (allow)', () => {
  fs.writeFileSync(tmpDiscFile, `# D999 - Test Discussion

## Execution Results (Work Agent)
(pending)

## Discussion Log

---
### [2026-03-29 10:00] Started
Discussion started with analysis of the problem space and constraints.

---
### [2026-03-29 11:00] Key Decision
Decided to use approach B after comparing three alternatives with evidence.
`, 'utf8');
  try {
    const r = runScript({
      tool_name: 'Edit',
      tool_input: {
        file_path: '.crabshell/discussion/INDEX.md',
        old_string: '| D999 | Test Discussion | open | 2026-03-29 | |',
        new_string: '| D999 | Test Discussion | concluded | 2026-03-29 | |'
      }
    });
    assertEqual(r.exitCode, 0, 'exitCode — discussions are not subject to pending check');
  } finally {
    cleanupTempDisc();
  }
});

// ============================================================
// Summary
// ============================================================

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
}
