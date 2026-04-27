'use strict';

/**
 * _test-simple-clause-update.js — D105 P137_T002 AC2
 *
 * Locks the Simple Communication §4.simple sub-clause structure in
 * `prompts/behavior-verifier-prompt.md` so refactors cannot silently regress
 * to the analogy-based wording removed in T001.
 *
 * Scope (per ticket): §4.simple section body — 4 sub-clauses + Key composition
 * directive + analogy=0 negative.
 *
 * This is L3 (structural grep). Behavioral verification of the verifier
 * sub-agent FAIL emission on missing markers belongs in cycle 3+ scope.
 */

const fs = require('fs');
const path = require('path');

const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'behavior-verifier-prompt.md');

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

// Edge case: missing file → descriptive failure, not crash.
if (!fs.existsSync(PROMPT_PATH)) {
  console.error('FAIL: behavior-verifier-prompt.md not found at ' + PROMPT_PATH);
  console.error('      cannot evaluate §4.simple sub-clause structure');
  process.exit(1);
}

const text = fs.readFileSync(PROMPT_PATH, 'utf8');

// Locate §4.simple body (from `### 4. simple` to `## Output Format`).
const start = text.indexOf('### 4. simple');
const end = text.indexOf('## Output Format');
if (start < 0 || end <= start) {
  console.error('FAIL: §4.simple section boundaries not found');
  console.error('      start=' + start + ' end=' + end);
  process.exit(1);
}
const sec4 = text.slice(start, end);

// ---------- Test 1 — sub-clause "Reader's words" present ----------
ok('1 §4.simple sub-clause "Reader\'s words" present',
   /Reader's words/i.test(sec4),
   'sec4 length=' + sec4.length);

// ---------- Test 2 — sub-clause "Conclusion first" present ----------
ok('2 §4.simple sub-clause "Conclusion first" present',
   /Conclusion first/i.test(sec4));

// ---------- Test 3 — sub-clause "Concrete over abstract" present ----------
ok('3 §4.simple sub-clause "Concrete over abstract" present',
   /Concrete over abstract/i.test(sec4));

// ---------- Test 4 — sub-clause "No self-coined acronyms" present ----------
ok('4 §4.simple sub-clause "No self-coined acronyms" present',
   /No self-coined/i.test(sec4));

// ---------- Test 5 — Key composition directive present ----------
ok('5 §4.simple "Key composition directive" present',
   /Key composition directive/i.test(sec4));

// ---------- Test 6 — "AND across" composition rule present ----------
ok('6 §4.simple "AND across" composition rule present',
   /AND across/i.test(sec4));

// ---------- Test 7 — Sub-clauses fold into single key directive present ----------
ok('7 §4.simple "fold" into single key directive present',
   /fold/i.test(sec4));

// ---------- Test 8 — analogy = 0 (negative regression guard) ----------
const analogyMatches = (sec4.match(/analogy/gi) || []).length;
ok('8 §4.simple contains zero "analogy" tokens (regression guard)',
   analogyMatches === 0,
   'found ' + analogyMatches + ' analogy tokens in §4.simple');

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
