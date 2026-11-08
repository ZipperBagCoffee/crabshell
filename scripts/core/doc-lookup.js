'use strict';

// Finding a Crabshell document by ID and reading one "## " section of it.

const fs = require('fs');
const path = require('path');

function findDocument(storageRoot, directory, id) {
  if (!id || !/^[A-Z][A-Z0-9_]*$/.test(String(id))) return null;
  const dirPath = path.join(storageRoot, directory);
  let names;
  try { names = fs.readdirSync(dirPath); } catch { return null; }
  const name = names.find(candidate => candidate === `${id}.md` || candidate.startsWith(`${id}-`));
  return name ? path.join(dirPath, name) : null;
}

function readSection(content, heading) {
  const lines = String(content || '').split(/\r?\n/);
  const target = `## ${heading}`.toLowerCase();
  const start = lines.findIndex(line => line.trim().toLowerCase() === target);
  if (start === -1) return '';
  const selected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    selected.push(lines[index]);
  }
  return selected.join('\n').trim();
}

module.exports = { findDocument, readSection };
