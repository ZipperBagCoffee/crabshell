'use strict';
// D145_T002: the skill texts match what the plugin does now: the plan's design lines
// (plan-entry DESIGN_FIELDS) are in both discussing texts, and the verifying skill names the
// manifest fields and runner switches. D168: checks that retired wording stays out were
// removed (they watched old text, not what the plugin does).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DESIGN_FIELDS } = require('./core/plan-entry');
const { ENTRY_SETTINGS } = require('../skills/verifying/scripts/runner/manifest');
const { MANIFEST_SETTINGS } = require('../skills/verifying/scripts/runner/settings');

const REPO = path.join(__dirname, '..');
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS: ${name}`); }
  catch (error) { failed++; console.log(`FAIL: ${name}: ${String(error.message).split('\n')[0]}`); }
}
function markdownFiles(dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...markdownFiles(full));
    else if (item.name.endsWith('.md')) out.push(full);
  }
  return out;
}
const skillFiles = ['skills', 'codex-skills'].flatMap(dir => markdownFiles(path.join(REPO, dir)));
const read = rel => fs.readFileSync(path.join(REPO, rel), 'utf8');
const rel = file => path.relative(REPO, file).replace(/\\/g, '/');

test('both discussing texts carry every design line of the plan', () => {
  const claude = read('skills/discussing/SKILL.md');
  const codex = read('codex-skills/discussing/SKILL.md');
  const missing = [];
  for (const field of DESIGN_FIELDS) {
    if (!claude.includes(`**${field}:**`)) missing.push(`skills/discussing/SKILL.md template: ${field}`);
    if (!codex.includes(field)) missing.push(`codex-skills/discussing/SKILL.md: ${field}`);
  }
  assert.deepStrictEqual(missing, []);
});

test('ticketing and regressing texts say a new ticket needs the design lines', () => {
  const missing = ['skills/ticketing/SKILL.md', 'skills/regressing/SKILL.md', 'codex-skills/ticketing/SKILL.md', 'codex-skills/regressing/SKILL.md']
    .filter(file => !/design lines/i.test(read(file)));
  assert.deepStrictEqual(missing, []);
});

test('the verifying skill documents every manifest and entry setting the runner accepts', () => {
  const docs = ['skills/verifying/SKILL.md', ...fs.readdirSync(path.join(REPO, 'skills/verifying/references')).map(name => `skills/verifying/references/${name}`)]
    .map(read).join('\n');
  const names = [...Object.keys(MANIFEST_SETTINGS), ...Object.keys(ENTRY_SETTINGS)];
  assert.ok(names.length > 5, `only ${names.length} settings found`);
  // Named in code form or as a JSON key of an example.
  assert.deepStrictEqual(names.filter(name => !docs.includes('`' + name + '`') && !docs.includes('"' + name + '"')), []);
});

// The switches D143 added, whose spelling is the contract: the runner flag and the hook's escape.
test('the verifying skill names --explain and CRABSHELL_RERUN=1', () => {
  const text = read('skills/verifying/SKILL.md');
  assert.deepStrictEqual(['`--explain`', '`CRABSHELL_RERUN=1`'].filter(term => !text.includes(term)), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
