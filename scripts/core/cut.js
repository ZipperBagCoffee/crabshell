'use strict';

// Cutting text or lists for a size limit, never silently: where something is left
// out, a marker says so and says how much. The model that reads the result later
// then knows the text was cut and by how much. The marker wording lives here only.

const ELLIPSIS = String.fromCharCode(0x2026);
const OPEN = '[' + ELLIPSIS + ' ';
const CLOSE = ']';
const DEFAULT_TEXT_LABEL = 'chars cut';

function marker(count, label) {
  return OPEN + count + ' ' + label + CLOSE;
}

// The longest marker the text could need: the count never has more digits than
// the text has characters, so reserving that many digits keeps the result in the limit.
function reservedMarkerLength(text, label, separator) {
  return marker('9'.repeat(String(text.length).length), label).length + separator.length;
}

/**
 * Keep the start of the text. Over the limit: the kept start plus "[... N chars cut]",
 * the whole result within the limit; N is the number of characters dropped.
 * @param {string} text
 * @param {number} limit maximum result length
 * @param {{lineBoundary?: boolean, label?: string}} [options] lineBoundary: cut at a line end
 */
function keepHead(text, limit, options = {}) {
  text = String(text == null ? '' : text);
  if (text.length <= limit) return text;
  const label = options.label || DEFAULT_TEXT_LABEL;
  const separator = options.lineBoundary ? '\n' : '';
  const room = limit - reservedMarkerLength(text, label, separator);
  // No room for a marker: a plain cut is the only thing that stays within the limit.
  if (room <= 0) return text.slice(0, Math.max(0, limit));
  let kept = text.slice(0, room);
  if (options.lineBoundary) {
    const newline = kept.lastIndexOf('\n');
    if (newline > 0) kept = kept.slice(0, newline);
  }
  return kept + separator + marker(text.length - kept.length, label);
}

/**
 * Keep the end of the text. Over the limit: "[... N chars cut]" then the kept end.
 * @param {string} text
 * @param {number} limit
 * @param {{lineBoundary?: boolean, label?: string}} [options] lineBoundary: start at a line start
 */
function keepTail(text, limit, options = {}) {
  text = String(text == null ? '' : text);
  if (text.length <= limit) return text;
  const label = options.label || DEFAULT_TEXT_LABEL;
  const separator = options.lineBoundary ? '\n' : '';
  const room = limit - reservedMarkerLength(text, label, separator);
  if (room <= 0) return text.slice(text.length - Math.max(0, limit));
  let kept = text.slice(text.length - room);
  if (options.lineBoundary) {
    const newline = kept.indexOf('\n');
    if (newline >= 0 && newline < kept.length - 1) kept = kept.slice(newline + 1);
  }
  return marker(text.length - kept.length, label) + separator + kept;
}

/**
 * Keep the first n items of a list of strings; the rest become one "[... M more]" item.
 * @param {string[]} items
 * @param {number} n
 * @param {{label?: string}} [options] label: what the left-out items are ("more" by default)
 */
function keepFirst(items, n, options = {}) {
  if (items.length <= n) return items;
  return items.slice(0, n).concat(marker(items.length - n, options.label || 'more'));
}

/**
 * Keep the last n items; the earlier ones become one marker item placed first.
 * @param {string[]} items
 * @param {number} n
 * @param {{label?: string}} [options] label default "earlier left out"
 */
function keepLast(items, n, options = {}) {
  if (items.length <= n) return items;
  return [marker(items.length - n, options.label || 'earlier left out')].concat(items.slice(items.length - n));
}

module.exports = { keepHead, keepTail, keepFirst, keepLast, marker };
