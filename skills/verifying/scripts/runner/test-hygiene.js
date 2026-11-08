'use strict';
// D151_T004: a test that holds the text of the files it checks, word for word, breaks
// whenever that text is reworded, so whoever changes the product also has to hunt through
// the tests. A changed test that ran is compared with its own inputs (what it read, or
// declared); the first such text is named once, in the run's notices. Unchanged tests are
// not read, so a run pays only for the tests that changed.

const { inputsUnknown } = require('./select');
const { pathOf } = require('./used-report');

const DEFAULT_MIN_CHARS = 40;
const PREVIEW_CHARS = 40;

// Prose is what a rewording changes: at least MIN_WORDS plain words (letters only, trailing
// punctuation allowed, any script), and plain words at least half of its tokens. A command
// line, a code statement or a path has few plain words among symbols, so a test holding one
// names a contract spelling, not copied text.
const MIN_WORDS = 4;
const PLAIN_WORD = /^\p{L}[\p{L}'’-]*[.,;:!?)]*$/u;
function isProse(text) {
  const tokens = text.trim().split(/\s+/);
  const words = tokens.filter(token => PLAIN_WORD.test(token)).length;
  return words >= MIN_WORDS && words * 2 >= tokens.length;
}

// Quoted text in a test: '…' and "…" on one line, and the pieces of a `…` template between
// its ${…} parts, of at least minChars characters and prose.
const QUOTED = /'((?:[^'\\\r\n]|\\.)*)'|"((?:[^"\\\r\n]|\\.)*)"|`((?:[^`\\]|\\[\s\S])*)`/g;
function quotedTexts(source, minChars = DEFAULT_MIN_CHARS) {
  const found = new Set();
  for (const match of source.matchAll(QUOTED)) {
    const pieces = match[3] !== undefined ? match[3].split(/\$\{[^}]*\}/) : [match[1] !== undefined ? match[1] : match[2]];
    for (const piece of pieces) if (piece.length >= minChars && isProse(piece)) found.add(piece);
  }
  return [...found];
}

// The text as written, and with its quote and backslash escapes undone.
const forms = piece => [...new Set([piece, piece.replace(/\\(['"`\\])/g, '$1')])];

// ran: ids of checks that executed in this run; records: their records (test, files, kind);
// changed: files that differ from the last run's look at the project; read(file) gives a
// project file's text.
function copyNotices({ ran, records, changed, minChars = DEFAULT_MIN_CHARS, read }) {
  const changedFiles = new Set(changed);
  // Another check's test is not the product: a test may share text with it.
  const tests = new Set(Object.values(records).map(record => record && record.test).filter(Boolean));
  const texts = new Map();
  const text = file => {
    if (!texts.has(file)) {
      let content = null;
      try { content = read(file); } catch (_) {}
      texts.set(file, typeof content === 'string' ? content : null);
    }
    return texts.get(file);
  };
  const notices = [];
  const looked = new Set();
  for (const id of ran) {
    const record = records[id];
    // A check whose inputs are unknown would mean searching the whole project: skipped.
    if (!record || !record.test || inputsUnknown(record) || !changedFiles.has(record.test) || looked.has(record.test)) continue;
    looked.add(record.test);
    const source = text(record.test);
    if (source === null) continue;
    const inputs = [...new Set((record.files || []).map(pathOf))].filter(file => !file.endsWith('/') && !tests.has(file));
    const copies = [];
    for (const piece of quotedTexts(source, minChars)) {
      const where = inputs.find(file => { const content = text(file); return content !== null && forms(piece).some(form => content.includes(form)); });
      if (where) copies.push({ piece, where });
    }
    if (!copies.length) continue;
    const [first] = copies;
    const preview = first.piece.length > PREVIEW_CHARS ? `${first.piece.slice(0, PREVIEW_CHARS)}…` : first.piece;
    notices.push(`Copies its inputs: ${record.test} holds ${copies.length} quoted text${copies.length > 1 ? 's' : ''} word for word, first "${preview}" from ${first.where} — rewording it there breaks this test; read the expected text from the source, or check the behavior instead.`);
  }
  return notices;
}

module.exports = { quotedTexts, copyNotices, DEFAULT_MIN_CHARS };
