'use strict';

/**
 * Tests for classifyUserIntent() in inject-rules.js
 */

const { classifyUserIntent, DEFAULT_NO_EXECUTION, EXECUTION_JUDGMENT } = require('./inject-rules');

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

// Default (non-execution) patterns
test('"설명해줘" → default', classifyUserIntent('설명해줘'), 'default');
test('"뭐야?" → default', classifyUserIntent('뭐야?'), 'default');
test('"what is this" → default', classifyUserIntent('what is this'), 'default');
test('"explain the code" → default', classifyUserIntent('explain the code'), 'default');
test('"how does this work" → default', classifyUserIntent('how does this work'), 'default');

// Edge cases (AC13)
test('"" → default', classifyUserIntent(''), 'default');
test('null → default', classifyUserIntent(null), 'default');
test('undefined → default', classifyUserIntent(undefined), 'default');

console.log('--- Constants present ---');
test('DEFAULT_NO_EXECUTION defined', typeof DEFAULT_NO_EXECUTION, 'string');
test('DEFAULT_NO_EXECUTION non-empty', DEFAULT_NO_EXECUTION.length > 0, true);
test('EXECUTION_JUDGMENT defined', typeof EXECUTION_JUDGMENT, 'string');
test('EXECUTION_JUDGMENT non-empty', EXECUTION_JUDGMENT.length > 0, true);

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAIL: some tests failed');
  process.exit(1);
} else {
  console.log('PASS: all tests passed');
  process.exit(0);
}
