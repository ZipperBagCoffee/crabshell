'use strict';
// Opt-in stdout names. Keep pattern validation and collection outside result judging.

function checkedRegex(pattern, label = 'checkedPattern') {
  if (pattern === undefined || pattern === null) return null;
  if (typeof pattern !== 'string') throw new Error(`${label} must be a regex string with one capture group, or null`);
  let regex;
  try {
    regex = new RegExp(pattern);
    // The empty alternative exposes the capture slots even when the pattern cannot match ''.
    const slots = new RegExp(`(?:${pattern})|`).exec('');
    if (slots.length !== 2) throw new Error('exactly one capture group is required');
  } catch (error) { throw new Error(`${label}: ${error.message}`); }
  return regex;
}

function withCheckedPatterns(entries, manifest) {
  const declarations = new Map((manifest.entries || []).map(entry => [entry.id, entry]));
  return entries.map(entry => {
    const declaration = declarations.get(entry.discoveredBy || entry.id) || entry;
    const pattern = declaration.checkedPattern === undefined ? manifest.checkedPattern : declaration.checkedPattern;
    return pattern === undefined ? entry : { ...entry, checkedPattern: pattern };
  });
}

function checkedNames(entry, stdout) {
  const regex = checkedRegex(entry.checkedPattern, `${entry.id} checkedPattern`);
  if (!regex) return undefined;
  const names = new Set();
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const match = regex.exec(line);
    if (match && match[1] !== undefined) names.add(match[1]);
  }
  return [...names].sort();
}

module.exports = { checkedRegex, withCheckedPatterns, checkedNames };
