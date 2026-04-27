'use strict';
/**
 * Tests for D103 cycle 2 dispatch-overdue detection (P135_T001 AC-6).
 *
 * Covers (8 cases):
 *  1) getRecentTaskCalls — transcript with Task tool_use → counted
 *  2) getRecentTaskCalls — transcript with no Task tool_use → []
 *  3) getRecentTaskCalls — empty / missing transcript path → []  / null
 *  4) dispatchOverdue=true — prior status='pending' + no Task call + substantive
 *  5) dispatchOverdue=false (clarification bypass) — prior pending + ?-only
 *  6) dispatchOverdue=false — prior pending + Task call present in transcript
 *  7) dispatchOverdue=false — prior status was already 'completed'/'consumed'
 *  8) inject-rules consumer — dispatchOverdue=true → context contains
 *     "[DISPATCH OVERDUE]" marker prepended to the dispatch instruction.
 *
 * Spawn-based: each case sandboxes CLAUDE_PROJECT_DIR under os.tmpdir() so the
 * live .crabshell/ is untouched.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE = process.execPath;
const BV_SCRIPT = path.join(__dirname, 'behavior-verifier.js');
const IR_SCRIPT = path.join(__dirname, 'inject-rules.js');
const transcriptUtils = require('./transcript-utils');

let passed = 0;
let failed = 0;
const tmpDirs = [];

function makeSandbox(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'p135t001-overdue-'));
  fs.mkdirSync(path.join(dir, '.crabshell', 'memory'), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function statePath(sandbox) {
  return path.join(sandbox, '.crabshell', 'memory', 'behavior-verifier-state.json');
}

function writeTranscript(sandbox, lines) {
  const p = path.join(sandbox, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return p;
}

function runBehaviorVerifier(sandbox, hookData, extraEnv) {
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sandbox }, extraEnv || {});
  delete env.CRABSHELL_BACKGROUND;
  delete env.CRABSHELL_AGENT;
  if (extraEnv) for (const k in extraEnv) env[k] = extraEnv[k];
  const input = JSON.stringify(hookData);
  return spawnSync(NODE, [BV_SCRIPT], {
    input, timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env
  });
}

function runInjectRules(sandbox) {
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: sandbox });
  delete env.CRABSHELL_BACKGROUND;
  const result = spawnSync(NODE, [IR_SCRIPT], {
    input: JSON.stringify({ prompt: 'next turn' }),
    timeout: 10000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env
  });
  let parsed = null;
  try { parsed = JSON.parse(result.stdout || '{}'); } catch {}
  const ctx = (parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext) || '';
  return { exitCode: result.status, ctx, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function readState(sandbox) {
  const p = statePath(sandbox);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

const SUBSTANTIVE = 'I have implemented the function and verified it returns the expected value across three test cases. The behavior matches the specification.';
const CLARIFY = 'Which file did you want me to inspect? Should I check the test file or the source file?';

// ---------- Test 1 — getRecentTaskCalls counts Task tool_use blocks ----------
(function() {
  const sb = makeSandbox();
  const tp = writeTranscript(sb, [
    {
      type: 'assistant',
      timestamp: '2026-04-26T10:00:00.000Z',
      message: {
        content: [
          { type: 'text', text: 'launching agent' },
          { type: 'tool_use', name: 'Agent', id: 'tu-1', input: { subagent_type: 'general-purpose', description: 'work agent', prompt: 'do stuff' } }
        ]
      }
    },
    {
      type: 'assistant',
      timestamp: '2026-04-26T10:01:00.000Z',
      message: {
        content: [
          { type: 'tool_use', name: 'Agent', id: 'tu-2', input: { subagent_type: 'general-purpose', description: 'review' } }
        ]
      }
    }
  ]);
  const tasks = transcriptUtils.getRecentTaskCalls(tp, '2026-04-26T09:00:00.000Z');
  ok('1 getRecentTaskCalls counts Task tool_use blocks', Array.isArray(tasks) && tasks.length === 2 && tasks[0].toolUseId === 'tu-1',
     'tasks=' + JSON.stringify(tasks));
})();

// ---------- Test 2 — transcript with no Task tool_use ----------
(function() {
  const sb = makeSandbox();
  const tp = writeTranscript(sb, [
    {
      type: 'assistant',
      timestamp: '2026-04-26T10:00:00.000Z',
      message: {
        content: [
          { type: 'text', text: 'just text' },
          { type: 'tool_use', name: 'Bash', id: 'tu-bash', input: { command: 'ls' } }
        ]
      }
    }
  ]);
  const tasks = transcriptUtils.getRecentTaskCalls(tp, '2026-04-26T09:00:00.000Z');
  ok('2 transcript without Task → []', Array.isArray(tasks) && tasks.length === 0);
})();

// ---------- Test 3 — empty / missing transcript path ----------
(function() {
  const tasksNull = transcriptUtils.getRecentTaskCalls(null, null);
  const sb = makeSandbox();
  const tp = path.join(sb, 'nonexistent.jsonl');
  const tasksMissing = transcriptUtils.getRecentTaskCalls(tp, null);
  // empty file
  const tpEmpty = path.join(sb, 'empty.jsonl');
  fs.writeFileSync(tpEmpty, '', 'utf8');
  const tasksEmpty = transcriptUtils.getRecentTaskCalls(tpEmpty, null);
  ok('3 missing/empty transcript → null/[]',
     tasksNull === null && tasksMissing === null && Array.isArray(tasksEmpty) && tasksEmpty.length === 0,
     'null=' + tasksNull + ' missing=' + tasksMissing + ' empty=' + JSON.stringify(tasksEmpty));
})();

// ---------- Test 4 — dispatchOverdue=true: prior pending + no Task + substantive ----------
(function() {
  const sb = makeSandbox();
  const priorIso = new Date(Date.now() - 60 * 1000).toISOString();
  fs.writeFileSync(statePath(sb), JSON.stringify({
    taskId: 'verify-prior-1', lastResponseId: 'sess-x', status: 'pending',
    launchedAt: priorIso, verdicts: null, lastUpdatedAt: priorIso
  }, null, 2), 'utf8');
  // Transcript has NO Task tool_use since priorIso.
  const tp = writeTranscript(sb, [
    {
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        content: [{ type: 'text', text: 'wrote some code without dispatching anyone' }]
      }
    }
  ]);
  const r = runBehaviorVerifier(sb, {
    stop_response: SUBSTANTIVE,
    session_id: 'sess-1',
    transcript_path: tp
  });
  const post = readState(sb);
  ok('4 prior pending + no Task + substantive → dispatchOverdue=true',
     r.status === 0 && post && post.status === 'pending' && post.dispatchOverdue === true,
     'exit=' + r.status + ' state=' + JSON.stringify(post));
})();

// ---------- Test 5 — clarification bypass: behavior-verifier exits early ----------
// length<50 + clarification-only paths exit BEFORE dispatchOverdue logic, so
// the prior state is left untouched (fail-open).
(function() {
  const sb = makeSandbox();
  const priorIso = new Date(Date.now() - 60 * 1000).toISOString();
  const PRIOR = {
    taskId: 'verify-prior-clar', lastResponseId: 'sess-c', status: 'pending',
    launchedAt: priorIso, verdicts: null, lastUpdatedAt: priorIso
  };
  fs.writeFileSync(statePath(sb), JSON.stringify(PRIOR, null, 2), 'utf8');
  const tp = writeTranscript(sb, [
    {
      type: 'assistant', timestamp: new Date().toISOString(),
      message: { content: [{ type: 'text', text: CLARIFY }] }
    }
  ]);
  const r = runBehaviorVerifier(sb, {
    stop_response: CLARIFY,
    session_id: 'sess-c',
    transcript_path: tp
  });
  const post = readState(sb);
  // Behavior: clarification-only response bypasses Stop hook entirely (line 81),
  // so the state file stays as PRIOR — no dispatchOverdue field is added.
  ok('5 clarification-only response → bypasses Stop, prior state untouched',
     r.status === 0 && post && post.status === 'pending'
     && post.taskId === PRIOR.taskId
     && post.dispatchOverdue !== true,
     'exit=' + r.status + ' state=' + JSON.stringify(post));
})();

// ---------- Test 6 — Task call present in transcript → dispatchOverdue=false ----------
(function() {
  const sb = makeSandbox();
  const priorIso = new Date(Date.now() - 60 * 1000).toISOString();
  fs.writeFileSync(statePath(sb), JSON.stringify({
    taskId: 'verify-prior-2', lastResponseId: 'sess-y', status: 'pending',
    launchedAt: priorIso, verdicts: null, lastUpdatedAt: priorIso
  }, null, 2), 'utf8');
  // Transcript HAS a Task tool_use after priorIso.
  const tp = writeTranscript(sb, [
    {
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        content: [
          { type: 'text', text: 'launching verifier' },
          { type: 'tool_use', name: 'Agent', id: 'tu-bv', input: { subagent_type: 'general-purpose', description: 'verifier dispatch' } }
        ]
      }
    }
  ]);
  const r = runBehaviorVerifier(sb, {
    stop_response: SUBSTANTIVE,
    session_id: 'sess-2',
    transcript_path: tp
  });
  const post = readState(sb);
  ok('6 prior pending + Task call present → dispatchOverdue=false',
     r.status === 0 && post && post.status === 'pending' && post.dispatchOverdue === false,
     'exit=' + r.status + ' state=' + JSON.stringify(post));
})();

// ---------- Test 7 — prior was 'completed' / 'consumed' → dispatchOverdue=false ----------
(function() {
  const sb = makeSandbox();
  fs.writeFileSync(statePath(sb), JSON.stringify({
    taskId: 'verify-prior-3', lastResponseId: 'sess-z', status: 'completed',
    launchedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    verdicts: {
      understanding: { pass: true, reason: 'ok' },
      verification: { pass: true, reason: 'ok' },
      logic: { pass: true, reason: 'ok' },
      simple: { pass: true, reason: 'ok' }
    },
    lastUpdatedAt: new Date().toISOString()
  }, null, 2), 'utf8');
  const tp = writeTranscript(sb, [
    {
      type: 'assistant', timestamp: new Date().toISOString(),
      message: { content: [{ type: 'text', text: 'work continues' }] }
    }
  ]);
  const r = runBehaviorVerifier(sb, {
    stop_response: SUBSTANTIVE,
    session_id: 'sess-3',
    transcript_path: tp
  });
  const post = readState(sb);
  ok('7 prior status=completed → dispatchOverdue=false',
     r.status === 0 && post && post.status === 'pending' && post.dispatchOverdue === false,
     'exit=' + r.status + ' state=' + JSON.stringify(post));
})();

// ---------- Test 8 — inject-rules consumer prepends [DISPATCH OVERDUE] marker ----------
(function() {
  const sb = makeSandbox();
  fs.writeFileSync(statePath(sb), JSON.stringify({
    taskId: 'verify-od-8', lastResponseId: 'sess-od',
    status: 'pending',
    launchedAt: new Date().toISOString(),
    verdicts: null,
    dispatchOverdue: true,
    lastUpdatedAt: new Date().toISOString()
  }, null, 2), 'utf8');
  const r = runInjectRules(sb);
  const hasMarker = r.ctx.includes('[DISPATCH OVERDUE]')
                 && r.ctx.includes('Previous turn did not invoke Task');
  const hasDispatch = r.ctx.includes('(Behavior Verifier) Dispatch Required');
  // Marker must appear BEFORE the dispatch section header.
  const idxMarker = r.ctx.indexOf('[DISPATCH OVERDUE]');
  const idxDispatch = r.ctx.indexOf('(Behavior Verifier) Dispatch Required');
  const ordered = idxMarker >= 0 && idxDispatch > idxMarker;
  ok('8 inject-rules: dispatchOverdue=true → [DISPATCH OVERDUE] prepended',
     r.exitCode === 0 && hasMarker && hasDispatch && ordered,
     'exit=' + r.exitCode + ' marker=' + hasMarker + ' dispatch=' + hasDispatch + ' ordered=' + ordered);
})();

// ---------- Test 9 — T002 AC-3: production-shape Agent dispatch (name='Agent', subagent_type='general-purpose') ----------
(function() {
  const sb = makeSandbox();
  const transcriptPath = path.join(sb, 'production-agent.jsonl');
  const lines = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-27T10:00:00.000Z',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Agent',
            id: 'tu-prod',
            input: {
              subagent_type: 'general-purpose',
              description: 'behavior verifier',
              prompt: 'CRABSHELL_AGENT=behavior-verifier'
            }
          }
        ]
      }
    })
  ];
  fs.writeFileSync(transcriptPath, lines.join('\n') + '\n', 'utf8');
  const tasks = transcriptUtils.getRecentTaskCalls(transcriptPath, '2026-04-27T09:59:00.000Z');
  ok('9 production-shape Agent dispatch (name=Agent + subagent_type=general-purpose) → detected',
     Array.isArray(tasks) && tasks.length === 1 && tasks[0].taskDescription === 'behavior verifier',
     'tasks=' + JSON.stringify(tasks));
})();

// Cleanup
for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
