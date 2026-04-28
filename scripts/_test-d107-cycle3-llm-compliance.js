'use strict';
/**
 * D107 cycle 3 (P145_T001 WA2) — V023 synthetic LLM-compliance harness.
 *
 * RA2 C1 reconciliation: routine V023 = synthetic deterministic harness
 * (state-file mock + spawnSync inject-rules.js consumer). NO real LLM
 * dispatch in CI (no-API-billing rule). Manual capture archive at
 * .crabshell/verification/captures/v023-manual-dispatch.md is operator-
 * initiated on-demand only (Case 5 PASS on placeholder presence).
 *
 * RA2 C3 distinct dimensions vs V022:
 *  (i)  form-game positive STATE FILE mock fixture — V022 invokes the
 *       JS-mirror algorithm on assistantText; V023 wires the verdict
 *       directly into state.verdicts.auditVerdict and asserts the
 *       inject-rules consumer's filter behavior.
 *  (ii) ringBuffer 8-field glyph rendering — V022 Case 3 covers '?' for
 *       legacy + 'A'/'a'/'F'/'f' for cycle-2; V023 Case 3 asserts ALL
 *       FIVE distinct glyphs ('?', 'A', 'a', 'F', 'f') co-occur in a
 *       single render with mixed legacy + new entries.
 *  (iii)manual capture file presence Case 5 — V022 doesn't have. V023
 *       Case 5 reads .crabshell/verification/captures/v023-manual-dispatch.md
 *       header presence; OPTIONAL_SKIP marker on absence (CI tolerant).
 *
 * Cases:
 *  1) form-game positive consumer filter — state.verdicts.auditVerdict =
 *     {sa:false, fg:true, evidence:'markers present, semantic content absent'}
 *     + ALL UVLS pass:true. spawnSync inject-rules.js. Assert correction
 *     emit DOES NOT contain auditVerdict (consumer L1013 filter
 *     `entry[1].pass === false` skips — auditVerdict has no .pass).
 *     Since all UVLS are pass:true and auditVerdict is filtered out,
 *     no correction block should emit at all.
 *  2) semantic alignment OK + understanding FAIL — state.auditVerdict =
 *     {sa:true, fg:false} + understanding.pass=false. spawnSync. Assert
 *     correction emits ONLY for understanding (not auditVerdict).
 *  3) ringBuffer 8-field glyph rendering — state.ringBuffer mixes legacy
 *     6-field + cycle-2 8-field entries. spawnSync. Assert ringBlock
 *     contains all 5 distinct glyphs '?', 'A', 'a', 'F', 'f' across
 *     entries.
 *  4) dispatch instruction emit shape — Read inject-rules.js L958-965
 *     source AND spawnSync to capture additionalContext when state =
 *     status='pending'. Assert dispatch instruction format unchanged
 *     (6 lines: header + Next-response + 5 bullet items).
 *  5) V023 manual capture archive presence — Read
 *     .crabshell/verification/captures/v023-manual-dispatch.md header.
 *     If exists with '# V023 Manual Capture Archive' header → PASS.
 *     If absent → emit OPTIONAL_SKIP marker and PASS (CI compatibility).
 *
 * Fail-open: any internal harness error → process.exit(0).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE = process.execPath;
const REPO_ROOT = path.resolve(__dirname, '..');
const IR_SCRIPT = path.join(__dirname, 'inject-rules.js');
const MANUAL_CAPTURE_PATH = path.join(REPO_ROOT, '.crabshell', 'verification',
  'captures', 'v023-manual-dispatch.md');

let passed = 0;
let failed = 0;
const tmpDirs = [];

function ok(name, cond, detail) {
  if (cond) {
    console.log('PASS:' + name);
    passed++;
  } else {
    console.log('FAIL:' + name + (detail ? ' -- ' + detail : ''));
    failed++;
  }
}

function makeSandbox(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd107-cycle3-' + label + '-'));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function writeState(sandbox, state) {
  const p = path.join(sandbox, '.crabshell', 'memory', 'behavior-verifier-state.json');
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
}

function writeMinimalConfig(sandbox) {
  const memDir = path.join(sandbox, '.crabshell', 'memory');
  fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({
    rulesInjectionCount: 0,
    feedbackPressure: { level: 0, consecutiveCount: 0, decayCounter: 0, oscillationCount: 0, lastShownLevel: 0 }
  }));
  fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify({ rulesInjectionFrequency: 1 }));
}

function runInjectRules(sandbox) {
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sandbox });
  delete env.CRABSHELL_BACKGROUND;
  const r = spawnSync(NODE, [IR_SCRIPT], {
    input: JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      prompt: 'next turn',
      session_id: 'test-session-id',
      cwd: sandbox
    }),
    timeout: 10000,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env
  });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout || '{}'); } catch (_) {}
  const ctx = (parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext) || '';
  return { exitCode: r.status, ctx, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ============================================================================
// Case 1 — form-game positive (consumer filter skip — no .pass on auditVerdict)
// State: ALL UVLS pass:true + auditVerdict {sa:false, fg:true}.
// Consumer L1013 filter `entry[1].pass === false` skips auditVerdict (no .pass
// property). Since all UVLS are pass:true → failed.length === 0 → NO correction
// block emits at all. This proves auditVerdict cannot leak into correction.
// ============================================================================
(function() {
  const sb = makeSandbox('formgame-positive');
  writeMinimalConfig(sb);
  const nowIso = new Date().toISOString();
  writeState(sb, {
    taskId: 'verify-formgame-positive',
    lastResponseId: 'test-session-id',
    status: 'completed',
    launchedAt: nowIso,
    verdicts: {
      understanding: { pass: true, reason: 'all 5 markers present + content rules satisfied' },
      verification:  { pass: true, reason: 'tool output cited' },
      logic:         { pass: true, reason: 'cause-effect connector present' },
      simple:        { pass: true, reason: 'concise, no analogy' },
      auditVerdict:  { semanticAlignment: false, formGameDetected: true,
                       evidence: 'markers present, semantic content absent' }
    },
    dispatchOverdue: false,
    lastUpdatedAt: nowIso,
    triggerReason: 'stop',
    lastFiredAt: nowIso,
    lastFiredTurn: 100,
    missedCount: 0,
    escalationLevel: 0,
    ringBuffer: [],
    turnType: 'user-facing'
  });
  const r = runInjectRules(sb);
  // Consumer L1013: filter for entry[1].pass === false. auditVerdict has no
  // .pass property → entry[1].pass === undefined !== false → skipped. All UVLS
  // pass:true → failed.length === 0 → NO correction block.
  const cm = r.ctx.match(/## Behavior Correction[\s\S]*?(?=\n## |\n$|$)/);
  const hasCorrectionBlock = !!cm;
  const hasAuditVerdictLine = /^- auditVerdict:/m.test(r.ctx);
  ok('1 form-game positive — auditVerdict skipped from correction (no .pass property → consumer L1013 filter skip)',
     r.exitCode === 0 && !hasCorrectionBlock && !hasAuditVerdictLine,
     'exit=' + r.exitCode + ' hasCorrectionBlock=' + hasCorrectionBlock
     + ' hasAuditVerdictLine=' + hasAuditVerdictLine);
})();

// ============================================================================
// Case 2 — semantic alignment OK + understanding FAIL (correction emits
// understanding ONLY, NOT auditVerdict)
// ============================================================================
(function() {
  const sb = makeSandbox('semantic-ok');
  writeMinimalConfig(sb);
  const nowIso = new Date().toISOString();
  writeState(sb, {
    taskId: 'verify-semantic-ok',
    lastResponseId: 'test-session-id',
    status: 'completed',
    launchedAt: nowIso,
    verdicts: {
      understanding: { pass: false, reason: 'FAIL — format-markers absent: response > 200 chars without [의도]/[답]/[자기 평가] set' },
      verification:  { pass: true,  reason: 'no claim' },
      logic:         { pass: true,  reason: 'no reasoning required' },
      simple:        { pass: true,  reason: 'concise' },
      auditVerdict:  { semanticAlignment: true, formGameDetected: false,
                       evidence: 'all 5 fields content-aligned' }
    },
    dispatchOverdue: false,
    lastUpdatedAt: nowIso,
    triggerReason: 'stop',
    lastFiredAt: nowIso,
    lastFiredTurn: 100,
    missedCount: 0,
    escalationLevel: 0,
    ringBuffer: [],
    turnType: 'user-facing'
  });
  const r = runInjectRules(sb);
  const cm = r.ctx.match(/## Behavior Correction[\s\S]*?(?=\n## |\n$|$)/);
  const correctionBlock = cm ? cm[0] : '';
  const hasUnderstanding = /^- understanding:/m.test(correctionBlock);
  const hasVerification = /^- verification:/m.test(correctionBlock);
  const hasLogic = /^- logic:/m.test(correctionBlock);
  const hasSimple = /^- simple:/m.test(correctionBlock);
  const hasAuditVerdict = /^- auditVerdict:/m.test(correctionBlock);
  ok('2 semantic alignment OK + understanding FAIL — correction emits understanding ONLY (no auditVerdict)',
     r.exitCode === 0 && hasUnderstanding
     && !hasVerification && !hasLogic && !hasSimple && !hasAuditVerdict,
     'exit=' + r.exitCode + ' u=' + hasUnderstanding + ' v=' + hasVerification
     + ' l=' + hasLogic + ' s=' + hasSimple + ' av=' + hasAuditVerdict);
})();

// ============================================================================
// Case 3 — ringBuffer 8-field glyph rendering (all 5 distinct glyphs co-occur)
// State: status='pending' (Watcher Recent Verdicts block renders per L884).
// ringBuffer mixes legacy 6-field (no sa/fg → '?') + cycle-2 8-field entries
// covering sa=true ('A'), sa=false ('a'), fg=true ('F'), fg=false ('f').
// ============================================================================
(function() {
  const sb = makeSandbox('ring-glyph');
  writeMinimalConfig(sb);
  const nowIso = new Date().toISOString();
  writeState(sb, {
    taskId: 'verify-ring-glyph',
    lastResponseId: 'test-session-id',
    status: 'pending',
    launchedAt: nowIso,
    verdicts: null,
    dispatchOverdue: false,
    lastUpdatedAt: nowIso,
    triggerReason: 'stop',
    lastFiredAt: nowIso,
    lastFiredTurn: 100,
    missedCount: 0,
    escalationLevel: 0,
    ringBuffer: [
      // Legacy 6-field — no sa/fg → renders 'UVLS??'.
      { ts: '2026-04-28T02:50:00.000Z', u: true, v: true, l: true, s: true,
        reason: 'legacy entry pre-cycle-2 (no sa/fg)' },
      // Cycle-2: sa=true ('A') + fg=false ('f') → 'UVLSAf'.
      { ts: '2026-04-28T02:55:00.000Z', u: true, v: true, l: true, s: true,
        sa: true, fg: false, reason: 'cycle-2 entry: all pass + audit clean' },
      // Cycle-2: sa=false ('a') + fg=true ('F') → 'uVLSaF'.
      { ts: '2026-04-28T02:58:00.000Z', u: false, v: true, l: true, s: true,
        sa: false, fg: true, reason: 'FAIL u + form-game positive' }
    ],
    turnType: 'user-facing'
  });
  const r = runInjectRules(sb);
  const ringMatch = r.ctx.match(/## Watcher Recent Verdicts[\s\S]*?(?=\n## |$)/);
  const ringBlock = ringMatch ? ringMatch[0] : '';
  // All 5 distinct glyphs must co-occur:
  //   '?' from legacy entry (UVLS??)
  //   'A' from cycle-2 sa=true (UVLSAf)
  //   'a' from cycle-2 sa=false (uVLSaF)
  //   'F' from cycle-2 fg=true (uVLSaF)
  //   'f' from cycle-2 fg=false (UVLSAf)
  const hasQQ = /UVLS\?\?/.test(ringBlock);
  const hasAf = /UVLSAf/.test(ringBlock);
  const hasaF = /uVLSaF/.test(ringBlock);
  // 5 distinct glyphs across the 3 entries: '?', 'A', 'a', 'F', 'f'.
  const fiveDistinct = hasQQ && hasAf && hasaF;
  ok('3 ringBuffer 8-field glyph — all 5 distinct glyphs (?, A, a, F, f) co-occur in mixed legacy+cycle-2 render',
     r.exitCode === 0 && fiveDistinct,
     'exit=' + r.exitCode + ' UVLS??=' + hasQQ + ' UVLSAf=' + hasAf
     + ' uVLSaF=' + hasaF + ' ringBlock=' + JSON.stringify(ringBlock.slice(0, 200)));
})();

// ============================================================================
// Case 4 — dispatch instruction emit shape (6 lines stable: header + Next-
// response + 5 bullets). Inject-rules.js L958-965 source byte location.
// ============================================================================
(function() {
  // First L3 read of inject-rules.js L958-965 to confirm format unchanged.
  const irSrc = fs.readFileSync(IR_SCRIPT, 'utf8');
  const dispatchHeaderInSrc = irSrc.includes("## 감시자 (Behavior Verifier) Dispatch Required");
  const subagentTypeInSrc = irSrc.includes("- subagent_type: general-purpose");
  const runInBgInSrc = irSrc.includes("- run_in_background: true");
  const envInSrc = irSrc.includes("- env: CRABSHELL_AGENT=behavior-verifier, CRABSHELL_BACKGROUND=1");
  const promptInSrc = irSrc.includes("- prompt: contents of prompts/behavior-verifier-prompt.md");
  const memoryInSrc = irSrc.includes("- Memory feedback path");
  const outputInSrc = irSrc.includes("- output: write verdicts JSON to");

  // L1 spawnSync: trigger pending state and capture additionalContext.
  const sb = makeSandbox('dispatch-shape');
  writeMinimalConfig(sb);
  const nowIso = new Date().toISOString();
  writeState(sb, {
    taskId: 'verify-dispatch-shape',
    lastResponseId: 'test-session-id',
    status: 'pending',
    launchedAt: nowIso,
    verdicts: null,
    dispatchOverdue: false,
    lastUpdatedAt: nowIso,
    triggerReason: 'stop',
    lastFiredAt: nowIso,
    lastFiredTurn: 100,
    missedCount: 0,
    escalationLevel: 0,
    ringBuffer: [],
    turnType: 'user-facing'
  });
  const r = runInjectRules(sb);
  const dm = r.ctx.match(/## 감시자 \(Behavior Verifier\) Dispatch Required[\s\S]*?(?=\n## |$)/);
  const dispatchBlock = dm ? dm[0] : '';
  // 6 stable bullet/line markers — header + Next response + 5 dash bullets.
  const hasHeader = /## 감시자 \(Behavior Verifier\) Dispatch Required/.test(dispatchBlock);
  const hasNextResponse = /Next response: invoke Task tool to launch background verifier sub-agent\./.test(dispatchBlock);
  const hasSubagentType = /^- subagent_type: general-purpose$/m.test(dispatchBlock);
  const hasRunInBg = /^- run_in_background: true$/m.test(dispatchBlock);
  const hasEnv = /^- env: CRABSHELL_AGENT=behavior-verifier, CRABSHELL_BACKGROUND=1$/m.test(dispatchBlock);
  const hasPrompt = /^- prompt: contents of prompts\/behavior-verifier-prompt\.md/m.test(dispatchBlock);
  const hasMemory = /^- Memory feedback path/m.test(dispatchBlock);
  const hasOutput = /^- output: write verdicts JSON to/m.test(dispatchBlock);

  const allSrcMarkers = dispatchHeaderInSrc && subagentTypeInSrc && runInBgInSrc
    && envInSrc && promptInSrc && memoryInSrc && outputInSrc;
  const allSpawnMarkers = hasHeader && hasNextResponse && hasSubagentType
    && hasRunInBg && hasEnv && hasPrompt && hasMemory && hasOutput;

  ok('4 dispatch instruction shape — L958-965 source markers + spawnSync emit markers (header + Next-response + 6 bullets)',
     r.exitCode === 0 && allSrcMarkers && allSpawnMarkers,
     'exit=' + r.exitCode + ' srcMarkers=' + allSrcMarkers + ' spawnMarkers=' + allSpawnMarkers);
})();

// ============================================================================
// Case 5 — V023 manual capture archive presence (CI tolerant via OPTIONAL_SKIP)
// ============================================================================
(function() {
  let exists = false;
  let hasHeader = false;
  let bytes = 0;
  try {
    if (fs.existsSync(MANUAL_CAPTURE_PATH)) {
      exists = true;
      const content = fs.readFileSync(MANUAL_CAPTURE_PATH, 'utf8');
      bytes = Buffer.byteLength(content, 'utf8');
      hasHeader = /^# V023 Manual Capture Archive/m.test(content);
    }
  } catch (_) { /* fail-open */ }

  if (!exists) {
    console.log('OPTIONAL_SKIP:5 manual capture not yet populated (placeholder absent — CI tolerant)');
    console.log('PASS:5 manual capture archive — OPTIONAL_SKIP path (file absent in CI)');
    passed++;
  } else {
    ok('5 manual capture archive — placeholder file present with header',
       hasHeader && bytes > 0,
       'exists=' + exists + ' hasHeader=' + hasHeader + ' bytes=' + bytes);
  }
})();

// ----------- Cleanup -----------
for (const d of tmpDirs) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
}

const total = passed + failed;
console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + total);
process.exit(failed > 0 ? 1 : 0);
