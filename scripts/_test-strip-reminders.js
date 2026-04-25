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
    name: '(b) plain user NEG (Korean "다시 해")',
    input: '다시 해', // 다시 해
    expected: true,
  },
  {
    name: '(c) reminder ONLY containing NEG words → must NOT trigger',
    input: '<system-reminder>error wrong break incorrect try again</system-reminder>',
    expected: false,
  },
  {
    name: '(d) reminder w/ NEG + real user NEG outside → must trigger on user part',
    input: '<system-reminder>error</system-reminder>다시 해', // 다시 해
    expected: true,
  },
  {
    name: '(e) two reminder blocks around neutral text',
    input: '<system-reminder>x error</system-reminder>just a normal request<system-reminder>y wrong</system-reminder>',
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
