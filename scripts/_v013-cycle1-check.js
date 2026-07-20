'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_DIR = path.resolve(__dirname, '..');

function read(rel) {
  try {
    return fs.readFileSync(path.join(PROJECT_DIR, rel), 'utf8');
  } catch (e) {
    return null;
  }
}

const ir = read('scripts/inject-rules.js') || '';
const sc = read('scripts/shared-context.js') || '';
const ap = read('prompts/anti-patterns.md');

const rulesStart = ir.indexOf('const RULES');
const rulesEnd = ir.indexOf('const COMPRESSED_CHECKLIST');
const rules = (rulesStart >= 0 && rulesEnd > rulesStart) ? ir.slice(rulesStart, rulesEnd) : '';

const tests = [];
function add(n, p) { tests.push({ n, p: !!p }); }

// analogy=0 in the two active rule surfaces
add('analogy=0 RULES', !/analogy/i.test(rules));
add('analogy=0 shared-context', !/analogy/i.test(sc));

// 4 concept regex (loose patterns to handle file-specific phrasings)
const concepts = [
  ['reader-words', /reader.?s? words?/i],
  ['conclusion-first', /lead.?s? with the (?:conclusion|answer)|conclusion first|answer .+follows/i],
  ['concrete-vs-abstract', /concrete[\s\S]{0,80}over abstract/i],
  ['self-coined', /self.?coined/i],
];

[['RULES', rules], ['CHECKLIST', sc]].forEach(([name, text]) => {
  concepts.forEach(([cName, re]) => {
    add(cName + ' in ' + name, re.test(text));
  });
});

// anti-patterns.md structure
add('anti-patterns.md exists', ap !== null);
if (ap) {
  add('frontmatter type', /^type:/m.test(ap));
  add('frontmatter id', /^id:/m.test(ap));
  add('frontmatter title', /^title:/m.test(ap));
  add('frontmatter tags', /^tags:/m.test(ap));
  add('7 TRAPs', (ap.match(/^### TRAP-[1-7]/gm) || []).length === 7);
  add('4 AVOIDs', (ap.match(/^### AVOID-[1-4]/gm) || []).length === 4);
}

// RULES PROHIBITED #9 anchor
add('Default-First in RULES', ir.includes('Default-First'));
add('anti-patterns.md anchor in RULES', ir.includes('prompts/anti-patterns.md'));

const failed = tests.filter(t => !t.p);
if (failed.length === 0) {
  console.log('PASS:V013-cycle1');
  process.exit(0);
} else {
  console.log('FAIL:' + failed.map(t => t.n).join('|'));
  process.exit(1);
}
