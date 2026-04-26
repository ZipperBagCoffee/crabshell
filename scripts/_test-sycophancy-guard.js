// Comprehensive sycophancy-guard.js test
//
// D103 cycle 1 (P134_T001): the 4 Stop branches (context-length / too-good /
// oscillation / agreement) were converted from decision:'block' + exit(2) to
// warn-only [BEHAVIOR-WARN] stderr + exit(0). Tests that previously asserted
// "BLOCK" for these branches now use runTestWarn() — exit 0 + [BEHAVIOR-WARN]
// in stderr + no decision:'block' in stdout. PreToolUse mid-tool blocking
// (Write/Edit guard) and the protected-zone ALLOW path are preserved as-is.
const { spawnSync } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'sycophancy-guard.js');
const nodePath = process.execPath;

let passed = 0;
let failed = 0;

function runGuard(hookData) {
  const input = hookData === null || hookData === undefined ? '' : JSON.stringify(hookData);
  const result = spawnSync(nodePath, [scriptPath], {
    input, timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

// Legacy block-or-allow: still used for ALLOW assertions and the PreToolUse
// branch (which retains exit(2) on Write/Edit mid-turn agreement).
function runTest(name, hookData, expectBlock) {
  const { exitCode, stdout, stderr } = runGuard(hookData);
  if (expectBlock) {
    if (exitCode === 2) {
      console.log(`PASS: ${name} -- blocked (exit 2)`);
      passed++;
    } else {
      console.log(`FAIL: ${name} -- expected block but got allow (exit ${exitCode})`);
      failed++;
    }
  } else {
    if (exitCode === 0) {
      console.log(`PASS: ${name} -- allowed (exit 0)`);
      passed++;
    } else if (exitCode === 2) {
      console.log(`FAIL: ${name} -- expected allow but got block. stdout: ${stdout}`);
      failed++;
    } else {
      console.log(`FAIL: ${name} -- unexpected exit ${exitCode}`);
      failed++;
    }
  }
}

// D103 cycle 1: warn-only assertion for the 4 absorbed Stop branches.
// Expects exit 0 + [BEHAVIOR-WARN] in stderr + no decision:'block' JSON.
function runTestWarn(name, hookData) {
  const { exitCode, stdout, stderr } = runGuard(hookData);
  const exitedZero = exitCode === 0;
  const hasWarning = stderr.includes('[BEHAVIOR-WARN]');
  const noBlockJson = !stdout.includes('"decision":"block"') && !stdout.includes('"decision": "block"');
  if (exitedZero && hasWarning && noBlockJson) {
    console.log(`PASS: ${name} -- warn-only (exit 0 + [BEHAVIOR-WARN])`);
    passed++;
  } else {
    console.log(`FAIL: ${name} -- expected exit 0 + [BEHAVIOR-WARN] + no block JSON. exit=${exitCode} hasWarning=${hasWarning} noBlockJson=${noBlockJson}`);
    if (stdout.trim()) console.log(`  stdout: ${stdout.trim().substring(0, 300)}`);
    if (stderr.trim()) console.log(`  stderr: ${stderr.trim().substring(0, 300)}`);
    failed++;
  }
}

// Helper: pad response to exceed minimum length
function pad(text, minLen = 250) {
  if (text.length >= minLen) return text;
  return text + '\n' + 'x'.repeat(minLen - text.length);
}

// ====================================================================
// Test 1: Bare sycophancy Korean (padded) -> WARN (was BLOCK)
// D103 cycle 1: agreement Stop branch warn-only.
// ====================================================================
runTestWarn('Bare sycophancy Korean -> WARN',
  { stop_response: pad('맞습니다. 그 부분은 제가 잘못 이해했습니다.') }
);

// ====================================================================
// Test 2: Bare sycophancy English (padded) -> WARN (was BLOCK)
// D103 cycle 1: agreement Stop branch warn-only.
// ====================================================================
runTestWarn('Bare sycophancy English -> WARN',
  { stop_response: pad("You're right, I should have checked that first.") }
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
// Test 7: 500+ chars 'A' padding + "I agree" -> WARN (was BLOCK)
// Padding is NOT evidence (no behavioral or structural content).
// D103 cycle 1: agreement Stop branch warn-only.
// ====================================================================
runTestWarn('500+ chars A padding + I agree -> WARN',
  { stop_response: 'A'.repeat(550) + "\nI agree with your assessment." }
);

// ====================================================================
// Test 8: Short response "You're right." -> WARN (was BLOCK)
// 100-char exemption removed; sycophancy detected regardless of length.
// D103 cycle 1: agreement Stop branch warn-only.
// ====================================================================
runTestWarn('Short response sycophancy -> WARN',
  { stop_response: "You're right." }
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
// Test 11: Mixed - real sycophancy outside + pattern in code block -> WARN
// D103 cycle 1: agreement Stop branch warn-only.
// ====================================================================
runTestWarn('Real sycophancy outside + pattern in code -> WARN',
  { stop_response: pad("Good point! Here is the code:\n```\n// good point example\n```\nLet me check.") }
);

// ====================================================================
// Test 12: Code block is STRUCTURAL not behavioral -> WARN (was BLOCK)
// D103 cycle 1: agreement Stop branch warn-only.
// ====================================================================
runTestWarn('Agreement after structural code block -> WARN',
  { stop_response: pad("Here is the analysis:\n```javascript\nconst result = calculateSum(items.map(i => i.value).filter(v => v > 0));\nconsole.log(result); // outputs: 42\n```\nI agree, the implementation is correct.") }
);

// ====================================================================
// Test 13: Korean 분석 결과 is STRUCTURAL not behavioral -> WARN (was BLOCK)
// D103 cycle 1: agreement Stop branch warn-only.
// ====================================================================
runTestWarn('Agreement after structural Korean marker -> WARN',
  { stop_response: pad('분석 결과를 보면 다음과 같습니다:\n- 항목 1: 정상\n- 항목 2: 정상\n\n맞습니다, 모든 항목이 정상입니다.') }
);

// ====================================================================
// Test 14: Grep-style output is STRUCTURAL not behavioral -> WARN (was BLOCK)
// D103 cycle 1: agreement Stop branch warn-only.
// ====================================================================
runTestWarn('Agreement after structural grep output -> WARN',
  { stop_response: pad('src/utils.js:42: const validate = (x) => x > 0;\nsrc/utils.js:43: export default validate;\n\nYou\'re right, the function exists.') }
);

// ====================================================================
// Test 15: Markdown table separator is STRUCTURAL not behavioral -> WARN
// D103 cycle 1: agreement Stop branch warn-only.
// ====================================================================
runTestWarn('Agreement after structural markdown table -> WARN',
  { stop_response: pad('| Column A | Column B |\n|----------|----------|\n| value1   | value2   |\n\nThat makes sense based on these results.') }
);

// ====================================================================
// Test 16: Bare Korean sycophancy "좋은 지적" -> WARN (was BLOCK)
// D103 cycle 1: agreement Stop branch warn-only.
// ====================================================================
runTestWarn('Bare Korean sycophancy "좋은 지적" -> WARN',
  { stop_response: pad('좋은 지적이네요. 그 부분을 수정하겠습니다.') }
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
// Test 19: Early sycophancy + late code block -> WARN (was BLOCK)
// Key regression test: evidence AFTER agreement should NOT exempt — pattern
// is still detected, but D103 cycle 1 makes the agreement branch warn-only.
// ====================================================================
runTestWarn('Early sycophancy + late code block -> WARN',
  { stop_response: pad("You're right! Let me fix that for you.\n\n" +
    "```javascript\nconst result = calculateSum(items.map(i => i.value).filter(v => v > 0));\nconsole.log(result);\n```") }
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
// Context-length deferral tests (TC_CL1 - TC_CL4)
// ====================================================================

// TC_CL1: Korean context-length pattern → WARN (was BLOCK)
// D103 cycle 1: context-length Stop branch warn-only.
runTestWarn('TC_CL1: Korean context-length "세션이 너무 길어서 멈추겠습니다" -> WARN',
  { stop_response: pad('세션이 너무 길어서 멈추겠습니다. 다음 세션에서 계속하겠습니다.') }
);

// TC_CL2: English context-length pattern → WARN (was BLOCK)
// D103 cycle 1: context-length Stop branch warn-only.
runTestWarn('TC_CL2: English context-length "context limit reached, stopping here" -> WARN',
  { stop_response: pad('The context limit reached, stopping here. Please start a new session to continue.') }
);

// TC_CL3: Normal response mentioning "context" as a variable → ALLOW (false positive check)
runTest('TC_CL3: Normal response with "context" variable reference -> ALLOW',
  { stop_response: pad('The context variable is initialized at the start of the function. Let me trace through the code to find where the context is modified.') },
  false
);

// TC_CL4: Context-length phrase inside code block → ALLOW (protected zone)
runTest('TC_CL4: Context-length phrase inside code block -> ALLOW',
  { stop_response: pad('Here is the code:\n```javascript\n// session too long warning message\nconst warn = "session too long";\n```\nThe implementation looks correct.') },
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
