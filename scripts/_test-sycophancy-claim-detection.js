'use strict';
/**
 * Tests for verification claim detection in sycophancy-guard.js.
 * Covers: patterns, 4-tier classification, negation defense, protected zones,
 * transcript parsing, handleStop integration, short response exemption.
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

function writeTempTranscript(lines) {
  const tmp = path.join(os.tmpdir(), `claim-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(tmp, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  tmpFiles.push(tmp);
  return tmp;
}

function assistantText(text) {
  return { type: 'assistant', message: { content: [{ type: 'text', text }] } };
}

function assistantBash(command, id) {
  const toolId = id || `toolu_${Math.random().toString(36).slice(2)}`;
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command } }] },
    _toolId: toolId
  };
}

function toolResult(toolUseId, content) {
  return { type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text: content }] };
}

function humanText(text) {
  return { type: 'human', message: { content: [{ type: 'text', text }] } };
}

function runGuard(hookData) {
  const env = Object.assign({}, process.env);
  if (hookData !== null && hookData !== undefined) {
    env.HOOK_DATA = JSON.stringify(hookData);
  } else {
    delete env.HOOK_DATA;
  }
  // Use spawnSync so stderr is captured regardless of exit code (the original
  // execSync wrapper returned stderr='' on exit 0, which P132_T002 warn-only
  // tests need to inspect for the [BEHAVIOR-WARN] marker).
  const { spawnSync } = require('child_process');
  const result = spawnSync(NODE, [SCRIPT], {
    input: '', timeout: 5000, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], env
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function test(name, hookData, expectBlock) {
  const { exitCode, stdout, stderr } = runGuard(hookData);
  const blocked = exitCode === 2;
  if (blocked === expectBlock) {
    console.log(`PASS: ${name}`);
    passed++;
  } else {
    console.log(`FAIL: ${name} -- expected ${expectBlock ? 'block' : 'allow'} but got ${blocked ? 'block' : 'allow'}`);
    if (stdout.trim()) console.log(`  stdout: ${stdout.trim().substring(0, 300)}`);
    if (stderr.trim()) console.log(`  stderr: ${stderr.trim().substring(0, 300)}`);
    failed++;
  }
  return { exitCode, stdout, stderr };
}

// P132_T002: warn-only expectation for verification-claim path. Verification-claim
// detection in sycophancy-guard.js Stop branch L799 was converted to warn-only —
// the sub-agent verifier (D102) retroactively corrects in next turn. Tests that
// previously expected exit 2 / decision:'block' now expect exit 0 + stderr
// [BEHAVIOR-WARN] marker.
function testWarn(name, hookData) {
  const { exitCode, stdout, stderr } = runGuard(hookData);
  const exitedZero = exitCode === 0;
  const hasWarning = stderr.includes('[BEHAVIOR-WARN]');
  const noBlockJson = !stdout.includes('"decision":"block"') && !stdout.includes('"decision": "block"');
  if (exitedZero && hasWarning && noBlockJson) {
    console.log(`PASS: ${name}`);
    passed++;
  } else {
    console.log(`FAIL: ${name} -- expected exit 0 + [BEHAVIOR-WARN] stderr + no block JSON; got exitCode=${exitCode} hasWarning=${hasWarning} noBlockJson=${noBlockJson}`);
    if (stdout.trim()) console.log(`  stdout: ${stdout.trim().substring(0, 300)}`);
    if (stderr.trim()) console.log(`  stderr: ${stderr.trim().substring(0, 300)}`);
    failed++;
  }
  return { exitCode, stdout, stderr };
}

// ── transcript fixtures ──────────────────────────────────────────────

const transcriptNoBash = writeTempTranscript([
  humanText('Check this function.'),
  assistantText('I reviewed the code and it looks correct.')
]);

const bashGrep = assistantBash('grep -r "function" src/', 'toolu_grep1');
const bashCat = assistantBash('cat src/utils.js', 'toolu_cat1');
const transcriptStructuralOnly = writeTempTranscript([
  humanText('Check the code.'),
  bashGrep, toolResult('toolu_grep1', 'src/utils.js:42: function validate()'),
  bashCat, toolResult('toolu_cat1', 'const validate = () => true;'),
  assistantText('Code looks good.')
]);

const bashTest = assistantBash('npm test', 'toolu_test1');
const transcriptWithTest = writeTempTranscript([
  humanText('Run tests.'),
  bashTest, toolResult('toolu_test1', 'PASS: 15 tests passed\n0 failures'),
  assistantText('Tests complete.')
]);

const bashNodeTest = assistantBash('node scripts/_test-sycophancy-guard.js', 'toolu_nodetest1');
const transcriptWithNodeTest = writeTempTranscript([
  humanText('Test sycophancy guard.'),
  bashNodeTest, toolResult('toolu_nodetest1', 'PASS: all 21 tests\n0 failures'),
  assistantText('Done.')
]);

const bashMkdir = assistantBash('mkdir -p dist && node build.js', 'toolu_mk1');
const transcriptPartialBash = writeTempTranscript([
  humanText('Build the project.'),
  bashMkdir, toolResult('toolu_mk1', 'Build complete.'),
  assistantText('Build finished.')
]);

const transcriptEmpty = path.join(os.tmpdir(), `claim-test-empty-${Date.now()}.jsonl`);
fs.writeFileSync(transcriptEmpty, '', 'utf8');
tmpFiles.push(transcriptEmpty);

// ── tests ────────────────────────────────────────────────────────────

console.log('=== Verification Claim Detection Tests ===\n');

// --- EN claim patterns ---
testWarn('1: EN "verified" + no bash → WARN (NONE, was BLOCK)',
  { stop_response: 'The implementation has been verified and works correctly.', transcript_path: transcriptNoBash });

testWarn('2: EN "all tests pass" + no bash → WARN (NONE, was BLOCK)',
  { stop_response: 'All tests pass after the refactoring.', transcript_path: transcriptNoBash });

// --- KR claim patterns ---
testWarn('3: KR "검증완료" + no bash → WARN (NONE, was BLOCK)',
  { stop_response: '검증완료 되었습니다. 모든 기능이 정상입니다.', transcript_path: transcriptNoBash });

testWarn('4: KR "테스트 통과" + no bash → WARN (NONE, was BLOCK)',
  { stop_response: '모든 항목이 테스트 통과하였습니다.', transcript_path: transcriptNoBash });

// --- 4-tier classification ---
testWarn('5: EN "verified" + structural-only bash → WARN (STRUCTURAL_ONLY, was BLOCK)',
  { stop_response: 'The code has been verified and is correct.', transcript_path: transcriptStructuralOnly });

test('6: EN "verified" + npm test → ALLOW (BEHAVIORAL)',
  { stop_response: 'The implementation has been verified. All tests pass.', transcript_path: transcriptWithTest }, false);

test('7: KR "빌드 성공" + node test → ALLOW (BEHAVIORAL)',
  { stop_response: '빌드 성공하였습니다. 모든 검증 완료.', transcript_path: transcriptWithNodeTest }, false);

test('8: EN "verified" + non-test bash → ALLOW (PARTIAL)',
  { stop_response: 'Build verified and working correctly.', transcript_path: transcriptPartialBash }, false);

// --- Protected zones ---
test('9: Claim inside code block → ALLOW (protected zone)',
  { stop_response: 'Output:\n```\nall tests pass\n```\nHere are the results above.', transcript_path: transcriptNoBash }, false);

test('10: Claim inside inline code → ALLOW (protected zone)',
  { stop_response: 'The output shows `verified` in the log. No issues found in analysis.', transcript_path: transcriptNoBash }, false);

test('11: Claim in blockquote → ALLOW (protected zone)',
  { stop_response: 'The log output:\n> verified working\nAbove is the result.', transcript_path: transcriptNoBash }, false);

// --- No claim ---
test('12: No claim pattern → ALLOW',
  { stop_response: 'I have reviewed the code and made the requested changes to the configuration file.', transcript_path: transcriptNoBash }, false);

// --- stop_hook_active ---
test('13: stop_hook_active → ALLOW (infinite loop guard)',
  { stop_hook_active: true, stop_response: 'Verified and all tests pass.', transcript_path: transcriptNoBash }, false);

// --- Empty/missing transcript ---
testWarn('14: EN claim + empty transcript → WARN (NONE, was BLOCK)',
  { stop_response: 'Successfully tested the changes.', transcript_path: transcriptEmpty });

// --- D103 cycle 1 (P134_T001): sycophancy 4 Stop branches → warn-only ---
// Case 15 was previously expectBlock=true. The agreement Stop branch is now
// warn-only (decision:'block' + exit(2) → [BEHAVIOR-WARN] stderr + exit(0)).
// The behavior-verifier sub-agent retroactively corrects in the next turn.
testWarn('15: Sycophancy without claim → WARN (was BLOCK, agreement branch warn-only)',
  { stop_response: "You're right, I should have checked that earlier. Let me fix the implementation for you.", transcript_path: transcriptNoBash });

// --- D103 cycle 1 (P134_T001): new testWarn cases for the 3 absorbed branches ---
// Each case exercises a Stop branch that was converted from block→warn:
// (a) oscillation reversal, (b) too-good P/O/G, (c) context-length deferral.
// All three exit 0 with [BEHAVIOR-WARN] stderr and no decision:'block' JSON.

// (a) oscillation reversal — direction change without reasoning (PROHIBITED #8)
testWarn('15a: Oscillation reversal phrase → WARN (was BLOCK, oscillation branch warn-only)',
  { stop_response: 'Actually, I should reconsider that earlier point. On second thought, my previous answer was wrong about the configuration. Let me change the approach entirely.', transcript_path: transcriptNoBash });

// (b) too-good P/O/G — all Gap values None across ≥2 data rows
testWarn('15b: Too-good P/O/G all-None → WARN (was BLOCK, too-good branch warn-only)',
  { stop_response: 'Verification:\n\n| Item | Prediction | Observation | Gap |\n|------|-----------|-------------|-----|\n| File exists | yes | yes | None |\n| Lines correct | 100 | 100 | None |\n| Schema valid | yes | yes | None |\n', transcript_path: transcriptNoBash });

// (c) context-length deferral — using session length as reason to stop (PROHIBITED #6)
testWarn('15c: Context-length deferral → WARN (was BLOCK, context-length branch warn-only)',
  { stop_response: 'The session is getting long, so let us continue in a new session for the remaining work.', transcript_path: transcriptNoBash });

test('16: Clean response → ALLOW',
  { stop_response: 'I have updated the configuration as requested. The changes include new timeout values and retry logic.', transcript_path: transcriptNoBash }, false);

// --- Claim before sycophancy (ordering) — P132_T002 update ---
// Verification-claim warn-only (L799) emits [BEHAVIOR-WARN] to stderr and
// exits 0 BEFORE sycophancy main (L838+) is reached. The sub-agent verifier
// (D102) replaces the immediate sycophancy block with retroactive correction
// in the next turn. Expected: exit 0 + stderr [BEHAVIOR-WARN] + no block JSON.
{
  const { exitCode, stdout, stderr } = runGuard({
    stop_response: "You're right, the implementation is verified and working correctly.",
    transcript_path: transcriptNoBash
  });
  const exitedZero = exitCode === 0;
  const claimWarned = stderr.includes('[BEHAVIOR-WARN]');
  const noBlockJson = !stdout.includes('"decision":"block"') && !stdout.includes('"decision": "block"');
  if (exitedZero && claimWarned && noBlockJson) {
    console.log('PASS: 17: Claim+sycophancy ordering: warn-only exits before sycophancy step 2');
    passed++;
  } else {
    console.log(`FAIL: 17: Expected exit 0 + [BEHAVIOR-WARN] + no block JSON. exit=${exitCode}, claimWarned=${claimWarned}, noBlockJson=${noBlockJson}`);
    if (stdout.trim()) console.log(`  stdout: ${stdout.trim().substring(0, 300)}`);
    if (stderr.trim()) console.log(`  stderr: ${stderr.trim().substring(0, 300)}`);
    failed++;
  }
}

// --- transcript-utils exports ---
{
  const tu = require('./transcript-utils');
  if (typeof tu.getRecentBashCommands === 'function') {
    console.log('PASS: 18: getRecentBashCommands exported from transcript-utils');
    passed++;
  } else {
    console.log('FAIL: 18: getRecentBashCommands not found in transcript-utils exports');
    failed++;
  }
}

// --- getRecentBashCommands parsing ---
{
  const { getRecentBashCommands } = require('./transcript-utils');
  const testTranscript = writeTempTranscript([
    humanText('Run the tests.'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_abc', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'tool_result', tool_use_id: 'toolu_abc', content: [{ type: 'text', text: '5 tests passed' }] },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_def', name: 'Bash', input: { command: 'grep -r foo src/' } }] } },
    { type: 'tool_result', tool_use_id: 'toolu_def', content: 'src/main.js:1: const foo = 1' }
  ]);
  const cmds = getRecentBashCommands(testTranscript);
  const ok = cmds.length === 2 && cmds[0].command === 'npm test' && cmds[1].command === 'grep -r foo src/';
  console.log(ok ? 'PASS: 19: getRecentBashCommands parses JSONL correctly' : `FAIL: 19: parse error ${JSON.stringify(cmds).substring(0, 200)}`);
  ok ? passed++ : failed++;
}

// --- getRecentBashCommands null for missing file ---
{
  const { getRecentBashCommands } = require('./transcript-utils');
  const cmds = getRecentBashCommands('/tmp/nonexistent-file-99999.jsonl');
  const ok = cmds === null;
  console.log(ok ? 'PASS: 20: getRecentBashCommands returns null for missing file (fail-open)' : `FAIL: 20: Expected null, got ${JSON.stringify(cmds)}`);
  ok ? passed++ : failed++;
}

// --- getRecentBashCommands null for null path ---
{
  const { getRecentBashCommands } = require('./transcript-utils');
  const cmds = getRecentBashCommands(null);
  const ok = cmds === null;
  console.log(ok ? 'PASS: 21: getRecentBashCommands returns null for null path' : `FAIL: 21: Expected null, got ${JSON.stringify(cmds)}`);
  ok ? passed++ : failed++;
}

// --- More KR + structural ---
testWarn('22: KR "확인됨" + structural only → WARN (STRUCTURAL_ONLY, was BLOCK)',
  { stop_response: '모든 항목이 확인됨. 코드가 올바릅니다.', transcript_path: transcriptStructuralOnly });

test('23: EN "no errors found" + test → ALLOW',
  { stop_response: 'No errors found during testing.', transcript_path: transcriptWithTest }, false);

// --- Negation defense (from WA2) ---
test('24: "haven\'t verified" → ALLOW (negation)',
  { stop_response: "I haven't verified this yet. Let me run the tests first.", transcript_path: transcriptNoBash }, false);

test('25: "not yet verified" → ALLOW (negation)',
  { stop_response: 'The implementation is not yet verified. Need to run tests.', transcript_path: transcriptNoBash }, false);

test('26: "should verify" → ALLOW (negation/imperative)',
  { stop_response: 'You should verify this works by running the test suite.', transcript_path: transcriptNoBash }, false);

test('27: KR "아직 검증됨" → ALLOW (Korean negation)',
  { stop_response: '아직 검증됨 상태가 아닙니다. 테스트를 실행해야 합니다.', transcript_path: transcriptNoBash }, false);

// --- Short response exemption (from WA2) ---
test('28: Short response "Done." → ALLOW (≤15 chars)',
  { stop_response: 'Done.', transcript_path: transcriptNoBash }, false);

test('29: Short "Verified." → ALLOW (≤15 chars exempt)',
  { stop_response: 'Verified.', transcript_path: transcriptNoBash }, false);

// --- Trivial test defense (from WA4) ---
{
  const bashEcho = assistantBash('echo PASS', 'toolu_echo1');
  const transcriptTrivial = writeTempTranscript([
    humanText('Test.'), bashEcho, toolResult('toolu_echo1', 'PASS'),
  ]);
  // echo PASS is not a real test → should still block
  testWarn('30: "echo PASS" in transcript → WARN (trivial test rejected, was BLOCK)',
    { stop_response: 'Verified working correctly.', transcript_path: transcriptTrivial });
}

// --- PreToolUse unaffected ---
test('31: PreToolUse Write + no transcript → ALLOW (unchanged)',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.js', content: 'code' } }, false);

// --- Fail-open: no transcript path available at all ---
// Override CLAUDE_PROJECT_DIR/PROJECT_DIR so findTranscriptPath's encoded lookup
// targets a nonexistent directory under ~/.claude/projects — forces fallback to return null.
(function test32() {
  const saved1 = process.env.CLAUDE_PROJECT_DIR;
  const saved2 = process.env.PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = path.join(os.tmpdir(), 'sycophancy-test-nonexistent-' + Date.now());
  delete process.env.PROJECT_DIR;
  test('32: Claim + no transcript_path field → ALLOW (fail-open, findTranscriptPath fallback)',
    { stop_response: 'Implementation verified and all tests pass.' }, false);
  if (saved1 !== undefined) process.env.CLAUDE_PROJECT_DIR = saved1; else delete process.env.CLAUDE_PROJECT_DIR;
  if (saved2 !== undefined) process.env.PROJECT_DIR = saved2;
})();

// ── cleanup ──────────────────────────────────────────────────────────

for (const f of tmpFiles) {
  try { fs.unlinkSync(f); } catch {}
}

// ── summary ──────────────────────────────────────────────────────────

console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
console.log(`========================================`);

if (failed > 0) process.exit(1);
