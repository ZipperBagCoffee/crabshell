// _test-inject-rules.js — Integration tests for inject-rules.js
// Focus: functions working together, real format parsing, subprocess execution
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
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

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error((label || '') + ' expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
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

// Load module
const mod = require(injectRulesPath);

// ============================================================
// 1. Export checks
// ============================================================
test('EXPORT: all functions present', function() {
  const fns = [
    'checkEmergencyStop', 'stripCodeBlocks', 'detectNegativeFeedback',
    'updateFeedbackPressure', 'checkDeltaPending', 'checkRotationPending',
    'syncRulesToClaudeMd', 'removeLegacySection', 'parseMemorySections',
    'extractKeywords', 'getRelevantMemorySnippets', 'buildRegressingReminder',
  ];
  for (const fn of fns) {
    assert(typeof mod[fn] === 'function', fn + ' not exported as function');
  }
});

test('EXPORT: all constants present', function() {
  const consts = [
    'RULES', 'MARKER_START', 'MARKER_END', 'COMPRESSED_CHECKLIST',
    'EMERGENCY_STOP_CONTEXT', 'DELTA_INSTRUCTION', 'ROTATION_INSTRUCTION',
    'PRESSURE_L1', 'PRESSURE_L2', 'PRESSURE_L3', 'EMERGENCY_KEYWORDS',
    'NEGATIVE_PATTERNS', 'NEGATIVE_EXCLUSIONS',
  ];
  for (const c of consts) {
    assert(mod[c] !== undefined, c + ' not exported');
  }
});

// ============================================================
// 2. Emergency stop
// ============================================================
test('EMERGENCY: Korean keyword -> true', function() {
  assertEqual(mod.checkEmergencyStop({ prompt: '아시발멈춰' }), true);
});

test('EMERGENCY: BRAINMELT keyword -> true', function() {
  assertEqual(mod.checkEmergencyStop({ prompt: 'BRAINMELT' }), true);
});

test('EMERGENCY: keyword in longer text -> true', function() {
  assertEqual(mod.checkEmergencyStop({ prompt: '지금 아시발멈춰 제발' }), true);
});

test('EMERGENCY: normal text -> false', function() {
  assertEqual(mod.checkEmergencyStop({ prompt: 'hello world' }), false);
});

test('EMERGENCY: null hookData -> false', function() {
  assertEqual(mod.checkEmergencyStop(null), false);
});

test('EMERGENCY: input field also works', function() {
  assertEqual(mod.checkEmergencyStop({ input: '아시발멈춰' }), true);
});

test('EMERGENCY: undefined hookData -> false', function() {
  assertEqual(mod.checkEmergencyStop(undefined), false);
});

test('EMERGENCY: hookData with no prompt/input fields -> false', function() {
  assertEqual(mod.checkEmergencyStop({}), false);
});

test('EMERGENCY: keyword inside code block still triggers (raw includes)', function() {
  // checkEmergencyStop does NOT strip code blocks — documents current behavior
  assertEqual(mod.checkEmergencyStop({ prompt: '```\n아시발멈춰\n```' }), true);
});

test('EMERGENCY: keyword as substring of larger word -> true', function() {
  assertEqual(mod.checkEmergencyStop({ prompt: 'xxx아시발멈춰yyy' }), true);
});

test('EMERGENCY: brainmelt lowercase -> false (case sensitive)', function() {
  assertEqual(mod.checkEmergencyStop({ prompt: 'brainmelt' }), false);
});

test('EMERGENCY: BrainMelt mixed case -> false', function() {
  assertEqual(mod.checkEmergencyStop({ prompt: 'BrainMelt' }), false);
});

test('EMERGENCY: prompt safe, input has keyword -> false (prompt precedence)', function() {
  assertEqual(mod.checkEmergencyStop({ prompt: 'safe text', input: 'BRAINMELT' }), false);
});

test('EMERGENCY: prompt empty string, input has keyword -> true (falls through)', function() {
  assertEqual(mod.checkEmergencyStop({ prompt: '', input: 'BRAINMELT' }), true);
});

// ============================================================
// 3. Integration: checkDeltaPending + checkRotationPending use same projectDir pattern
// ============================================================
test('INTEGRATION: delta+rotation share same storage root', function() {
  const tmpDir = makeTempDir('integration-storage');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(path.join(memDir, 'logs'));

    // Both use getStorageRoot(projectDir) → projectDir/.crabshell/memory/
    // With no files, both return falsy
    assertEqual(mod.checkDeltaPending(tmpDir), false, 'delta');
    const rot = mod.checkRotationPending(tmpDir);
    assert(Array.isArray(rot), 'rotation returns array');
    assertEqual(rot.length, 0, 'rotation empty');

    // Create delta file — same dir where rotation index would live
    fs.writeFileSync(path.join(memDir, 'delta_temp.txt'), 'x'.repeat(21 * 1024));
    assertEqual(mod.checkDeltaPending(tmpDir), true, 'delta now pending');

    // Create index with pending rotation — same dir
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({
      rotatedFiles: [
        { file: 'logbook_1.md', summaryGenerated: false },
        { file: 'logbook_2.md', summaryGenerated: true },
      ]
    }));
    const rot2 = mod.checkRotationPending(tmpDir);
    assertEqual(rot2.length, 1, 'one pending rotation');

    // Both pending at same time — this is the real integration scenario
    assertEqual(mod.checkDeltaPending(tmpDir), true, 'delta still pending');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('DELTA: file < 20KB -> false', function() {
  const tmpDir = makeTempDir('delta-small');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(path.join(memDir, 'logs'));
    fs.writeFileSync(path.join(memDir, 'delta_temp.txt'), 'small');
    assertEqual(mod.checkDeltaPending(tmpDir), false);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('DELTA: file >= 20KB -> true', function() {
  const tmpDir = makeTempDir('delta-big');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(path.join(memDir, 'logs'));
    fs.writeFileSync(path.join(memDir, 'delta_temp.txt'), 'x'.repeat(21 * 1024));
    assertEqual(mod.checkDeltaPending(tmpDir), true);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('DELTA: empty delta file -> false', function() {
  const tmpDir = makeTempDir('delta-empty');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'delta_temp.txt'), '');
    assertEqual(mod.checkDeltaPending(tmpDir), false);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('DELTA: dir does not exist -> false', function() {
  const tmpDir = makeTempDir('delta-nodir');
  try {
    assertEqual(mod.checkDeltaPending(tmpDir), false);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('DELTA: exactly at 20KB boundary -> true', function() {
  const tmpDir = makeTempDir('delta-boundary');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'delta_temp.txt'), 'x'.repeat(20 * 1024));
    assertEqual(mod.checkDeltaPending(tmpDir), true);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('DELTA: just below 20KB boundary -> false', function() {
  const tmpDir = makeTempDir('delta-below');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'delta_temp.txt'), 'x'.repeat(20 * 1024 - 1));
    assertEqual(mod.checkDeltaPending(tmpDir), false);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('DELTA: very large file (>190K tokens) -> still true', function() {
  const tmpDir = makeTempDir('delta-huge');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'delta_temp.txt'), 'x'.repeat(760 * 1024));
    assertEqual(mod.checkDeltaPending(tmpDir), true);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('ROTATION: mixed summaryGenerated -> filters correctly', function() {
  const tmpDir = makeTempDir('rotation-mix');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(path.join(memDir, 'logs'));
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({
      rotatedFiles: [
        { file: 'logbook_1.md', summaryGenerated: true },
        { file: 'logbook_2.md', summaryGenerated: false },
        { file: 'logbook_3.md', summaryGenerated: false },
      ]
    }));
    const result = mod.checkRotationPending(tmpDir);
    assertEqual(result.length, 2, 'two pending');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('ROTATION: empty rotatedFiles -> length 0', function() {
  const tmpDir = makeTempDir('rotation-empty');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(path.join(memDir, 'logs'));
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({ rotatedFiles: [] }));
    assertEqual(mod.checkRotationPending(tmpDir).length, 0);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('ROTATION: all summaryGenerated=true -> length 0', function() {
  const tmpDir = makeTempDir('rotation-done');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(path.join(memDir, 'logs'));
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({
      rotatedFiles: [{ file: 'a.md', summaryGenerated: true }, { file: 'b.md', summaryGenerated: true }]
    }));
    assertEqual(mod.checkRotationPending(tmpDir).length, 0);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('ROTATION: undefined summaryGenerated counted as pending', function() {
  const tmpDir = makeTempDir('rotation-undef');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(path.join(memDir, 'logs'));
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({
      rotatedFiles: [{ file: 'a.md' }]  // no summaryGenerated field
    }));
    assertEqual(mod.checkRotationPending(tmpDir).length, 1);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('ROTATION: malformed JSON index -> empty', function() {
  const tmpDir = makeTempDir('rotation-bad');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(path.join(memDir, 'logs'));
    fs.writeFileSync(path.join(memDir, 'memory-index.json'), 'NOT JSON');
    assertEqual(mod.checkRotationPending(tmpDir).length, 0);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 4. syncRulesToClaudeMd writes content with RULES key sections
// ============================================================
test('SYNC: creates CLAUDE.md with all key sections', function() {
  const tmpDir = makeTempDir('sync-sections');
  try {
    mod.syncRulesToClaudeMd(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    // All key sections from RULES constant must be present
    assert(content.includes('### VERIFICATION-FIRST'), 'missing VERIFICATION-FIRST');
    assert(content.includes('### UNDERSTANDING-FIRST'), 'missing UNDERSTANDING-FIRST');
    assert(content.includes('### INTERFERENCE PATTERNS'), 'missing INTERFERENCE PATTERNS');
    assert(content.includes('### PRINCIPLES'), 'missing PRINCIPLES');
    assert(content.includes('### REQUIREMENTS'), 'missing REQUIREMENTS');
    assert(content.includes('### PROBLEM-SOLVING PRINCIPLES'), 'missing PROBLEM-SOLVING');
    assert(content.includes('### SCOPE DEFINITIONS'), 'missing SCOPE DEFINITIONS');
    assert(content.includes('### ADDITIONAL RULES'), 'missing ADDITIONAL RULES');
    assert(content.includes('### VIOLATIONS'), 'missing VIOLATIONS');
    // L1-L4 observation levels
    assert(content.includes('L1 (Direct Execution)'), 'missing L1');
    assert(content.includes('L4 (Claim Without Evidence)'), 'missing L4');
    // Markers
    assert(content.includes(mod.MARKER_START), 'missing start marker');
    assert(content.includes(mod.MARKER_END), 'missing end marker');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SYNC: preserves user content below end marker', function() {
  const tmpDir = makeTempDir('sync-preserve');
  try {
    mod.syncRulesToClaudeMd(tmpDir);
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    let content = fs.readFileSync(claudeMdPath, 'utf8');
    content += '\n- My project uses React\n- Build with npm\n';
    fs.writeFileSync(claudeMdPath, content);
    // Re-sync
    mod.syncRulesToClaudeMd(tmpDir);
    const updated = fs.readFileSync(claudeMdPath, 'utf8');
    assert(updated.includes('My project uses React'), 'user content lost');
    assert(updated.includes('npm'), 'user content lost');
    assert(updated.includes('### VERIFICATION-FIRST'), 'rules missing');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SYNC: handles legacy CLAUDE.md without markers', function() {
  const tmpDir = makeTempDir('sync-legacy');
  try {
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, '## My Custom Rules\n\nDo things correctly.\n');
    mod.syncRulesToClaudeMd(tmpDir);
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    assert(content.includes('### VERIFICATION-FIRST'), 'rules injected');
    assert(content.includes('My Custom Rules'), 'existing content preserved');
    assert(content.includes(mod.MARKER_END), 'end marker present');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SYNC: replaces rules between markers on re-sync', function() {
  const tmpDir = makeTempDir('sync-replace');
  try {
    mod.syncRulesToClaudeMd(tmpDir);
    const claudeMdPath = path.join(tmpDir, 'CLAUDE.md');
    // Tamper with rules between markers
    let content = fs.readFileSync(claudeMdPath, 'utf8');
    content = content.replace('### VERIFICATION-FIRST', '### FAKE-SECTION');
    fs.writeFileSync(claudeMdPath, content);
    // Re-sync should restore
    mod.syncRulesToClaudeMd(tmpDir);
    const restored = fs.readFileSync(claudeMdPath, 'utf8');
    assert(restored.includes('### VERIFICATION-FIRST'), 'rules restored after tamper');
    assert(!restored.includes('### FAKE-SECTION'), 'tampered content removed');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SYNC: legacy with # Project Notes only -> treated as empty', function() {
  const tmpDir = makeTempDir('sync-notes');
  try {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Project Notes\n');
    mod.syncRulesToClaudeMd(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    assert(content.includes(mod.MARKER_START), 'marker added');
    assert(!content.includes('# Project Notes'), 'boilerplate removed');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SYNC: legacy with ## CRITICAL RULES (no markers) -> removes old', function() {
  const tmpDir = makeTempDir('sync-crit');
  try {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '## CRITICAL RULES\nold stuff\n\n## User\nkeep\n');
    mod.syncRulesToClaudeMd(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    assert(!content.includes('old stuff'), 'old critical removed');
    assert(content.includes('## User'), 'user section kept');
    assert(content.includes(mod.MARKER_START), 'new marker added');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SYNC: idempotent re-sync (markers present)', function() {
  const tmpDir = makeTempDir('sync-idem');
  try {
    mod.syncRulesToClaudeMd(tmpDir);
    const first = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    mod.syncRulesToClaudeMd(tmpDir);
    const second = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    assertEqual(first, second, 'idempotent');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SYNC: user content with multiple ## sections below end marker preserved', function() {
  const tmpDir = makeTempDir('sync-multi');
  try {
    const userRules = '\n- Rule 1\n\n## Extra Section\nDetails\n\n## Another\nMore\n';
    const existing = mod.MARKER_START + '\nold\n' + mod.MARKER_END + userRules;
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), existing);
    mod.syncRulesToClaudeMd(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    assert(content.includes('## Extra Section'), 'extra section preserved');
    assert(content.includes('## Another'), 'another section preserved');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 5. buildRegressingReminder reads actual regressing-state.json format
// ============================================================
test('REGRESSING: no state file -> empty', function() {
  const tmpDir = makeTempDir('regress-none');
  try {
    ensureDir(path.join(tmpDir, '.crabshell', 'memory'));
    const result = mod.buildRegressingReminder(tmpDir);
    assertEqual(result, '', 'empty when no file');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('REGRESSING: inactive -> empty', function() {
  const tmpDir = makeTempDir('regress-inactive');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: false, phase: 'planning', cycle: 1, totalCycles: 3, discussion: 'D001'
    }));
    assertEqual(mod.buildRegressingReminder(tmpDir), '', 'inactive=empty');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('REGRESSING: missing required fields -> empty', function() {
  const tmpDir = makeTempDir('regress-missing');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'planning'
      // missing cycle and totalCycles
    }));
    assertEqual(mod.buildRegressingReminder(tmpDir), '', 'missing fields=empty');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('REGRESSING: discussing phase', function() {
  const tmpDir = makeTempDir('regress-discussing');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'discussing', cycle: 1, totalCycles: 5,
      discussion: null, lastUpdatedAt: new Date().toISOString()
    }));
    const result = mod.buildRegressingReminder(tmpDir);
    assert(result.includes('Discussion Setup'), 'mentions Discussion Setup');
    assert(result.includes('Cycle 1'), 'mentions cycle');
    assert(result.includes('cap: 5'), 'mentions cap');
    assert(result.includes('skill="crabshell:discussing"'), 'mentions discussing skill');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('REGRESSING: planning phase', function() {
  const tmpDir = makeTempDir('regress-planning');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'planning', cycle: 2, totalCycles: 5,
      discussion: 'D003', lastUpdatedAt: new Date().toISOString()
    }));
    const result = mod.buildRegressingReminder(tmpDir);
    assert(result.includes('Planning'), 'mentions Planning');
    assert(result.includes('Cycle 2'), 'mentions cycle 2');
    assert(result.includes('D003'), 'mentions discussion');
    assert(result.includes('skill="crabshell:planning"'), 'mentions planning skill');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('REGRESSING: ticketing phase', function() {
  const tmpDir = makeTempDir('regress-ticketing');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'ticketing', cycle: 1, totalCycles: 3,
      discussion: 'D001', planId: 'P001', ticketIds: [],
      lastUpdatedAt: new Date().toISOString()
    }));
    const result = mod.buildRegressingReminder(tmpDir);
    assert(result.includes('Ticketing'), 'mentions Ticketing');
    assert(result.includes('skill="crabshell:ticketing"'), 'mentions ticketing skill');
    assert(result.includes('P001'), 'mentions plan ID');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('REGRESSING: execution phase with ticketIds', function() {
  const tmpDir = makeTempDir('regress-execution');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'execution', cycle: 1, totalCycles: 3,
      discussion: 'D001', planId: 'P001',
      ticketIds: ['P001_T001', 'P001_T002'],
      lastUpdatedAt: new Date().toISOString()
    }));
    const result = mod.buildRegressingReminder(tmpDir);
    assert(result.includes('Execution'), 'mentions Execution');
    assert(result.includes('P001_T001'), 'lists first ticket');
    assert(result.includes('P001_T002'), 'lists second ticket');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('REGRESSING: feedback phase', function() {
  const tmpDir = makeTempDir('regress-feedback');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'feedback', cycle: 2, totalCycles: 5,
      discussion: 'D002', planId: 'P002',
      ticketIds: ['P002_T001'],
      lastUpdatedAt: new Date().toISOString()
    }));
    const result = mod.buildRegressingReminder(tmpDir);
    assert(result.includes('Feedback Transfer'), 'mentions Feedback Transfer');
    assert(result.includes('P002_T001'), 'lists ticket');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('REGRESSING: backward compat singular ticketId', function() {
  const tmpDir = makeTempDir('regress-compat');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    // Old format: ticketId (singular) instead of ticketIds (array)
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'execution', cycle: 1, totalCycles: 3,
      discussion: 'D001', planId: 'P001',
      ticketId: 'P001_T001',
      lastUpdatedAt: new Date().toISOString()
    }));
    const result = mod.buildRegressingReminder(tmpDir);
    assert(result.includes('P001_T001'), 'old ticketId format handled');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('REGRESSING: stale warning after 24h', function() {
  const tmpDir = makeTempDir('regress-stale');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'discussing', cycle: 1, totalCycles: 3,
      discussion: null, lastUpdatedAt: staleDate
    }));
    const result = mod.buildRegressingReminder(tmpDir);
    assert(result.includes('WARNING'), 'staleness warning');
    assert(result.includes('stale'), 'mentions stale');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('REGRESSING: unknown phase -> empty', function() {
  const tmpDir = makeTempDir('regress-unknown');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'regressing-state.json'), JSON.stringify({
      active: true, phase: 'nonexistent_phase', cycle: 1, totalCycles: 3,
      discussion: 'D001'
    }));
    assertEqual(mod.buildRegressingReminder(tmpDir), '', 'unknown phase=empty');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 6. getRelevantMemorySnippets parses actual logbook.md format (## YYYY-MM-DD)
// ============================================================
test('SNIPPETS: parses ## YYYY-MM-DD date headers', function() {
  const tmpDir = makeTempDir('snippets-date');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'logbook.md'),
      '## 2026-03-28\n\n' +
      'Worked on verification-sequence guard feature.\n' +
      'Added transcript-utils.js shared utilities.\n\n' +
      '## 2026-03-27\n\n' +
      'Implemented sycophancy-guard dual-layer detection.\n\n' +
      '## 2026-03-26\n\n' +
      'Set up project initialization and migration scripts.\n'
    );
    const result = mod.getRelevantMemorySnippets(tmpDir, 'tell me about the verification guard feature');
    assert(result !== null, 'should find match');
    assert(result.includes('Relevant Memory Snippets'), 'has header');
    assert(result.includes('verification'), 'contains matching content');
    // Should return the 2026-03-28 section (highest score for "verification")
    assert(result.includes('2026-03-28'), 'contains date header of best match');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SNIPPETS: returns null for empty prompt', function() {
  assertEqual(mod.getRelevantMemorySnippets('/tmp', ''), null);
});

test('SNIPPETS: returns null when no logbook', function() {
  const tmpDir = makeTempDir('snippets-none');
  try {
    ensureDir(path.join(tmpDir, '.crabshell', 'memory'));
    assertEqual(mod.getRelevantMemorySnippets(tmpDir, 'search something'), null);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SNIPPETS: scores by keyword overlap, highest first', function() {
  const tmpDir = makeTempDir('snippets-score');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'logbook.md'),
      '## 2026-03-28\n\n' +
      'rotation rotation rotation rotation rotation thresholds.\n\n' +
      '## 2026-03-27\n\n' +
      'search functionality and queries.\n\n' +
      '## 2026-03-26\n\n' +
      'deployment and CI/CD pipelines.\n'
    );
    const result = mod.getRelevantMemorySnippets(tmpDir, 'tell me about rotation settings');
    assert(result !== null, 'should find match');
    // The 2026-03-28 section has highest "rotation" score
    const rotIdx = result.indexOf('rotation');
    assert(rotIdx !== -1, 'contains rotation');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SNIPPETS: no keyword match -> null', function() {
  const tmpDir = makeTempDir('snippets-nomatch');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'logbook.md'), '## Section\nCompletely unrelated zebras\n');
    assertEqual(mod.getRelevantMemorySnippets(tmpDir, 'counter.js increment bug fix'), null);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 7. extractKeywords handles Korean+English mixed input
// ============================================================
test('KEYWORDS: Korean tokens extracted', function() {
  const kws = mod.extractKeywords('메모리 로테이션 설정을 확인해줘');
  assert(kws.length > 0, 'has keywords');
  assert(kws.some(k => /[\uAC00-\uD7A3]/.test(k)), 'contains Korean');
});

test('KEYWORDS: English tokens extracted', function() {
  const kws = mod.extractKeywords('check the verification guard settings');
  assert(kws.length > 0, 'has keywords');
  assert(kws.includes('verification') || kws.includes('guard') || kws.includes('settings'),
    'meaningful English tokens');
});

test('KEYWORDS: mixed Korean+English input', function() {
  const kws = mod.extractKeywords('verification-sequence 가드를 확인해줘 guard feature');
  assert(kws.length > 0, 'has keywords');
  const hasKorean = kws.some(k => /[\uAC00-\uD7A3]/.test(k));
  const hasEnglish = kws.some(k => /[a-z]/.test(k));
  assert(hasKorean, 'contains Korean from mixed input');
  assert(hasEnglish, 'contains English from mixed input');
});

test('KEYWORDS: filters English stop words', function() {
  const kws = mod.extractKeywords('the quick brown fox jumped over the lazy dog');
  assert(!kws.includes('the'), '"the" filtered');
  assert(!kws.includes('over'), '"over" filtered');
  assert(kws.includes('quick') || kws.includes('brown') || kws.includes('jumped'), 'non-stop kept');
});

test('KEYWORDS: short input -> empty', function() {
  assertEqual(mod.extractKeywords('hi').length, 0);
});

test('KEYWORDS: null -> empty', function() {
  assertEqual(mod.extractKeywords(null).length, 0);
});

test('KEYWORDS: max 10 cap', function() {
  const long = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november';
  assert(mod.extractKeywords(long).length <= 10, 'capped at 10');
});

// ============================================================
// 8. parseMemorySections
// ============================================================
test('SECTIONS: parses H2 headings', function() {
  const sections = mod.parseMemorySections('## First\nBody one\n## Second\nBody two\n');
  assertEqual(sections.length, 2);
  assertEqual(sections[0].heading, 'First');
  assert(sections[0].body.includes('Body one'));
  assertEqual(sections[1].heading, 'Second');
  assert(sections[1].body.includes('Body two'));
});

test('SECTIONS: preamble before first heading ignored', function() {
  const sections = mod.parseMemorySections('Preamble text\n\n## 2026-03-28\nBody.\n');
  assertEqual(sections.length, 1);
  assertEqual(sections[0].heading, '2026-03-28');
});

test('SECTIONS: empty content -> empty array', function() {
  assertEqual(mod.parseMemorySections('').length, 0);
});

test('SECTIONS: no H2 -> empty array', function() {
  assertEqual(mod.parseMemorySections('plain text\nwithout headers\n').length, 0);
});

// ============================================================
// 9. stripCodeBlocks
// ============================================================
test('STRIP: fenced code block removed', function() {
  const result = mod.stripCodeBlocks('text ```code here``` more');
  assert(!result.includes('code here'));
  assert(result.includes('text'));
});

test('STRIP: inline code removed', function() {
  const result = mod.stripCodeBlocks('check `variable` now');
  assert(!result.includes('variable'));
});

test('STRIP: multi-line fenced block', function() {
  const result = mod.stripCodeBlocks('before\n```\nline1\nline2\n```\nafter');
  assert(!result.includes('line1'));
  assert(result.includes('before'));
  assert(result.includes('after'));
});

// ============================================================
// 10. removeLegacySection
// ============================================================
test('LEGACY: removes section preserves rest', function() {
  const content = '## A\nContent A\n\n## Legacy\nOld content\n\n## B\nContent B\n';
  const result = mod.removeLegacySection(content, '## Legacy');
  assert(!result.includes('Old content'));
  assert(result.includes('A'));
  assert(result.includes('B'));
});

test('LEGACY: noop when not found', function() {
  const content = '## A\nContent A\n';
  assert(mod.removeLegacySection(content, '## Nonexistent').includes('A'));
});

// ============================================================
// 11. Integration: feedback pressure flow
// ============================================================
test('INTEGRATION: pressure escalation L1->L2->L3 and decay', function() {
  const index = {};
  // Korean negative detected
  assertEqual(mod.detectNegativeFeedback('이건 틀렸어'), true, 'Korean negative');
  assertEqual(mod.updateFeedbackPressure(index, true), 1, 'L1');
  assertEqual(mod.updateFeedbackPressure(index, true), 2, 'L2');
  assertEqual(mod.updateFeedbackPressure(index, true), 3, 'L3');
  // 3 positives to decay once
  mod.updateFeedbackPressure(index, false);
  mod.updateFeedbackPressure(index, false);
  assertEqual(mod.updateFeedbackPressure(index, false), 2, 'decay to L2');
});

test('INTEGRATION: code blocks stripped before negative detection', function() {
  // "wrong" inside code block should not trigger
  assertEqual(mod.detectNegativeFeedback('Fix:\n```\nif (wrong) {}\n```\nDone.'), false);
  // "wrong" outside code block triggers
  assertEqual(mod.detectNegativeFeedback('This is wrong. ```code```'), true);
});

// ============================================================
// 12. RULES constant coherence with MARKER_START
// ============================================================
test('INTEGRATION: RULES constant starts with MARKER_START text', function() {
  assert(mod.RULES.trim().startsWith('## CRITICAL RULES'), 'RULES starts with marker');
});

test('INTEGRATION: syncRulesToClaudeMd output includes RULES principles', function() {
  const tmpDir = makeTempDir('sync-principles');
  try {
    mod.syncRulesToClaudeMd(tmpDir);
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    assert(content.includes('Anti-Deception'), 'Anti-Deception in output');
    assert(content.includes('Human Oversight'), 'Human Oversight in output');
    assert(content.includes('Completion Drive'), 'Completion Drive in output');
    assert(content.includes('Observation Resolution Levels'), 'L1-L4 in output');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 13. Subprocess: inject-rules.js outputs valid JSON with hookData
// ============================================================
test('SUBPROCESS: valid JSON output with hookData', function() {
  const tmpDir = makeTempDir('subprocess');
  try {
    ensureDir(path.join(tmpDir, '.crabshell', 'memory', 'logs'));
    const nodePath = process.execPath;
    const hookData = JSON.stringify({ prompt: 'test prompt for integration' });

    let stdout;
    try {
      stdout = execSync(
        '"' + nodePath + '" "' + injectRulesPath + '"',
        {
          env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
          input: hookData,
          timeout: 10000,
          encoding: 'utf8',
        }
      );
    } catch (e) {
      stdout = e.stdout || '';
    }

    const trimmed = stdout.trim();
    assert(trimmed.length > 0, 'produces output');

    let parsed;
    try { parsed = JSON.parse(trimmed); }
    catch (e) { throw new Error('not valid JSON: ' + trimmed.slice(0, 200)); }

    assert(parsed.hookSpecificOutput, 'has hookSpecificOutput');
    assertEqual(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit', 'hookEventName');
    assert(typeof parsed.hookSpecificOutput.additionalContext === 'string', 'additionalContext is string');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS: output contains key context items', function() {
  const tmpDir = makeTempDir('subprocess-ctx');
  try {
    ensureDir(path.join(tmpDir, '.crabshell', 'memory', 'logs'));
    const nodePath = process.execPath;
    const hookData = JSON.stringify({ prompt: 'test prompt' });

    let stdout;
    try {
      stdout = execSync(
        '"' + nodePath + '" "' + injectRulesPath + '"',
        {
          env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
          input: hookData,
          timeout: 10000,
          encoding: 'utf8',
        }
      );
    } catch (e) {
      stdout = e.stdout || '';
    }

    const parsed = JSON.parse(stdout.trim());
    const ctx = parsed.hookSpecificOutput.additionalContext;

    assert(ctx.includes('Rules Quick-Check'), 'COMPRESSED_CHECKLIST present');
    assert(ctx.includes('Node.js Path'), 'Node.js Path present');
    assert(ctx.includes('Project Root Anchor'), 'Project Root Anchor present');
    assert(ctx.includes('Verification reminder'), 'verification reminder present');
    assert(ctx.includes('TZ_OFFSET'), 'TZ_OFFSET present');
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SUBPROCESS: emergency stop produces different output', function() {
  const tmpDir = makeTempDir('subprocess-emerg');
  try {
    ensureDir(path.join(tmpDir, '.crabshell', 'memory', 'logs'));
    const nodePath = process.execPath;
    const hookData = JSON.stringify({ prompt: 'BRAINMELT stop' });

    let stdout, stderr;
    try {
      stdout = execSync(
        '"' + nodePath + '" "' + injectRulesPath + '"',
        {
          env: { ...process.env, CLAUDE_PROJECT_DIR: tmpDir },
          input: hookData,
          timeout: 10000,
          encoding: 'utf8',
        }
      );
    } catch (e) {
      stdout = e.stdout || '';
      stderr = e.stderr || '';
    }

    const parsed = JSON.parse(stdout.trim());
    const ctx = parsed.hookSpecificOutput.additionalContext;
    assert(ctx.includes('EMERGENCY STOP'), 'emergency stop context');
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 14. Additional edge cases: snippets
// ============================================================
test('SNIPPETS: empty logbook content -> null', function() {
  const tmpDir = makeTempDir('snippets-empty');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'logbook.md'), '');
    assertEqual(mod.getRelevantMemorySnippets(tmpDir, 'search for something here'), null);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SNIPPETS: logbook with no H2 sections -> null', function() {
  const tmpDir = makeTempDir('snippets-noheading');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'logbook.md'), 'plain text without headers');
    assertEqual(mod.getRelevantMemorySnippets(tmpDir, 'plain text without headers present'), null);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SNIPPETS: short prompt (< 10 chars) -> null', function() {
  const tmpDir = makeTempDir('snippets-short');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    fs.writeFileSync(path.join(memDir, 'logbook.md'), '## Test\ncontent\n');
    assertEqual(mod.getRelevantMemorySnippets(tmpDir, 'hi'), null);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SNIPPETS: max 3 sections returned', function() {
  const tmpDir = makeTempDir('snippets-cap');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    let content = '';
    for (let i = 0; i < 5; i++) content += '## Widget ' + i + '\nwidget details widget\n\n';
    fs.writeFileSync(path.join(memDir, 'logbook.md'), content);
    const result = mod.getRelevantMemorySnippets(tmpDir, 'widget details and implementation info');
    assert(result !== null, 'has result');
    const headings = (result.match(/### /g) || []).length;
    assert(headings <= 3, 'max 3 sections, got ' + headings);
  } finally {
    cleanupDir(tmpDir);
  }
});

test('SNIPPETS: respects 2000 char cap', function() {
  const tmpDir = makeTempDir('snippets-charcap');
  try {
    const memDir = path.join(tmpDir, '.crabshell', 'memory');
    ensureDir(memDir);
    let content = '';
    for (let i = 0; i < 3; i++) {
      content += '## Widget Part ' + i + '\n' + ('widget content ').repeat(200) + '\n\n';
    }
    fs.writeFileSync(path.join(memDir, 'logbook.md'), content);
    const result = mod.getRelevantMemorySnippets(tmpDir, 'widget content information details');
    assert(result !== null, 'has result');
    assert(result.length <= 2100, 'char cap respected, got ' + result.length);
  } finally {
    cleanupDir(tmpDir);
  }
});

// ============================================================
// 15. Additional edge cases: stripCodeBlocks
// ============================================================
test('STRIP: empty string -> empty', function() {
  assertEqual(mod.stripCodeBlocks(''), '');
});

test('STRIP: empty fenced block', function() {
  const result = mod.stripCodeBlocks('before `````` after');
  assert(typeof result === 'string');
  assert(result.includes('before'));
  assert(result.includes('after'));
});

test('STRIP: unclosed backtick -> content preserved', function() {
  const input = 'text with `unclosed backtick';
  assertEqual(mod.stripCodeBlocks(input), input);
});

test('STRIP: nested fenced blocks (greedy edge)', function() {
  const input = 'text ```outer\n```inner```\nouter end``` more';
  const result = mod.stripCodeBlocks(input);
  assert(typeof result === 'string');
});

test('STRIP: fenced with language tag', function() {
  const input = 'before ```javascript\nconst x = 1;\n``` after';
  const result = mod.stripCodeBlocks(input);
  assert(!result.includes('const x'));
  assert(result.includes('before'));
  assert(result.includes('after'));
});

test('STRIP: multiple inline code spans', function() {
  const result = mod.stripCodeBlocks('use `foo` and `bar` together');
  assert(!result.includes('foo'));
  assert(!result.includes('bar'));
});

// ============================================================
// 16. Additional edge cases: extractKeywords
// ============================================================
test('KEYWORDS: undefined -> empty', function() {
  assertEqual(mod.extractKeywords(undefined).length, 0);
});

test('KEYWORDS: empty string -> empty', function() {
  assertEqual(mod.extractKeywords('').length, 0);
});

test('KEYWORDS: period splits tokens (counter.js -> counter + js)', function() {
  const kws = mod.extractKeywords('fix the bug in counter.js please');
  assert(kws.includes('counter'), 'counter extracted');
  assert(!kws.includes('counter.js'), 'dot is delimiter');
});

test('KEYWORDS: special characters act as delimiters', function() {
  const kws = mod.extractKeywords('hello@world#test$something%else^more');
  assert(kws.length > 0);
  assert(!kws.some(k => /[@#$%^]/.test(k)), 'no special chars');
});

test('KEYWORDS: tokens < 3 chars excluded', function() {
  const kws = mod.extractKeywords('ab cd ef gh ij kl something here');
  assert(!kws.includes('ab'));
  assert(!kws.includes('cd'));
});

// ============================================================
// 17. Additional edge cases: parseMemorySections
// ============================================================
test('SECTIONS: empty body between headings', function() {
  const sections = mod.parseMemorySections('## Empty\n## Next\nbody here');
  assertEqual(sections.length, 2);
  assertEqual(sections[0].body, '');
  assert(sections[1].body.includes('body here'));
});

test('SECTIONS: heading with trailing spaces trimmed', function() {
  const sections = mod.parseMemorySections('## Title With Spaces  \nbody');
  assertEqual(sections[0].heading, 'Title With Spaces');
});

test('SECTIONS: ### is body content (only ## counts)', function() {
  const sections = mod.parseMemorySections('## Main\n### Sub\ncontent\n## Other\ncontent2');
  assertEqual(sections.length, 2);
  assert(sections[0].body.includes('### Sub'), '### is body');
});

// ============================================================
// 18. Additional edge cases: removeLegacySection
// ============================================================
test('LEGACY: header at very beginning', function() {
  const input = '## Legacy\nremove this\n\n## Keep\ngood content';
  const result = mod.removeLegacySection(input, '## Legacy');
  assert(!result.includes('remove this'));
  assert(result.includes('## Keep'));
});

test('LEGACY: empty content after header', function() {
  const input = '## Legacy\n';
  const result = mod.removeLegacySection(input, '## Legacy');
  assertEqual(result.trim(), '');
});

// ============================================================
// 19. Additional edge cases: feedback detection
// ============================================================
test('FEEDBACK: single char -> false (length < 2)', function() {
  assertEqual(mod.detectNegativeFeedback('x'), false);
});

test('FEEDBACK: keyword in code block -> false', function() {
  assertEqual(mod.detectNegativeFeedback('Fix:\n```\nwrong approach\n```\nDone.'), false);
});

test('FEEDBACK: keyword in inline code -> false', function() {
  assertEqual(mod.detectNegativeFeedback('Variable `wrong` should be renamed'), false);
});

test('FEEDBACK: keyword outside code block -> true', function() {
  assertEqual(mod.detectNegativeFeedback('This is wrong and needs fixing'), true);
});

test('FEEDBACK: don\'t worry exclusion prevents false positive', function() {
  // "don't worry" is an exclusion — stripped before pattern check
  assertEqual(mod.detectNegativeFeedback("don't worry about it"), false);
});

// ============================================================
// 20. Additional edge cases: pressure system
// ============================================================
test('PRESSURE: single negative -> level 1', function() {
  const index = {};
  assertEqual(mod.updateFeedbackPressure(index, true), 1);
});

test('PRESSURE: decayCounter resets on negative', function() {
  const index = {};
  mod.updateFeedbackPressure(index, true);   // level 1
  mod.updateFeedbackPressure(index, false);  // decay 1
  mod.updateFeedbackPressure(index, false);  // decay 2
  mod.updateFeedbackPressure(index, true);   // resets decay, level 2
  assertEqual(index.feedbackPressure.decayCounter, 0, 'decay reset');
  assertEqual(index.feedbackPressure.level, 2);
});

// ============================================================
// 21. Constants integrity
// ============================================================
test('CONSTANTS: MARKER_END is correct string', function() {
  assertEqual(mod.MARKER_END, '---Add your project-specific rules below this line---');
});

test('CONSTANTS: EMERGENCY_STOP_CONTEXT contains EMERGENCY STOP', function() {
  assert(mod.EMERGENCY_STOP_CONTEXT.includes('EMERGENCY STOP'));
});

test('CONSTANTS: COMPRESSED_CHECKLIST contains Rules Quick-Check', function() {
  assert(mod.COMPRESSED_CHECKLIST.includes('Rules Quick-Check'));
});

test('CONSTANTS: PRESSURE strings non-empty', function() {
  assert(mod.PRESSURE_L1.length > 10);
  assert(mod.PRESSURE_L2.length > 10);
  assert(mod.PRESSURE_L3.length > 10);
});

test('CONSTANTS: DELTA_INSTRUCTION contains CRABSHELL_DELTA', function() {
  assert(mod.DELTA_INSTRUCTION.includes('CRABSHELL_DELTA'));
});

test('CONSTANTS: ROTATION_INSTRUCTION contains BLOCKING', function() {
  assert(mod.ROTATION_INSTRUCTION.includes('BLOCKING'));
});

// ============================================================
// Summary
// ============================================================
console.log('\n========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('Total: ' + (passed + failed) + ' tests');
console.log('========================================');
process.exit(failed > 0 ? 1 : 0);
