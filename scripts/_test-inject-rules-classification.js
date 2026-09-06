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

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAIL: some tests failed');
  process.exit(1);
} else {
  console.log('PASS: all tests passed');
  process.exit(0);
}
