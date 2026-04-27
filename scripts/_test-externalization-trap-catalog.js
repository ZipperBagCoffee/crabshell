'use strict';

/**
 * _test-externalization-trap-catalog.js — D105 P137_T002 AC2
 *
 * Locks the structure of `prompts/anti-patterns.md` (Externalization Trap
 * Catalog + Avoidance Pattern History) so future edits cannot silently regress
 * the catalog count or the anchor reference back into RULES PROHIBITED #9.
 *
 * Scope (per ticket):
 *   - file exists
 *   - frontmatter contains type / id / title / tags
 *   - 7 TRAP-N headings (### TRAP-1 .. ### TRAP-7)
 *   - 4 AVOID-N headings (### AVOID-1 .. ### AVOID-4)
 *   - "Externalization Trap Catalog" + "Avoidance Pattern History" headings
 *   - RULES anchor reference (scripts/inject-rules.js · RULES · PROHIBITED #9)
 *
 * L3 (structural grep) only. Cross-file invariant ↔ inject-rules.js RULES is
 * checked in `_test-inject-rules.js` (PROHIBITED #9 references the file path).
 */

const fs = require('fs');
const path = require('path');

const ANTIPATTERNS_PATH = path.join(__dirname, '..', 'prompts', 'anti-patterns.md');

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) { console.log('PASS: ' + name); passed++; }
  else { console.log('FAIL: ' + name + (detail ? ' -- ' + detail : '')); failed++; }
}

// Edge case: missing file → descriptive failure, not crash.
if (!fs.existsSync(ANTIPATTERNS_PATH)) {
  console.error('FAIL: prompts/anti-patterns.md not found at ' + ANTIPATTERNS_PATH);
  console.error('      cannot evaluate Externalization Trap Catalog structure');
  process.exit(1);
}

const text = fs.readFileSync(ANTIPATTERNS_PATH, 'utf8');
const lines = text.split(/\r?\n/);

// ---------- Test 1 — File exists with non-empty content ----------
ok('1 prompts/anti-patterns.md exists with content',
   text.length > 100,
   'file length=' + text.length);

// ---------- Test 2 — Frontmatter delimiters (lines 1 + a closing ---) ----------
// Frontmatter window: lines 1..N where N is the second '---' line.
const frontmatterClose = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
ok('2 frontmatter has open + close delimiters',
   lines[0].trim() === '---' && frontmatterClose > 0,
   'open=' + (lines[0] && lines[0].trim()) + ' close_idx=' + frontmatterClose);

// ---------- Test 3 — Frontmatter contains type/id/title/tags ----------
const frontmatter = lines.slice(0, frontmatterClose + 1).join('\n');
const hasType = /^type\s*:/m.test(frontmatter);
const hasId = /^id\s*:/m.test(frontmatter);
const hasTitle = /^title\s*:/m.test(frontmatter);
const hasTags = /^tags\s*:/m.test(frontmatter);
ok('3 frontmatter contains type / id / title / tags',
   hasType && hasId && hasTitle && hasTags,
   'type=' + hasType + ' id=' + hasId + ' title=' + hasTitle + ' tags=' + hasTags);

// ---------- Test 4 — Exactly 7 TRAP-N headings ----------
// Multiline regex: ^### TRAP-[1-7] [— -]
const trapMatches = (text.match(/^### TRAP-[1-7]\b/gm) || []);
ok('4 exactly 7 ### TRAP-N headings (1..7)',
   trapMatches.length === 7,
   'found ' + trapMatches.length + ' TRAP headings: ' + trapMatches.join(' | '));

// ---------- Test 5 — Exactly 4 AVOID-N headings ----------
const avoidMatches = (text.match(/^### AVOID-[1-4]\b/gm) || []);
ok('5 exactly 4 ### AVOID-N headings (1..4)',
   avoidMatches.length === 4,
   'found ' + avoidMatches.length + ' AVOID headings: ' + avoidMatches.join(' | '));

// ---------- Test 6 — "Externalization Trap Catalog" heading present ----------
ok('6 "Externalization Trap Catalog" heading present',
   /Externalization Trap Catalog/.test(text));

// ---------- Test 7 — "Avoidance Pattern History" heading present ----------
ok('7 "Avoidance Pattern History" heading present',
   /Avoidance Pattern History/.test(text));

// ---------- Test 8 — RULES anchor reference present ----------
// Contract: anti-patterns.md must reference its anchor in scripts/inject-rules.js
// RULES PROHIBITED PATTERNS #9 (Default-First). Without this back-reference the
// cross-file invariant breaks silently.
const hasInjectAnchor = /scripts\/inject-rules\.js/.test(text);
const hasRulesAnchor = /RULES/.test(text);
const hasProhibitedAnchor = /PROHIBITED PATTERNS\s*#?9|PROHIBITED\s*#9/i.test(text)
  || /Default-First/.test(text);
ok('8 RULES PROHIBITED #9 anchor reference present',
   hasInjectAnchor && hasRulesAnchor && hasProhibitedAnchor,
   'inject=' + hasInjectAnchor + ' rules=' + hasRulesAnchor + ' #9=' + hasProhibitedAnchor);

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exit(failed > 0 ? 1 : 0);
