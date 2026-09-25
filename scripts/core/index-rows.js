'use strict';
// One reader for a row of a Crabshell INDEX.md table. The skills write the ID
// cell as [[slug|ID]] (unescaped pipe) and Obsidian tables escape other links as
// [[slug\|ID]], so a row is split on unescaped pipes, a cell cut inside [[...]]
// is joined back, and \| is unescaped.

const { DOC_TYPES } = require('../constants');

const ID_SHAPE = `[${DOC_TYPES.map(type => type.prefix).join('')}]\\d{3}(?:_T\\d{3})?`;
const BARE_ID = new RegExp(`^${ID_SHAPE}$`);
const LEADING_ID = new RegExp(`^(${ID_SHAPE})(?![\\w])`);
const WIKILINK = /^\[\[([^\]|]*)(?:\|([^\]]*))?\]\]$/;

const count = (text, token) => text.split(token).length - 1;

// Cells of a table row without the empty boundary cells, or null for a
// line that is not a table row.
function splitIndexRow(line) {
  const text = String(line || '').trim();
  if (!text.startsWith('|')) return null;
  const raw = text.slice(1).split(/(?<!\\)\|/);
  if (/(?<!\\)\|$/.test(text)) raw.pop();
  const cells = [];
  for (let i = 0; i < raw.length; i++) {
    let cell = raw[i];
    while (count(cell, '[[') > count(cell, ']]') && i + 1 < raw.length) cell += '|' + raw[++i];
    cells.push(cell.replace(/\\\|/g, '|').trim());
  }
  return cells;
}

// The document ID a cell names: [[slug|ID]], [[slug]] (the slug starts with
// the ID) or a bare ID; null otherwise.
function cellId(cell) {
  const text = String(cell || '').trim();
  const link = text.match(WIKILINK);
  if (!link) return BARE_ID.test(text) ? text : null;
  const alias = (link[2] || '').trim();
  if (BARE_ID.test(alias)) return alias;
  const leading = link[1].trim().match(LEADING_ID);
  return leading ? leading[1] : null;
}

// { id, status, cells, target } for a document row; null for headers,
// separators and anything else. status is the third cell, lowercased; target is
// the ID cell's link target (file name without .md), null for a bare ID.
function parseIndexRow(line) {
  const cells = splitIndexRow(line);
  if (!cells || cells.length === 0) return null;
  const id = cellId(cells[0]);
  if (!id) return null;
  const link = cells[0].match(WIKILINK);
  return { id, status: (cells[2] || '').toLowerCase(), cells, target: link ? link[1].trim() : null };
}

function readIndexRows(content) {
  return String(content || '').split(/\r?\n/).map(parseIndexRow).filter(Boolean);
}

// The document ID a name starts with ("D123-topic" -> "D123", "D123_T004-work" ->
// "D123_T004"), or null.
function leadingId(name) {
  const match = String(name || '').trim().match(LEADING_ID);
  return match ? match[1] : null;
}

module.exports = { splitIndexRow, cellId, parseIndexRow, readIndexRows, leadingId };
