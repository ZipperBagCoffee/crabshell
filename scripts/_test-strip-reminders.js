// L1 verification probe for stripSystemReminders + detectNegativeFeedback
// Run: "C:/Program Files/nodejs/node.exe" scripts/_test-strip-reminders.js
const path = require('path');
const { stripSystemReminders, detectNegativeFeedback } = require(path.join(__dirname, 'inject-rules.js'));

const cases = [
  {
    name: '(a) plain prompt, no NEG, no reminder',
    input: 'hello can you read the file please',
    expected: false,
  },
  {
    name: '(b) plain user profanity (W021: Korean "시발")',
    input: '시발 짜증나',
    expected: true,
  },
  {
    name: '(c) reminder ONLY containing profanity-substring → must NOT trigger',
    input: '<system-reminder>shit fuck damn</system-reminder>',
    expected: false,
  },
  {
    name: '(d) reminder w/ profanity-substring + real user profanity outside → must trigger on user part',
    input: '<system-reminder>shit</system-reminder>시발 짜증나',
    expected: true,
  },
  {
    name: '(e) two reminder blocks around neutral text',
    input: '<system-reminder>x fuck</system-reminder>just a normal request<system-reminder>y shit</system-reminder>',
    expected: false,
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const stripped = stripSystemReminders(c.input);
  const got = detectNegativeFeedback(c.input);
  const ok = got === c.expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}`);
  console.log(`     input    : ${JSON.stringify(c.input)}`);
  console.log(`     stripped : ${JSON.stringify(stripped)}`);
  console.log(`     expected : ${c.expected}`);
  console.log(`     got      : ${got}`);
}
console.log(`\nResult: ${pass}/${cases.length} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
