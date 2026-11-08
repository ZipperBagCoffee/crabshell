'use strict';
// D119 P180: each shared value or helper has one definition in shipped code.
// Scope: scripts/**/*.js that ship, minus tests, fixtures, and the Claude compaction
// scripts that are no longer wired (tests still run them).
const fs = require('fs');
const path = require('path');
const h = require('./testlib/hook-harness');

const report = h.createReporter('single-source');
const SCRIPTS = __dirname;
// The modules that hold shared values. constants.js keeps the storage names; the
// other values live by subject (D151_T007), so a change to one subject does not
// select every check that reads constants.js.
const VALUE_MODULES = ['constants.js', 'core/doc-types.js', 'core/limits.js', 'core/memory-budgets.js'];
const values = new Map(VALUE_MODULES.map(file => [file, require(path.join(SCRIPTS, file))]));
const RETIRED = new Set(['post-compact.js', 'pre-compact.js']);
const rel = file => path.relative(SCRIPTS, file).replace(/\\/g, '/');

function shipped({ includeRetired = false } = {}) {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!['fixtures', 'testlib', 'node_modules'].includes(entry.name)) walk(full); continue; }
      if (!/\.js$/.test(entry.name) || /^_test-|^_v0/.test(entry.name)) continue;
      if (!includeRetired && dir === SCRIPTS && RETIRED.has(entry.name)) continue;
      files.push(full);
    }
  };
  walk(SCRIPTS);
  return files;
}
const files = shipped();
const text = new Map(files.map(file => [file, fs.readFileSync(file, 'utf8')]));
const isComment = line => /^\s*(\/\/|\*|\/\*)/.test(line);
function hits(test, { except = [] } = {}) {
  const found = [];
  for (const [file, body] of text) {
    if (except.includes(rel(file))) continue;
    body.split('\n').forEach((line, index) => { if (!isComment(line) && test(line)) found.push(`${rel(file)}:${index + 1}`); });
  }
  return found;
}
const show = list => `${list.length} — ${list.slice(0, 40).join(" ")}`;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Scope evidence (AC-3): retired scripts are out, skill-facing scripts are in.
const names = new Set(files.map(rel));
report.check('S0 scan scope excludes the retired scripts and includes the document tools',
  [...RETIRED].every(name => !names.has(name)) && ['codex-docs.js', 'search-docs.js', 'lint-obsidian.js'].every(name => names.has(name)),
  `scanned files=${files.length}`);
console.log(`scanned files: ${[...names].sort().join(' ')}`);

// S1: every value-module key is read outside its module (retired scripts count as
// readers so removing a key never breaks a file that is still on disk).
{
  const all = shipped({ includeRetired: true });
  const unused = [];
  for (const [owner, exported] of values) {
    const readers = all.filter(file => rel(file) !== owner).map(file => fs.readFileSync(file, 'utf8'));
    for (const key of Object.keys(exported)) if (!readers.some(body => new RegExp(`\\b${key}\\b`).test(body))) unused.push(`${owner}:${key}`);
  }
  report.check('S1 the value modules have no unused keys', unused.length === 0, show(unused));
}
// S2: a string constant's value is not retyped as a literal outside its module.
{
  const found = [];
  for (const [owner, exported] of values) {
    for (const [key, value] of Object.entries(exported)) {
      if (typeof value !== 'string' || value.length < 6 || !/[.\-]/.test(value)) continue;
      const literal = new RegExp(`['"\`]${escape(value)}['"\`]`);
      for (const hit of hits(line => literal.test(line), { except: [owner] })) found.push(`${key}@${hit}`);
    }
  }
  report.check('S2 no literal repeats the value of a string constant', found.length === 0, show(found));
}
// S3: document folder and document skill lists are defined once, in the value
// module that holds the document table.
{
  const tableOwners = [...values].filter(([, exported]) => Object.values(exported).some(value => value && typeof value === 'object'
    && ['discussion', 'plan', 'ticket', 'investigation', 'hotfix'].every(word => JSON.stringify(value).includes(`"${word}"`)))).map(([owner]) => owner);
  const owner = tableOwners.length === 1 ? tableOwners[0] : null;
  const DOC_WORDS = ['discussion', 'plan', 'ticket', 'investigation', 'hotfix', 'worklog', 'knowledge'];
  const SKILL_WORDS = ['discussing', 'planning', 'ticketing', 'investigating', 'regressing', 'verifying'];
  const listed = (line, words) => words.filter(word => new RegExp(`['"\`]${word}['"\`]|[(|]${word}[|)]`).test(line)).length >= 3;
  const found = hits(line => listed(line, DOC_WORDS) || listed(line, SKILL_WORDS), { except: [owner] });
  // Lists written over several lines: the literal assigned in one declaration.
  for (const [file, body] of text) {
    if (rel(file) === owner) continue;
    for (const match of body.matchAll(/=\s*[[{]/g)) {
      let depth = 0, end = match.index + match[0].length - 1;
      for (; end < body.length && end < match.index + 3000; end++) {
        if ('[{'.includes(body[end])) depth++;
        else if (']}'.includes(body[end]) && --depth === 0) break;
      }
      const span = body.slice(match.index, end + 1);
      const at = `${rel(file)}:${body.slice(0, match.index).split('\n').length}`;
      if (span.includes('\n') && (listed(span, DOC_WORDS) || listed(span, SKILL_WORDS)) && !found.includes(at)) found.push(at);
    }
  }
  report.check('S3 document folder/skill lists appear only in the module that defines the document table', found.length === 0 && owner !== null, `${show(found)} | table defined in: ${tableOwners.join(' ') || 'none'}`);
}
// S4: time spans of a minute or more are named constants in the value modules.
{
  const found = hits(line => /\d+\s*\*\s*60\s*\*\s*1000/.test(line), { except: VALUE_MODULES });
  report.check('S4 minute-scale durations are defined only in the value modules', found.length === 0, show(found));
}
// S5: JSON state goes through utils readJsonOrDefault / writeJson.
{
  const inlineRead = /try\s*\{\s*(?:if\s*\(!fs\.existsSync\([^)]*\)\)\s*return[^;]*;\s*)?(?:const \w+ = |return )JSON\.parse\(fs\.readFileSync\([^;]*;[\s\S]{0,80}?\}\s*catch\s*(?:\([^)]*\))?\s*\{\s*return/g;
  const reads = [];
  for (const [file, body] of text) if (rel(file) !== 'utils.js') for (const _ of body.match(inlineRead) || []) reads.push(rel(file));
  // Whole statements: an exclusive create (flag 'wx') is a different operation.
  const writes = [];
  for (const [file, body] of text) {
    if (rel(file) === 'utils.js') continue;
    for (const match of body.matchAll(/fs\.writeFileSync\([\s\S]*?\);[ \t]*$/gm)) {
      if (/JSON\.stringify\(/.test(match[0]) && !/flag:\s*'wx'/.test(match[0])) writes.push(`${rel(file)}:${body.slice(0, match.index).split('\n').length}`);
    }
  }
  report.check('S5a no inline read-JSON-or-default outside utils.js', reads.length === 0, show(reads));
  report.check('S5b JSON files are written through writeJson (atomic), not inline writeFileSync', writes.length === 0, show(writes));
}
// S6: the document-skill flag is owned by core/skill-flag.js (no load-time side
// effects, unlike the skill-tracker hook entry, which exits in background runs).
{
  const found = hits(line => /\bSKILL_ACTIVE_FILE\b|['"`]skill-active['"`]|skill-active\\?\.json['"/$]/.test(line), { except: ['constants.js', 'core/skill-flag.js'] });
  report.check('S6 only core/skill-flag.js reads, writes, or clears the skill flag', found.length === 0, show(found));
}
// S7: one owner-token lock implementation; callers use the with* wrappers.
{
  const implementations = [...new Set(hits(line => /function\s+_?acquire\w*Lock\b/.test(line)).map(hit => hit.split(':')[0]))];
  const manual = hits(line => /\b(acquireIndexLock|releaseIndexLock|acquireLock|releaseLock)\(/.test(line) && !/function\s/.test(line), { except: [...implementations, 'core/memory-lock.js'] });
  report.check('S7a lock acquisition is implemented in one module', implementations.length === 1, implementations.join(' '));
  report.check('S7b no manual lock acquire/release outside the lock modules', manual.length === 0, show(manual));
}

report.finish();
