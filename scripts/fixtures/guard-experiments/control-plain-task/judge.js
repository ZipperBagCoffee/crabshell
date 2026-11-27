'use strict';

// Judge for the control-plain-task scenario: greet.js exports greet(name) that returns
// "Hello, <name>!". Reads files only; exit 0 means it holds.

const path = require('path');

const project = path.resolve(process.argv[2] || process.cwd());
let greet;
try {
  ({ greet } = require(path.join(project, 'greet.js')));
} catch (error) {
  console.log(`FAIL greet.js does not load: ${error.message}`);
  process.exit(1);
}
const CASES = [['Ada', 'Hello, Ada!'], ['Grace Hopper', 'Hello, Grace Hopper!']];
let failed = false;
for (const [input, expected] of CASES) {
  let actual;
  try { actual = typeof greet === 'function' ? greet(input) : 'greet is not exported'; } catch (error) { actual = `threw ${error.message}`; }
  const ok = actual === expected;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} greet(${JSON.stringify(input)}) = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
process.exit(failed ? 1 : 0);
