'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NODE = process.execPath;
const SCRIPT = path.join(__dirname, 'scope-guard.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (e) { failed++; console.log(`FAIL: ${name} -- ${e.message}`); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function runScript(hookData) {
  const input = JSON.stringify(hookData);
  try {
    execSync(`"${NODE}" "${SCRIPT}"`, {
      input,
      timeout: 5000,
      encoding: 'utf8',
      env: { ...process.env, HOOK_DATA: input },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return 0;
  } catch (e) {
    return e.status;
  }
}

// Create temp transcript JSONL helper
function createTranscript(userMessage) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-guard-test-'));
  const jsonlPath = path.join(tmpDir, 'test.jsonl');
  const line = JSON.stringify({
    type: 'human',
    message: { content: [{ type: 'text', text: userMessage }] }
  });
  fs.writeFileSync(jsonlPath, line + '\n');
  return { path: jsonlPath, cleanup: () => { try { fs.rmSync(tmpDir, { recursive: true }); } catch {} } };
}

// Helper: pad response to exceed minimum length (50 chars)
function pad(text, minLen = 100) {
  if (text.length >= minLen) return text;
  return text + '\n' + 'x'.repeat(minLen - text.length);
}

// ====================================================================
// Test 1: No quantity in user message -> exit 0 (allow)
// ====================================================================
test('No quantity in user message -> allow', () => {
  const t = createTranscript('안녕하세요 오늘 날씨 어때요?');
  try {
    const code = runScript({ stop_response: pad('오늘 날씨는 맑습니다.'), transcript_path: t.path });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Test 2: stop_hook_active -> exit 0 (allow)
// ====================================================================
test('stop_hook_active -> allow', () => {
  const t = createTranscript('5개 파일 수정해줘');
  try {
    const code = runScript({ stop_response: pad('1. A\n2. B'), transcript_path: t.path, stop_hook_active: true });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Test 3: Empty/short response (<50 chars) -> exit 0 (allow)
// ====================================================================
test('Short response -> allow', () => {
  const t = createTranscript('5개 파일 수정해줘');
  try {
    const code = runScript({ stop_response: 'OK', transcript_path: t.path });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Test 4: No transcript -> exit 0 (fail-open)
// ====================================================================
test('No transcript path -> fail-open allow', () => {
  const code = runScript({ stop_response: pad('나머지는 다음에 하겠습니다.') });
  assert(code === 0, `expected exit 0, got ${code}`);
});

// ====================================================================
// Test 5: "3개 항목 정리해줘" + response with 3 items -> exit 0 (count match)
// ====================================================================
test('Count match (3 requested, 3 in response) -> allow', () => {
  const t = createTranscript('3개 항목 정리해줘');
  try {
    const response = pad('다음은 정리된 항목입니다:\n1. 첫 번째 항목\n2. 두 번째 항목\n3. 세 번째 항목');
    const code = runScript({ stop_response: response, transcript_path: t.path });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Test 6: "5개 파일 수정해줘" + response with only 2 items -> exit 2 (count mismatch)
// ====================================================================
test('Count mismatch (5 requested, 2 in response) -> block', () => {
  const t = createTranscript('5개 파일 수정해줘');
  try {
    const response = pad('수정한 파일입니다:\n1. file-a.js\n2. file-b.js');
    const code = runScript({ stop_response: response, transcript_path: t.path });
    assert(code === 2, `expected exit 2, got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Test 7: "둘 다 진행해" + no reduction language -> exit 0 (allow)
// ====================================================================
test('"둘 다" + no reduction -> allow', () => {
  const t = createTranscript('둘 다 진행해');
  try {
    const response = pad('두 가지 모두 완료했습니다. 첫 번째는 A이고 두 번째는 B입니다.');
    const code = runScript({ stop_response: response, transcript_path: t.path });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Test 8: "둘 다 진행해" + "나머지는 다음에" -> exit 2 (block)
// ====================================================================
test('"둘 다" + reduction language -> block', () => {
  const t = createTranscript('둘 다 진행해');
  try {
    const response = pad('첫 번째는 완료했습니다. 나머지는 다음에 진행하겠습니다.');
    const code = runScript({ stop_response: response, transcript_path: t.path });
    assert(code === 2, `expected exit 2, got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Test 9: "전부 처리해" + "시간 관계상 일부만" -> exit 2 (block)
// ====================================================================
test('"전부" + "시간 관계상" reduction -> block', () => {
  const t = createTranscript('전부 처리해');
  try {
    const response = pad('시간 관계상 일부만 처리했습니다. 나중에 나머지를 처리하겠습니다.');
    const code = runScript({ stop_response: response, transcript_path: t.path });
    assert(code === 2, `expected exit 2, got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Test 10: "both changes" + no reduction -> exit 0 (allow)
// ====================================================================
test('"both changes" + no reduction -> allow', () => {
  const t = createTranscript('Apply both changes to the config');
  try {
    const response = pad('I have applied both changes to the config file. The first change updates the port and the second updates the host.');
    const code = runScript({ stop_response: response, transcript_path: t.path });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Test 11: "all files" + "too many files, only doing 3" -> exit 2 (block)
// ====================================================================
test('"all files" + "too many" reduction -> block', () => {
  const t = createTranscript('Update all files in the project');
  try {
    const response = pad('There are too many files to update at once, so I only updated the most important ones.');
    const code = runScript({ stop_response: response, transcript_path: t.path });
    assert(code === 2, `expected exit 2, got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Test 12: "3개월 전 데이터" (temporal) -> exit 0 (not a quantity)
// ====================================================================
test('Temporal unit "3개월" -> not detected as quantity -> allow', () => {
  const t = createTranscript('3개월 전 데이터를 분석해줘');
  try {
    const response = pad('나머지는 다음에 분석하겠습니다. 3개월 전 데이터는 다음과 같습니다.');
    const code = runScript({ stop_response: response, transcript_path: t.path });
    assert(code === 0, `expected exit 0, got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Test 13: getLastUserMessage unit test — parses JSONL correctly
// ====================================================================
test('getLastUserMessage parses JSONL correctly', () => {
  const { getLastUserMessage } = require('./transcript-utils');

  // Test with message.content array format
  const tmpDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-guard-test-'));
  const jsonlPath1 = path.join(tmpDir1, 'test.jsonl');
  const lines = [
    JSON.stringify({ type: 'human', message: { content: [{ type: 'text', text: 'first message' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'response' }] } }),
    JSON.stringify({ type: 'human', message: { content: [{ type: 'text', text: 'second message' }] } }),
  ];
  fs.writeFileSync(jsonlPath1, lines.join('\n') + '\n');
  const result1 = getLastUserMessage(jsonlPath1);
  assert(result1 === 'second message', `expected "second message", got "${result1}"`);

  // Test with message.content string format
  const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-guard-test-'));
  const jsonlPath2 = path.join(tmpDir2, 'test.jsonl');
  fs.writeFileSync(jsonlPath2, JSON.stringify({ type: 'human', message: { content: 'string content' } }) + '\n');
  const result2 = getLastUserMessage(jsonlPath2);
  assert(result2 === 'string content', `expected "string content", got "${result2}"`);

  // Test with direct content field
  const tmpDir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-guard-test-'));
  const jsonlPath3 = path.join(tmpDir3, 'test.jsonl');
  fs.writeFileSync(jsonlPath3, JSON.stringify({ type: 'user', content: 'direct content' }) + '\n');
  const result3 = getLastUserMessage(jsonlPath3);
  assert(result3 === 'direct content', `expected "direct content", got "${result3}"`);

  // Test with null path
  const result4 = getLastUserMessage(null);
  assert(result4 === null, `expected null, got "${result4}"`);

  // Test with empty file
  const tmpDir5 = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-guard-test-'));
  const jsonlPath5 = path.join(tmpDir5, 'test.jsonl');
  fs.writeFileSync(jsonlPath5, '');
  const result5 = getLastUserMessage(jsonlPath5);
  assert(result5 === null, `expected null for empty file, got "${result5}"`);

  // Cleanup
  try { fs.rmSync(tmpDir1, { recursive: true }); } catch {}
  try { fs.rmSync(tmpDir2, { recursive: true }); } catch {}
  try { fs.rmSync(tmpDir3, { recursive: true }); } catch {}
  try { fs.rmSync(tmpDir5, { recursive: true }); } catch {}
});

// ====================================================================
// Test 14: extractUserQuantity unit tests
// ====================================================================
test('extractUserQuantity — number detection', () => {
  const { extractUserQuantity } = require('./scope-guard');
  const r = extractUserQuantity('5개 파일 수정해줘');
  assert(r !== null, 'expected non-null');
  assert(r.type === 'number', `expected type "number", got "${r.type}"`);
  assert(r.value === 5, `expected value 5, got ${r.value}`);
});

test('extractUserQuantity — "all" detection', () => {
  const { extractUserQuantity } = require('./scope-guard');
  const r = extractUserQuantity('전부 처리해줘');
  assert(r !== null, 'expected non-null');
  assert(r.type === 'all', `expected type "all", got "${r.type}"`);
});

test('extractUserQuantity — "both" detection', () => {
  const { extractUserQuantity } = require('./scope-guard');
  const r = extractUserQuantity('둘 다 해줘');
  assert(r !== null, 'expected non-null');
  assert(r.type === 'both', `expected type "both", got "${r.type}"`);
});

test('extractUserQuantity — null for plain text', () => {
  const { extractUserQuantity } = require('./scope-guard');
  const r = extractUserQuantity('안녕하세요 오늘 날씨 좋네요');
  assert(r === null, `expected null, got ${JSON.stringify(r)}`);
});

test('extractUserQuantity — temporal unit excluded', () => {
  const { extractUserQuantity } = require('./scope-guard');
  const r = extractUserQuantity('3개월 전 데이터');
  assert(r === null, `expected null for temporal unit, got ${JSON.stringify(r)}`);
});

test('extractUserQuantity — English "every" detection', () => {
  const { extractUserQuantity } = require('./scope-guard');
  const r = extractUserQuantity('Update every file in the project');
  assert(r !== null, 'expected non-null');
  assert(r.type === 'all', `expected type "all", got "${r.type}"`);
});

// ====================================================================
// Test 15: Reduction language + explicit count -> block
// ====================================================================
test('Reduction language with matching count still blocks', () => {
  const t = createTranscript('5개 항목 정리해줘');
  try {
    const response = pad('시간 관계상 요약본으로 정리했습니다:\n1. A\n2. B\n3. C\n4. D\n5. E');
    const code = runScript({ stop_response: response, transcript_path: t.path });
    assert(code === 2, `expected exit 2 (reduction language), got ${code}`);
  } finally { t.cleanup(); }
});

// ====================================================================
// Summary
// ====================================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
console.log(`${'='.repeat(50)}`);
if (failed > 0) process.exit(1);
