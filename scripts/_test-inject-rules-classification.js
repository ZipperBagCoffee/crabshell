'use strict';

/**
 * Tests for classifyUserIntent() in inject-rules.js
 */

const { classifyUserIntent } = require('./inject-rules');

let passed = 0;
let failed = 0;

function test(name, actual, expected) {
  if (actual === expected) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.log(`  FAIL: ${name} — expected '${expected}', got '${actual}'`);
    failed++;
  }
}

console.log('--- classifyUserIntent() ---');

// Korean execution patterns
test('"수정해" → execution', classifyUserIntent('수정해'), 'execution');
test('"진행해라" → execution', classifyUserIntent('진행해라'), 'execution');
test('"구현해" → execution', classifyUserIntent('구현해'), 'execution');
test('"만들어" → execution', classifyUserIntent('만들어'), 'execution');
test('"실행해봐" → execution', classifyUserIntent('실행해봐'), 'execution');
test('"시작해" → execution', classifyUserIntent('시작해'), 'execution');
test('"고쳐" → execution', classifyUserIntent('고쳐'), 'execution');
test('"적용해줘" → execution', classifyUserIntent('적용해줘'), 'execution');

// English execution patterns
test('"do it" → execution', classifyUserIntent('do it'), 'execution');
test('"proceed with the plan" → execution', classifyUserIntent('proceed with the plan'), 'execution');
test('"fix it" → execution', classifyUserIntent('fix it'), 'execution');
test('"create a new file" → execution', classifyUserIntent('create a new file'), 'execution');
test('"implement this" → execution', classifyUserIntent('implement this'), 'execution');
test('"build the component" → execution', classifyUserIntent('build the component'), 'execution');
test('"execute the script" → execution', classifyUserIntent('execute the script'), 'execution');
test('"start the server" → execution', classifyUserIntent('start the server'), 'execution');
test('"apply the patch" → execution', classifyUserIntent('apply the patch'), 'execution');

// Question patterns (read-only turns since D111; the old 3-way test predated the question class)
test('"설명해줘" → question', classifyUserIntent('설명해줘'), 'question');
test('"뭐야?" → question', classifyUserIntent('뭐야?'), 'question');
test('"what is this" → question', classifyUserIntent('what is this'), 'question');
test('"explain the code" → question', classifyUserIntent('explain the code'), 'question');
test('"how does this work" → question', classifyUserIntent('how does this work'), 'question');
test('"do you think it works" → question', classifyUserIntent('do you think it works'), 'question');

// Edge cases (AC13)
test('"" → default', classifyUserIntent(''), 'default');
test('null → default', classifyUserIntent(null), 'default');
test('undefined → default', classifyUserIntent(undefined), 'default');

console.log('--- Requests and references ---');
test('polite English action', classifyUserIntent('Can you fix this bug?'), 'execution');
test('quoted question is reference data', classifyUserIntent('Fix this bug. The previous error was "why?".'), 'execution');
test('quoted action inside a question', classifyUserIntent('What does "apply this change" mean?'), 'question');
test('research and record request', classifyUserIntent('조사해서 문서로 남겨줘'), 'execution');
test('read discussion request', classifyUserIntent('d118 확인해봐'), 'question');
test('explicit read-only constraint', classifyUserIntent('Do not change the code; explain it.'), 'question');

// D147_T001: text the host wraps as not written by the user does not issue instructions.
console.log('--- Host-wrapped text (D147_T001) ---');
const { isStopRequest } = require('./core/turn-intent');
const queuedCapture = require('./fixtures/hook-payloads/native/claude-UserPromptSubmit-queued.json');
const pasted = (id, body) => `<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">`;
const peer = body => `<cross-session-message from="uds:peer" from-name="peer" from-mode="bypass">\n${body}\n</cross-session-message>`;
const pastedPlan = pasted('c99a', '1. 답 보내기 전에 점검해.\n2. 빠진 시험을 추가하고 구현해.');
test('pasted plan plus a reprimand is not an execution request (transcript line 9734 shape)',
  classifyUserIntent(`  ${pastedPlan}\n\n이런 임기응변 하지 말라고`) !== 'execution', true);
test('pasted text alone is the request', classifyUserIntent(pasted('a1', '이 버그 수정해 주세요')), 'execution');
test('another session\'s message is not the user\'s request', classifyUserIntent(peer('이 함수 구현해')), 'default');
test('captured cross-session message is not the user\'s request', classifyUserIntent(queuedCapture.prompt), 'default');
test('user text next to another session\'s message still counts', classifyUserIntent(`${peer('읽어 봐')}\n고쳐`), 'execution');
test('a task notification is not the user\'s request', classifyUserIntent('<task-notification>\n<summary>implemented the fix</summary>\n</task-notification>'), 'default');
test('pasted text ends at its own closing line, not another id\'s',
  classifyUserIntent(`${pasted('a2', '구현해 </pasted_content id="zz"> 수정해')}\n왜 이렇게 됐어?`), 'question');
test('an opening line without its closing line is left in place',
  classifyUserIntent('<pasted_content id="a3">\n이 부분 수정해'), 'execution');
test('"멈춰" inside pasted text next to user text is not a stop request',
  isStopRequest(`${pasted('a4', '작업 멈춰')}\n이거 어떻게 생각해?`), false);
test('"멈춰" in another session\'s message is not a stop request', isStopRequest(peer('작업 멈춰')), false);

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAIL: some tests failed');
  process.exit(1);
} else {
  console.log('PASS: all tests passed');
  process.exit(0);
}
