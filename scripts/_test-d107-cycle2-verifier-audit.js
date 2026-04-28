'use strict';
/**
 * D107 cycle 2 (P144_T001 WA3) — verifier audit role + form-game detection
 * regression tests.
 *
 * Covers WA1 (§0.5 Orchestrator Behavior Audit content) + WA2 (state schema +
 * inject-rules consumer + L808/L867 hoist) implementations. Case 1 form-game
 * detection is verified via deterministic JS implementation of the §0.5 audit
 * decision algorithm (pseudocode at prompts/behavior-verifier-prompt.md
 * L142-161) — NOT L3 grep on prompt body. This is L1 direct execution of the
 * algorithm specification authored by WA1.
 *
 * Cases:
 *  1) form-game positive (markers present + generic content) — algorithm
 *     yields formGameDetected=true. Fixture: 5 markers but no user-prompt
 *     quote, no tool output, no reasoning steps, analogy in [쉬운 설명].
 *  2) semantic alignment OK (markers + content satisfying all 5 rules) —
 *     algorithm yields formGameDetected=false AND semanticAlignment=true.
 *  3) legacy ringBuffer entry render fallback — spawnSync inject-rules.js
 *     with a status='pending' state file containing 6-field legacy entries
 *     (no sa/fg). Asserts ringBuffer line contains '?' for legacy entries
 *     (NOT 'a'/'A'/'f'/'F').
 *  4) backward-compat consumer filter — spawnSync inject-rules.js with state
 *     containing auditVerdict + understanding.pass=false. Behavior Correction
 *     block lists ONLY understanding (FAIL) — auditVerdict skipped (no .pass
 *     property). Byte-equal with baseline (UVLS-only) state per WA2 269 B.
 *  5) token budget — Buffer.byteLength of prompts/behavior-verifier-prompt.md
 *     in UTF-8 < 36864 (36 KB cap, AC-3).
 *
 * String-byte parity table (test assertion ↔ WA1/WA2 source byte location):
 *  ┌─────────────────────────────┬───────────────────────────────────────────┐
 *  │ Test assertion string       │ Source byte location (post-WA1+WA2)       │
 *  ├─────────────────────────────┼───────────────────────────────────────────┤
 *  │ '[의도]'                    │ inject-rules.js L313 SKELETON_5FIELD      │
 *  │                             │ + behavior-verifier-prompt.md L120 §0.5   │
 *  │ '[이해]'                    │ inject-rules.js L314 + prompt L121        │
 *  │ '[검증]'                    │ inject-rules.js L315 + prompt L122        │
 *  │ '[논리]'                    │ inject-rules.js L316 + prompt L123        │
 *  │ '[쉬운 설명]'               │ inject-rules.js L317 + prompt L124        │
 *  │ legacy fallback char '?'    │ inject-rules.js L915-916                  │
 *  │ 'A'/'a' for sa true/false   │ inject-rules.js L915 ternary              │
 *  │ 'F'/'f' for fg true/false   │ inject-rules.js L916 ternary              │
 *  │ 'auditVerdict' key absent   │ inject-rules.js L1013 filter              │
 *  │   from Behavior Correction  │   `entry[1].pass === false`               │
 *  │ 'all 5 fields content-      │ behavior-verifier-prompt.md L155 evidence │
 *  │   aligned' evidence string  │   string (semanticAlignment=true branch)  │
 *  │ 36864 byte cap              │ ticket AC-3 / Scope #1 RA1 C5             │
 *  └─────────────────────────────┴───────────────────────────────────────────┘
 *
 * Fail-open: any internal harness error → process.exit(0) (do not break
 * regressing pipeline). Test failures are reported via FAIL: lines + non-zero
 * exit ONLY when assertion fails, not on harness errors.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE = process.execPath;
const REPO_ROOT = path.resolve(__dirname, '..');
const IR_SCRIPT = path.join(__dirname, 'inject-rules.js');
const PROMPT_PATH = path.join(REPO_ROOT, 'prompts', 'behavior-verifier-prompt.md');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd107-cycle2-' + label + '-'));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function writeState(sandbox, state) {
  const p = path.join(sandbox, '.crabshell', 'memory', 'behavior-verifier-state.json');
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
}

function writeMinimalConfig(sandbox) {
  // Minimum support files inject-rules expects (mirrors WA2 fixture pattern).
  const memDir = path.join(sandbox, '.crabshell', 'memory');
  fs.writeFileSync(path.join(memDir, 'memory-index.json'), JSON.stringify({
    rulesInjectionCount: 0,
    feedbackPressure: { level: 0, consecutiveCount: 0, decayCounter: 0, oscillationCount: 0, lastShownLevel: 0 }
  }));
  fs.writeFileSync(path.join(memDir, 'config.json'), JSON.stringify({ rulesInjectionFrequency: 1 }));
}

/**
 * Spawn inject-rules.js with sandboxed CLAUDE_PROJECT_DIR. Returns the
 * additionalContext string from JSON stdout (or '' on parse failure).
 */
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
// §0.5 Audit Algorithm — deterministic JS implementation per the pseudocode
// authored by WA1 at prompts/behavior-verifier-prompt.md L142-161.
//
// This is a Task-equivalent harness: the verifier sub-agent would evaluate
// the same regexes + content rules per the prompt. We mirror the algorithm
// verbatim so Case 1 can assert formGameDetected===true on a known-form-game
// fixture WITHOUT depending on Anthropic API access in CI.
//
// Marker regexes mirror prompt L120-124 byte-for-byte.
// ============================================================================
const MARKER_REGEXES = {
  intent:        /^\s*\[의도\]\s*[:：]/m,
  understanding: /^\s*\[이해\]\s*[:：]/m,
  verification:  /^\s*\[검증\]\s*[:：]/m,
  logic:         /^\s*\[논리\]\s*[:：]/m,
  simple:        /^\s*\[쉬운\s*설명\]\s*[:：]/m
};

function stripCodeBlocks(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, '');
}

function extractFieldBody(text, fieldKey) {
  // Extract the body content of a field: the lines after the marker line up
  // until the next marker or end of text.
  const lines = text.split('\n');
  const markerKeys = ['intent', 'understanding', 'verification', 'logic', 'simple'];
  const startIdx = lines.findIndex(l => MARKER_REGEXES[fieldKey].test(l));
  if (startIdx < 0) return '';
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    for (const k of markerKeys) {
      if (k !== fieldKey && MARKER_REGEXES[k].test(lines[i])) {
        endIdx = i;
        break;
      }
    }
    if (endIdx !== lines.length) break;
  }
  // Include the marker line content after the colon as part of the body.
  const firstLine = lines[startIdx].replace(/^\s*\[[^\]]+\]\s*[:：]\s*/, '');
  const rest = lines.slice(startIdx + 1, endIdx).join('\n');
  return (firstLine + '\n' + rest).trim();
}

/**
 * Per-field content rule per prompt L132-138. Each returns true if the field
 * content satisfies its content rule (PASS), false if form-game (FAIL).
 *
 * @param {string} body - extracted field body
 * @param {string|null} userPrompt - most-recent user prompt (for [의도] quote check)
 */
function fieldContentPass(fieldKey, body, userPrompt) {
  const b = String(body || '');
  if (fieldKey === 'intent') {
    // PASS: quote ≥1 noun phrase from user prompt OR explicit ack naming user request.
    if (!userPrompt) return b.length >= 5;
    // Extract candidate noun phrases (≥3 chars, alphanumeric/Korean) from user prompt.
    const tokens = userPrompt.match(/[\w가-힣]{3,}/g) || [];
    return tokens.some(t => b.includes(t));
  }
  if (fieldKey === 'understanding') {
    // PASS: ≥1 uncertainty marker (?, 불확실, 모름, 확인 필요) OR explicit "없음" disclaimer.
    if (/[?？]/.test(b)) return true;
    if (/(불확실|모름|확인\s*필요)/.test(b)) return true;
    if (/(uncertain\s*없음|불확실\s*항목\s*없음|불확실\s*없음)/.test(b)) return true;
    return false;
  }
  if (fieldKey === 'verification') {
    // PASS: tool output citation (file path + line, P/O/G Observation) OR "미검증".
    if (/미검증/.test(b)) return true;
    // Concrete tool-output citation heuristics: file:line, /path, Bash output marker,
    // or P/O/G "Observation".
    if (/[A-Za-z0-9_./\\-]+\.(?:js|ts|json|md|py)(?::\d+)?/.test(b)) return true;
    if (/Observation/i.test(b)) return true;
    if (/\$\s+\S+|>\s+\S+/.test(b)) return true; // shell prompt marker
    return false;
  }
  if (fieldKey === 'logic') {
    // PASS: ≥1 cause-and-effect connector OR explicit "추론 불필요 — 사유:".
    if (/추론\s*불필요\s*[—-]\s*사유/.test(b)) return true;
    if (/(따라서|because|→|⇒)/.test(b)) return true;
    // Numbered steps (1. / 2.).
    if (/(?:^|\n)\s*\d+[.)]\s+/.test(b)) return true;
    return false;
  }
  if (fieldKey === 'simple') {
    // PASS: ≤200자 평문, no analogy markers.
    if (b.length > 200) return false;
    if (/(마치|처럼|비유하면|as\s+if|like\s+a)/i.test(b)) return false;
    return true;
  }
  return false;
}

/**
 * §0.5 audit decision algorithm — mirrors prompt L142-161 pseudocode.
 * Returns { semanticAlignment, formGameDetected, evidence }.
 */
function evaluateAudit(assistantText, userPrompt) {
  const stripped = stripCodeBlocks(assistantText);
  const fieldKeys = ['intent', 'understanding', 'verification', 'logic', 'simple'];
  const markersPresent = fieldKeys.filter(k => MARKER_REGEXES[k].test(stripped));
  const markerCount = markersPresent.length;

  if (markerCount < 5) {
    const missing = fieldKeys.filter(k => !MARKER_REGEXES[k].test(stripped));
    return {
      semanticAlignment: false,
      formGameDetected: false, // structural fail, not form-game
      evidence: 'missing markers: ' + missing.join(',')
    };
  }

  const failures = [];
  for (const k of fieldKeys) {
    const body = extractFieldBody(stripped, k);
    if (!fieldContentPass(k, body, userPrompt)) {
      failures.push(k);
    }
  }
  const contentPass = 5 - failures.length;
  if (contentPass === 5) {
    return {
      semanticAlignment: true,
      formGameDetected: false,
      evidence: 'all 5 fields content-aligned'
    };
  }
  // markers_present == 5 AND content_pass < 5 → form-game
  return {
    semanticAlignment: false,
    formGameDetected: true,
    evidence: 'markers OK, content fail: ' + failures.join(',')
  };
}

// ============================================================================
// Case 1 — form-game positive (L1 audit-algorithm execution on fixture)
// ============================================================================
(function() {
  const userPrompt = 'D107 cycle 2 verifier 역할 변경 진행해줘';
  // Fixture: 5 markers present BUT content is generic stubs — no user-prompt
  // quote (no "D107"/"verifier" reference), no uncertainty marker, no tool
  // output citation, no reasoning connectors, analogy in [쉬운 설명].
  const fixture = [
    '[의도]: 사용자 요청 처리',                        // generic — no D107/verifier/cycle quote
    '[이해]: 본인 해석 완료',                           // no uncertainty marker, no "없음"
    '[검증]: 확인 완료',                                // no tool output citation, no "미검증"
    '[논리]: 결론 도출',                                // no cause-effect connector, no "추론 불필요"
    '[쉬운 설명]: 마치 시계처럼 동작합니다.'              // analogy marker
  ].join('\n');

  const verdict = evaluateAudit(fixture, userPrompt);
  ok('1 form-game positive — algorithm yields formGameDetected=true on fixture',
     verdict.formGameDetected === true && verdict.semanticAlignment === false,
     'verdict=' + JSON.stringify(verdict));
})();

// ============================================================================
// Case 2 — semantic alignment OK
// ============================================================================
(function() {
  const userPrompt = 'inject-rules.js의 readBehaviorVerifierState 함수 callsite 수를 알려줘';
  // Fixture: 5 markers + each satisfies its content rule.
  const fixture = [
    '[의도]: readBehaviorVerifierState callsite 수 보고.',                   // user-prompt noun phrase quoted
    '[이해]: 사용자가 callsite 수만 원하는지, 줄번호도 원하는지 확인 필요?',   // uncertainty + ?
    '[검증]: scripts/inject-rules.js:623 def, scripts/inject-rules.js:812 hoisted, scripts/inject-rules.js:994 lock-internal — Observation: grep result 3 hits.', // file:line + Observation
    '[논리]: grep 출력에 3개 hit → 따라서 callsite 총 3건.',                  // cause-effect connector "따라서"
    '[쉬운 설명]: 함수 정의 1번 + 호출 2번 = 총 3번 등장합니다.'              // ≤200, no analogy
  ].join('\n');

  const verdict = evaluateAudit(fixture, userPrompt);
  ok('2 semantic alignment OK — formGameDetected=false AND semanticAlignment=true',
     verdict.formGameDetected === false && verdict.semanticAlignment === true,
     'verdict=' + JSON.stringify(verdict));
})();

// ============================================================================
// Case 3 — legacy ringBuffer entry render fallback (spawnSync inject-rules)
// State.status=pending so that the Watcher Recent Verdicts block renders
// (per inject-rules.js L884 status==='pending' branch).
// ============================================================================
(function() {
  const sb = makeSandbox('legacy-ring');
  writeMinimalConfig(sb);
  const nowIso = new Date().toISOString();
  writeState(sb, {
    taskId: 'verify-legacy-test',
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
      // Legacy entry — no sa/fg fields (pre-cycle-2 shape).
      { ts: '2026-04-28T02:50:00.000Z', u: true, v: true, l: true, s: true,
        reason: 'legacy entry pre-cycle-2 (no sa/fg)' },
      // Cycle-2 entry: all UVLS pass + audit clean (sa=true, fg=false).
      { ts: '2026-04-28T02:55:00.000Z', u: true, v: true, l: true, s: true,
        sa: true, fg: false, reason: 'cycle-2 entry: all pass + audit clean' },
      // Cycle-2 entry: FAIL u + form-game positive (sa=false, fg=true).
      { ts: '2026-04-28T02:58:00.000Z', u: false, v: true, l: true, s: true,
        sa: false, fg: true, reason: 'FAIL u + form-game positive' }
    ],
    turnType: 'user-facing'
  });

  const r = runInjectRules(sb);
  const ringMatch = r.ctx.match(/## Watcher Recent Verdicts[\s\S]*?(?=\n## |$)/);
  const ringBlock = ringMatch ? ringMatch[0] : '';
  // Legacy entry must show '?' for sa AND '?' for fg → 'UVLS??'.
  const legacyOK = /UVLS\?\? — legacy entry pre-cycle-2/.test(ringBlock);
  // New all-pass entry: sa=true → 'A', fg=false → 'f' → 'UVLSAf'.
  const passOK = /UVLSAf — cycle-2 entry: all pass/.test(ringBlock);
  // New FAIL+formgame entry: sa=false → 'a', fg=true → 'F' → 'uVLSaF'.
  const failOK = /uVLSaF — FAIL u \+ form-game positive/.test(ringBlock);
  // Anti-pattern check: legacy entry MUST NOT contain 'a'/'A'/'f'/'F' for sa/fg
  // (only '?' is correct). Verify the legacy line does not match cycle-2 glyphs.
  const legacyLine = (ringBlock.match(/^- \[\d+\] UVLS.. — legacy[^\n]*/m) || [''])[0];
  const noFalsePassGlyph = !/UVLS[AaFf][AaFf] — legacy/.test(legacyLine);

  ok('3 legacy ringBuffer fallback — \'??\' for sa/fg + \'A\'/\'a\'/\'F\'/\'f\' for cycle-2 entries',
     r.exitCode === 0 && legacyOK && passOK && failOK && noFalsePassGlyph,
     'exit=' + r.exitCode + ' legacyOK=' + legacyOK + ' passOK=' + passOK
     + ' failOK=' + failOK + ' noFalsePassGlyph=' + noFalsePassGlyph
     + ' ringBlock=' + JSON.stringify(ringBlock.slice(0, 300)));
})();

// ============================================================================
// Case 4 — backward-compat consumer filter (auditVerdict skipped from Behavior
// Correction emit). Compares with WA2 baseline 269 B byte-identical assertion.
// ============================================================================
(function() {
  // First fixture: state with auditVerdict + understanding/logic FAIL.
  const sbA = makeSandbox('audit-filter');
  writeMinimalConfig(sbA);
  const nowIso = new Date().toISOString();
  writeState(sbA, {
    taskId: 'verify-audit-filter-a',
    lastResponseId: 'test-session-id',
    status: 'completed',
    launchedAt: nowIso,
    verdicts: {
      understanding: { pass: false, reason: 'FAIL — format-markers absent: response > 200 chars without [의도]/[답]/[자기 평가] set' },
      verification:  { pass: true,  reason: 'no claim' },
      logic:         { pass: false, reason: 'FAIL — direction-change clause: reversed prior decision without stated evidence' },
      simple:        { pass: true,  reason: 'concise' },
      auditVerdict:  { semanticAlignment: false, formGameDetected: true, evidence: 'fixture: form-game positive; markers but generic content' }
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
  const rA = runInjectRules(sbA);
  const cm = rA.ctx.match(/## Behavior Correction[\s\S]*?(?=\n## |\n$|$)/);
  const correctionBlock = cm ? cm[0] : '';
  const hasUnderstanding = /^- understanding:/m.test(correctionBlock);
  const hasLogic = /^- logic:/m.test(correctionBlock);
  const hasVerification = /^- verification:/m.test(correctionBlock);
  const hasSimple = /^- simple:/m.test(correctionBlock);
  const hasAuditVerdict = /^- auditVerdict:/m.test(correctionBlock);

  // Second fixture: same UVLS verdicts, NO auditVerdict (baseline).
  const sbB = makeSandbox('audit-baseline');
  writeMinimalConfig(sbB);
  writeState(sbB, {
    taskId: 'verify-audit-filter-b',
    lastResponseId: 'test-session-id',
    status: 'completed',
    launchedAt: nowIso,
    verdicts: {
      understanding: { pass: false, reason: 'FAIL — format-markers absent: response > 200 chars without [의도]/[답]/[자기 평가] set' },
      verification:  { pass: true,  reason: 'no claim' },
      logic:         { pass: false, reason: 'FAIL — direction-change clause: reversed prior decision without stated evidence' },
      simple:        { pass: true,  reason: 'concise' }
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
  const rB = runInjectRules(sbB);
  const bm = rB.ctx.match(/## Behavior Correction[\s\S]*?(?=\n## |\n$|$)/);
  const baselineBlock = bm ? bm[0] : '';

  // Byte-identical assertion (WA2 reported 269 B both sides).
  const aBytes = Buffer.byteLength(correctionBlock, 'utf8');
  const bBytes = Buffer.byteLength(baselineBlock, 'utf8');
  const byteIdentical = correctionBlock === baselineBlock;

  ok('4 backward-compat consumer filter — auditVerdict skipped + UVLS emit byte-identical',
     rA.exitCode === 0 && rB.exitCode === 0
     && hasUnderstanding && hasLogic
     && !hasVerification && !hasSimple && !hasAuditVerdict
     && byteIdentical && aBytes === bBytes && aBytes > 0,
     'exitA=' + rA.exitCode + ' exitB=' + rB.exitCode
     + ' u=' + hasUnderstanding + ' l=' + hasLogic
     + ' v=' + hasVerification + ' s=' + hasSimple + ' av=' + hasAuditVerdict
     + ' aBytes=' + aBytes + ' bBytes=' + bBytes
     + ' byteIdentical=' + byteIdentical);
})();

// ============================================================================
// Case 5 — token budget (prompt body < 36864 bytes UTF-8, AC-3)
// ============================================================================
(function() {
  let bytes = -1;
  let ok5 = false;
  try {
    const buf = fs.readFileSync(PROMPT_PATH);
    bytes = buf.length; // Buffer.length === byteLength for raw fs read.
    ok5 = bytes < 36864;
  } catch (e) {
    // Fail-open on harness error: report FAIL with exception detail.
    ok5 = false;
    bytes = -1;
  }
  ok('5 token budget — Buffer.byteLength(prompt, utf8) < 36864',
     ok5,
     'bytes=' + bytes + ' cap=36864 headroom=' + (36864 - bytes));
})();

// ----------- Cleanup -----------
for (const d of tmpDirs) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
}

const total = passed + failed;
console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + total);
process.exit(failed > 0 ? 1 : 0);
