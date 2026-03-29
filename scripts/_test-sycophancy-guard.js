// Comprehensive sycophancy-guard.js test
const { execSync } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'sycophancy-guard.js');
const nodePath = process.execPath;

let passed = 0;
let failed = 0;

function runTest(name, hookData, expectBlock) {
  const json = JSON.stringify(hookData);
  try {
    const result = execSync(
      `"${nodePath}" "${scriptPath}"`,
      {
        input: json,
        timeout: 5000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );
    if (expectBlock) {
      console.log(`FAIL: ${name} -- expected block but got allow`);
      failed++;
    } else {
      console.log(`PASS: ${name} -- allowed (exit 0)`);
      passed++;
    }
  } catch (e) {
    if (e.status === 2 && expectBlock) {
      console.log(`PASS: ${name} -- blocked (exit 2)`);
      passed++;
    } else if (e.status === 2 && !expectBlock) {
      console.log(`FAIL: ${name} -- expected allow but got block. stdout: ${e.stdout}`);
      failed++;
    } else {
      console.log(`FAIL: ${name} -- unexpected exit ${e.status}`);
      failed++;
    }
  }
}

// Helper: pad response to exceed minimum length
function pad(text, minLen = 250) {
  if (text.length >= minLen) return text;
  return text + '\n' + 'x'.repeat(minLen - text.length);
}

// ====================================================================
// Test 1: Bare sycophancy Korean (padded) -> BLOCK
// ====================================================================
runTest('Bare sycophancy Korean -> BLOCK',
  { stop_response: pad('맞습니다. 그 부분은 제가 잘못 이해했습니다.') },
  true
);

// ====================================================================
// Test 2: Bare sycophancy English (padded) -> BLOCK
// ====================================================================
runTest('Bare sycophancy English -> BLOCK',
  { stop_response: pad("You're right, I should have checked that first.") },
  true
);

// ====================================================================
// Test 3: Pattern inside fenced code block -> ALLOW
// ====================================================================
runTest('Pattern inside fenced code block -> ALLOW',
  { stop_response: pad('Here is the code:\n```javascript\n// you\'re right about this\nconst x = 1;\n```\nDone.') },
  false
);

// ====================================================================
// Test 4: Pattern inside inline code -> ALLOW
// ====================================================================
runTest('Pattern inside inline code -> ALLOW',
  { stop_response: pad('The function `i agree` is defined in utils.js. Let me check the implementation details for you now.') },
  false
);

// ====================================================================
// Test 5: Pattern inside blockquote -> ALLOW
// ====================================================================
runTest('Pattern inside blockquote -> ALLOW',
  { stop_response: pad('From the documentation:\n> You\'re right to use this pattern\nLet me explain further.') },
  false
);

// ====================================================================
// Test 6: Agreement after P/O/G table -> ALLOW (behavioral evidence)
// ====================================================================
runTest('Agreement after P/O/G table -> ALLOW',
  { stop_response: pad('| Item | Prediction | Observation |\n|------|------------|-------------|\n| A | yes | yes |\n\nYou\'re right, the results match.') },
  false
);

// ====================================================================
// Test 7: 500+ chars 'A' padding + "I agree" -> BLOCK
// Padding is NOT evidence (no behavioral or structural content)
// ====================================================================
runTest('500+ chars A padding + I agree -> BLOCK',
  { stop_response: 'A'.repeat(550) + "\nI agree with your assessment." },
  true
);

// ====================================================================
// Test 8: Short response "You're right." -> BLOCK
// 100-char exemption removed; sycophancy detected regardless of length
// ====================================================================
runTest('Short response sycophancy -> BLOCK',
  { stop_response: "You're right." },
  true
);

// ====================================================================
// Test 9: No sycophancy pattern -> ALLOW
// ====================================================================
runTest('No sycophancy pattern -> ALLOW',
  { stop_response: pad('I have reviewed the code and found no issues. The implementation is correct based on the test results.') },
  false
);

// ====================================================================
// Test 10: Korean pattern in code block -> ALLOW
// ====================================================================
runTest('Korean in code block -> ALLOW',
  { stop_response: pad('코드를 확인했습니다:\n```\n// 맞습니다 - 이 함수는 올바르게 작동합니다\nfunction test() { return true; }\n```\n완료.') },
  false
);

// ====================================================================
// Test 11: Mixed - real sycophancy outside + pattern in code block -> BLOCK
// ====================================================================
runTest('Real sycophancy outside + pattern in code -> BLOCK',
  { stop_response: pad("Good point! Here is the code:\n```\n// good point example\n```\nLet me check.") },
  true
);

// ====================================================================
// Test 12: Code block is STRUCTURAL not behavioral -> BLOCK
// ====================================================================
runTest('Agreement after structural code block -> BLOCK',
  { stop_response: pad("Here is the analysis:\n```javascript\nconst result = calculateSum(items.map(i => i.value).filter(v => v > 0));\nconsole.log(result); // outputs: 42\n```\nI agree, the implementation is correct.") },
  true
);

// ====================================================================
// Test 13: Korean 분석 결과 is STRUCTURAL not behavioral -> BLOCK
// ====================================================================
runTest('Agreement after structural Korean marker -> BLOCK',
  { stop_response: pad('분석 결과를 보면 다음과 같습니다:\n- 항목 1: 정상\n- 항목 2: 정상\n\n맞습니다, 모든 항목이 정상입니다.') },
  true
);

// ====================================================================
// Test 14: Grep-style output is STRUCTURAL not behavioral -> BLOCK
// ====================================================================
runTest('Agreement after structural grep output -> BLOCK',
  { stop_response: pad('src/utils.js:42: const validate = (x) => x > 0;\nsrc/utils.js:43: export default validate;\n\nYou\'re right, the function exists.') },
  true
);

// ====================================================================
// Test 15: Markdown table separator is STRUCTURAL not behavioral -> BLOCK
// ====================================================================
runTest('Agreement after structural markdown table -> BLOCK',
  { stop_response: pad('| Column A | Column B |\n|----------|----------|\n| value1   | value2   |\n\nThat makes sense based on these results.') },
  true
);

// ====================================================================
// Test 16: Bare Korean sycophancy "좋은 지적" -> BLOCK
// ====================================================================
runTest('Bare Korean sycophancy "좋은 지적" -> BLOCK',
  { stop_response: pad('좋은 지적이네요. 그 부분을 수정하겠습니다.') },
  true
);

// ====================================================================
// Test 17: No data (fail-open) -> ALLOW
// ====================================================================
runTest('No data (fail-open) -> ALLOW',
  null,
  false
);

// ====================================================================
// Test 18: stop_hook_active -> ALLOW
// ====================================================================
runTest('stop_hook_active -> ALLOW',
  { stop_hook_active: true, stop_response: pad("You're right, absolutely.") },
  false
);

// ====================================================================
// Test 19: Early sycophancy + late code block -> BLOCK
// Key regression test: evidence AFTER agreement should NOT exempt
// ====================================================================
runTest('Early sycophancy + late code block -> BLOCK',
  { stop_response: pad("You're right! Let me fix that for you.\n\n" +
    "```javascript\nconst result = calculateSum(items.map(i => i.value).filter(v => v > 0));\nconsole.log(result);\n```") },
  true
);

// ====================================================================
// Test 20: PreToolUse - tool_name=Read -> ALLOW (only Write|Edit checked)
// ====================================================================
runTest('PreToolUse Read tool -> ALLOW',
  { tool_name: 'Read', tool_input: { file_path: '/tmp/test.txt' } },
  false
);

// ====================================================================
// Test 21: PreToolUse - tool_name=Write without transcript -> ALLOW (fail-open)
// ====================================================================
runTest('PreToolUse Write without transcript -> ALLOW (fail-open)',
  { tool_name: 'Write', tool_input: { file_path: '/tmp/test.txt', content: 'hello' } },
  false
);

// ====================================================================
// Summary
// ====================================================================
console.log(`\n========================================`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
console.log(`========================================`);
if (failed > 0) {
  process.exit(1);
}
