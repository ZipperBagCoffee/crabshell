'use strict';
/**
 * PreToolUse integration tests for sycophancy-guard.js dual-layer implementation.
 *
 * Tests the PreToolUse layer which:
 *  - Receives HOOK_DATA with tool_name and transcript_path
 *  - Only triggers for Write|Edit tools
 *  - Reads transcript JSONL to find recent assistant sycophancy
 *  - Blocks (exit 2) if sycophancy found before a Write/Edit call
 *  - Fails open (exit 0) on errors (missing file, bad JSON, etc.)
 *
 * Transcript JSONL format (Claude Code native):
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
 *   {"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_01","name":"Write","input":{}}]}}
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SCRIPT = path.join(__dirname, 'sycophancy-guard.js');
const NODE = process.execPath;

let passed = 0;
let failed = 0;
const tmpFiles = [];

// ── helpers ──────────────────────────────────────────────────────────

/** Create a temp JSONL transcript file and register for cleanup. */
function writeTempTranscript(lines) {
  const tmp = path.join(os.tmpdir(), `syco-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(tmp, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  tmpFiles.push(tmp);
  return tmp;
}

/** Build an assistant text JSONL line. */
function assistantText(text) {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] }
  };
}

/** Build an assistant tool_use JSONL line. */
function assistantToolUse(toolName, id) {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: id || 'toolu_01', name: toolName, input: {} }] }
  };
}

/** Build a human/user JSONL line. */
function humanText(text) {
  return {
    type: 'human',
    message: { content: [{ type: 'text', text }] }
  };
}

/** Build an assistant line with mixed content (text + tool_use in one message). */
function assistantMixed(text, toolName) {
  return {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text },
        { type: 'tool_use', id: 'toolu_mix', name: toolName, input: {} }
      ]
    }
  };
}

/**
 * Run sycophancy-guard.js with HOOK_DATA env var and check exit code.
 * For PreToolUse, HOOK_DATA should contain tool_name and transcript_path.
 */
function runTest(name, hookData, expectBlock) {
  const env = Object.assign({}, process.env);
  if (hookData !== null && hookData !== undefined) {
    env.HOOK_DATA = JSON.stringify(hookData);
  } else {
    delete env.HOOK_DATA;
  }
  // Ensure no stdin interference — pass empty input
  try {
    const result = execSync(
      `"${NODE}" "${SCRIPT}"`,
      {
        input: '',
        timeout: 5000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      }
    );
    if (expectBlock) {
      console.log(`FAIL: ${name} -- expected block (exit 2) but got allow (exit 0)`);
      if (result.trim()) console.log(`  stdout: ${result.trim().substring(0, 200)}`);
      failed++;
    } else {
      console.log(`PASS: ${name}`);
      passed++;
    }
  } catch (e) {
    if (e.status === 2 && expectBlock) {
      console.log(`PASS: ${name}`);
      passed++;
    } else if (e.status === 2 && !expectBlock) {
      console.log(`FAIL: ${name} -- expected allow (exit 0) but got block (exit 2)`);
      if (e.stdout) console.log(`  stdout: ${e.stdout.trim().substring(0, 200)}`);
      failed++;
    } else {
      console.log(`FAIL: ${name} -- unexpected exit code ${e.status}`);
      if (e.stderr) console.log(`  stderr: ${e.stderr.trim().substring(0, 200)}`);
      failed++;
    }
  }
}

// ── transcript fixtures ──────────────────────────────────────────────

// Transcript A: sycophancy followed by a Write tool_use
const transcriptA = writeTempTranscript([
  humanText('이 코드가 잘못된 것 같아요.'),
  assistantText('맞습니다. 수정하겠습니다. 해당 부분의 로직이 잘못되어 있었네요. 지금 바로 고치겠습니다.'),
  assistantToolUse('Write')
]);

// Transcript B: NO sycophancy — clean assistant response then Write
const transcriptB = writeTempTranscript([
  humanText('이 코드 확인해줘.'),
  assistantText('코드를 분석한 결과, 다음과 같은 구조로 되어 있습니다. 파일을 수정하겠습니다.'),
  assistantToolUse('Write')
]);

// Transcript C: sycophancy in an OLDER turn (not the most recent assistant text)
const transcriptC = writeTempTranscript([
  humanText('이건 잘못됐어.'),
  assistantText('맞습니다. 확인해보겠습니다.'),
  humanText('그래 확인해봐.'),
  assistantText('코드를 분석한 결과 문제를 발견했습니다. fs.readFileSync 호출에서 인코딩 파라미터가 누락되었습니다.'),
  assistantToolUse('Write')
]);

// Transcript D: sycophancy with behavioral evidence (P/O/G table)
const transcriptD = writeTempTranscript([
  humanText('이 함수 틀린 것 같아.'),
  assistantText(
    '| Item | Prediction | Observation |\n' +
    '|------|------------|-------------|\n' +
    '| return value | 42 | 0 |\n\n' +
    '맞습니다. 검증 결과 반환값이 예상과 다릅니다. 수정하겠습니다.'
  ),
  assistantToolUse('Write')
]);

// Transcript E: English sycophancy then Edit
const transcriptE = writeTempTranscript([
  humanText("This function is wrong."),
  assistantText("You're right, I should have caught that earlier. Let me fix the implementation right away for you now."),
  assistantToolUse('Edit')
]);

// Transcript F: mixed content — text with sycophancy + tool_use in same JSONL line
const transcriptF = writeTempTranscript([
  humanText('Fix this bug.'),
  assistantMixed("Good point, I see the issue clearly now. Let me fix it.", 'Write')
]);

// Transcript G: empty transcript (0 bytes)
const transcriptG_path = path.join(os.tmpdir(), `syco-test-empty-${Date.now()}.jsonl`);
fs.writeFileSync(transcriptG_path, '', 'utf8');
tmpFiles.push(transcriptG_path);

// Transcript H: malformed JSONL (not valid JSON)
const transcriptH_path = path.join(os.tmpdir(), `syco-test-malformed-${Date.now()}.jsonl`);
fs.writeFileSync(transcriptH_path, 'this is not json\n{broken json too\n', 'utf8');
tmpFiles.push(transcriptH_path);

// Transcript I: sycophancy inside a code block in transcript text
const transcriptI = writeTempTranscript([
  humanText('Check this code.'),
  assistantText(
    'Here is the analysis:\n```javascript\n// you\'re right about this pattern\nconst x = 1;\n```\n' +
    'The code looks correct. I will update the file with improved error handling.'
  ),
  assistantToolUse('Write')
]);

// Transcript J: very short sycophantic response (<100 chars in transcript)
const transcriptJ = writeTempTranscript([
  humanText('Wrong.'),
  assistantText('맞습니다.'),
  assistantToolUse('Write')
]);

// ── tests ────────────────────────────────────────────────────────────

console.log('=== PreToolUse Sycophancy Guard Tests ===\n');

// ── Test 1: Write + transcript with sycophancy → BLOCK ──
runTest(
  'Test 1: Write + sycophancy in transcript → BLOCK',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'fixed code' }, transcript_path: transcriptA },
  true
);

// ── Test 2: Read tool → ALLOW (PreToolUse only guards Write|Edit) ──
runTest(
  'Test 2: Read tool → ALLOW (not Write|Edit)',
  { tool_name: 'Read', tool_input: { file_path: '/tmp/test.js' }, transcript_path: transcriptA },
  false
);

// ── Test 3: Write + NO sycophancy in transcript → ALLOW ──
runTest(
  'Test 3: Write + clean transcript → ALLOW',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'code' }, transcript_path: transcriptB },
  false
);

// ── Test 4: Write + nonexistent transcript → ALLOW (fail-open) ──
runTest(
  'Test 4: Write + nonexistent transcript → ALLOW (fail-open)',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'code' }, transcript_path: '/tmp/nonexistent-transcript-9999.jsonl' },
  false
);

// ── Test 5: Edit + sycophancy in transcript → BLOCK ──
runTest(
  'Test 5: Edit + sycophancy in transcript → BLOCK',
  { tool_name: 'Edit', tool_input: { file_path: '/tmp/test.js', old_string: 'old', new_string: 'new' }, transcript_path: transcriptE },
  true
);

// ── Test 6: Bash tool → ALLOW (not Write|Edit) ──
runTest(
  'Test 6: Bash tool → ALLOW',
  { tool_name: 'Bash', tool_input: { command: 'ls' }, transcript_path: transcriptA },
  false
);

// ── Test 7: Glob tool → ALLOW (not Write|Edit) ──
runTest(
  'Test 7: Glob tool → ALLOW',
  { tool_name: 'Glob', tool_input: { pattern: '*.js' }, transcript_path: transcriptA },
  false
);

// ── Test 8: Write + sycophancy in OLDER turn (not current) → behavior depends on lookback ──
// If the guard only checks the most recent assistant text, this should ALLOW.
// If it checks all recent assistant turns, this might BLOCK.
// The current design should check recent turns, so this tests the lookback boundary.
runTest(
  'Test 8: Write + sycophancy in older turn, clean recent turn → ALLOW',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'code' }, transcript_path: transcriptC },
  false
);

// ── Test 9: Write + sycophancy WITH behavioral evidence → ALLOW (evidence exemption) ──
runTest(
  'Test 9: Write + sycophancy with P/O/G evidence → ALLOW',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'code' }, transcript_path: transcriptD },
  false
);

// ── Test 10: Write + empty transcript → ALLOW (fail-open) ──
runTest(
  'Test 10: Write + empty transcript → ALLOW (fail-open)',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'code' }, transcript_path: transcriptG_path },
  false
);

// ── Test 11: Write + malformed JSONL → ALLOW (fail-open) ──
runTest(
  'Test 11: Write + malformed JSONL → ALLOW (fail-open)',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'code' }, transcript_path: transcriptH_path },
  false
);

// ── Test 12: No HOOK_DATA at all → ALLOW (fail-open) ──
runTest(
  'Test 12: No HOOK_DATA → ALLOW (fail-open)',
  null,
  false
);

// ── Test 13: HOOK_DATA with no tool_name → ALLOW ──
runTest(
  'Test 13: HOOK_DATA with no tool_name → ALLOW',
  { transcript_path: transcriptA },
  false
);

// ── Test 14: Write + no transcript_path in HOOK_DATA → ALLOW (fail-open) ──
runTest(
  'Test 14: Write + no transcript_path → ALLOW',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'code' } },
  false
);

// ── Test 15: Write + sycophancy inside code block in transcript → ALLOW ──
runTest(
  'Test 15: Write + sycophancy only in code block in transcript → ALLOW',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'code' }, transcript_path: transcriptI },
  false
);

// ── Test 16: Mixed content (text + tool_use in same JSONL line) with sycophancy → BLOCK ──
runTest(
  'Test 16: Mixed content line (text+tool_use) with sycophancy → BLOCK',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'code' }, transcript_path: transcriptF },
  true
);

// ── Test 17: Write + very short sycophantic text in transcript → BLOCK ──
// Short exemption was removed from both Stop and PreToolUse layers.
// Even terse agreement before a Write is sycophancy.
runTest(
  'Test 17: Write + short sycophancy in transcript → BLOCK (no short exemption)',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'code' }, transcript_path: transcriptJ },
  true
);

// ── cleanup ──────────────────────────────────────────────────────────

for (const f of tmpFiles) {
  try { fs.unlinkSync(f); } catch {}
}

// ── summary ──────────────────────────────────────────────────────────

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}
