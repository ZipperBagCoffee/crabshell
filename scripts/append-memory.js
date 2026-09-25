#!/usr/bin/env node
'use strict';
/**
 * append-memory.js — Safely append a summary to logbook.md
 *
 * Reads summary from delta_summary_temp.txt (or --summary-file, a file inside
 * the memory folder, so concurrent sessions each use their own), generates dual
 * timestamps, appends to logbook.md under the memory locks, and removes the file.
 *
 * Usage: node append-memory.js --project-dir=/path/to/project [--summary-file=<path>]
 */

const fs = require('fs');
const path = require('path');
const { STORAGE_ROOT, MEMORY_FILE, DELTA_SUMMARY_FILE } = require('./constants');
const { parseProjectDirArg } = require('./utils');
const { formatMemoryEntry } = require('./core/memory-entry');
const { withMemoryIndex, withMemoryRotation, readMemoryIndex, regularFile } = require('./core/memory-lock');

function main() {
  const projectDir = parseProjectDirArg(process.argv.slice(2));
  const value = flag => process.argv.find(arg => arg.startsWith(flag+'='))?.slice(flag.length+1);
  if (process.argv.includes('--prepare-delta')) {
    console.log(JSON.stringify(require('./core/delta-transaction').prepareDelta(projectDir)));return;
  }
  if (process.argv.includes('--finalize-delta')) {
    console.log(JSON.stringify(require('./core/delta-transaction').finalizeDelta(projectDir,value('--job-id'),value('--summary-file'))));return;
  }
  return withMemoryIndex(projectDir,directory=>withMemoryRotation(directory,()=>legacyAppend(projectDir, value('--summary-file'))));
}

function legacyAppend(projectDir, summaryFile) {
  const memoryDir = path.join(projectDir, STORAGE_ROOT, 'memory');
  const job = readMemoryIndex(memoryDir).deltaJob;
  if (job && job.status !== 'complete') throw Error('A prepared delta job exists; use --finalize-delta.');
  const summaryPath = summaryFile ? path.resolve(summaryFile) : path.join(memoryDir, DELTA_SUMMARY_FILE);
  if (path.dirname(summaryPath) !== path.resolve(memoryDir)) throw Error(`--summary-file must be a file directly inside ${memoryDir}`);
  const memoryPath = path.join(memoryDir, MEMORY_FILE);
  regularFile(summaryPath);regularFile(memoryPath);

  // Read summary
  if (!fs.existsSync(summaryPath)) {
    throw Error(`${path.basename(summaryPath)} not found`);
  }

  const summary = fs.readFileSync(summaryPath, 'utf8').trim();
  if (!summary) {
    throw Error(`${path.basename(summaryPath)} is empty`);
  }

  // Generate timestamps
  const entry = formatMemoryEntry(summary);

  // Append to logbook.md
  fs.appendFileSync(memoryPath, entry.text, 'utf8');
  console.log(`Appended to ${MEMORY_FILE}: ${entry.header}`);

  // Clean up temp file
  try { fs.unlinkSync(summaryPath); } catch (e) { /* ignore */ }
  console.log(`Cleaned up ${path.basename(summaryPath)}`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error('ERROR: '+error.message);process.exitCode=1; }
}

module.exports = { main };
