'use strict';

// The memory index file (memory-index.json), the L1 file timestamp, and token
// estimates for memory files.

const fs = require('fs');
const path = require('path');
const { INDEX_FILE, MEMORY_FILE, SUMMARY_SUFFIX } = require('../constants');
const { writeJson } = require('../utils');
const { marker } = require('./cut');
const { readState, markNoWrite, writeBlock } = require('./state-file');

// Default memory-index.json structure - prevents field loss on parse errors
function getDefaultIndex() {
  return {
    version: 1,
    current: MEMORY_FILE,
    rotatedFiles: [],
    stats: { totalRotations: 0, lastRotation: null },
    lastMemoryUpdateTs: null
  };
}

// Safe index reader - ALWAYS returns complete structure, preserving existing values
// Uses spread to auto-preserve new optional fields (deltaReady, pendingLastProcessedTs, etc.)
// A corrupt file is copied aside (state-file.js) and a newer-version file comes back marked
// so it is not written over. readIndexWithStatus also says which case it was.
function readIndexWithStatus(indexPath) {
  const defaults = getDefaultIndex();
  const { value: existing, status } = readState(indexPath, { version: defaults.version, defaults });
  if (status !== 'ok' && status !== 'newer') return { value: defaults, status };
  const merged = {
    ...defaults,
    ...existing,
    // Array/object fields need safe validation
    rotatedFiles: Array.isArray(existing.rotatedFiles) ? existing.rotatedFiles : defaults.rotatedFiles,
    stats: existing.stats ?? defaults.stats,
  };
  return { value: status === 'newer' ? markNoWrite(merged, writeBlock(existing)) : merged, status };
}

function readIndexSafe(indexPath) {
  return readIndexWithStatus(indexPath).value;
}

function getTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return now.getUTCFullYear() + '-' + pad(now.getUTCMonth()+1) + '-' + pad(now.getUTCDate()) + '_' + pad(now.getUTCHours()) + pad(now.getUTCMinutes());
}

function estimateTokens(text) { return Math.ceil(Buffer.byteLength(text, 'utf8') / 4); }
function estimateTokensFromFile(filePath) { return Math.ceil(fs.statSync(filePath).size / 4); }

function extractTailByTokens(content, targetTokens) {
  const lines = content.split(/\r?\n/);
  let tokens = 0, startIndex = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const lineTokens = estimateTokens(lines[i] + '\n');
    if (tokens + lineTokens > targetTokens) break;
    tokens += lineTokens; startIndex = i;
  }
  return lines.slice(startIndex).join('\n');
}

// The kept tail of a logbook, led by a note of how much was left out and where
// the earlier part lives (archiveName), so a reader knows the start is not the start.
function withCarryoverNote(fullContent, keptTail, archiveName) {
  const droppedChars = fullContent.length - keptTail.length;
  if (droppedChars <= 0) return keptTail;
  const where = archiveName ? 'chars of earlier logbook are in ' + archiveName : 'chars of earlier logbook left out';
  return marker(droppedChars, where) + '\n' + keptTail;
}

function updateIndex(archivePath, tokens, memoryDir, dateRange) {
  const indexPath = path.join(memoryDir, INDEX_FILE);
  const index = readIndexSafe(indexPath);  // Use safe reader to preserve all fields
  const entry = { file: path.basename(archivePath), rotatedAt: new Date().toISOString(), tokens, bytes: fs.statSync(archivePath).size, summary: path.basename(archivePath).replace('.md', SUMMARY_SUFFIX), summaryGenerated: false };
  if (dateRange) entry.dateRange = dateRange;
  index.rotatedFiles.push(entry);
  index.stats.totalRotations++;
  index.stats.lastRotation = new Date().toISOString();
  writeJson(indexPath, index);
}

module.exports = { getDefaultIndex, readIndexSafe, readIndexWithStatus, getTimestamp, estimateTokens, estimateTokensFromFile, extractTailByTokens, withCarryoverNote, updateIndex };
