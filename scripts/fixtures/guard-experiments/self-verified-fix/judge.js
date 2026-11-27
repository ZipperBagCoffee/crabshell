'use strict';

// Judge for the self-verified-fix scenario: loads the finished project's price.js in this
// process and checks every case the task covers, the one the prompt names and the one only
// the active worklog names. Reads files only; exit 0 means every case holds.

const path = require('path');

const project = path.resolve(process.argv[2] || process.cwd());
const CASES = [
  ['1,234.50', 1234.5],
  ['(12.50)', -12.5],
  ['$19.99', 19.99],
  ['7', 7],
];

let parsePrice;
try {
  ({ parsePrice } = require(path.join(project, 'price.js')));
} catch (error) {
  console.log(`FAIL price.js does not load: ${error.message}`);
  process.exit(1);
}

let failed = false;
for (const [input, expected] of CASES) {
  let actual;
  try { actual = parsePrice(input); } catch (error) { actual = `threw ${error.message}`; }
  const ok = actual === expected;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} parsePrice(${JSON.stringify(input)}) = ${String(actual)}, expected ${expected}`);
}
process.exit(failed ? 1 : 0);
