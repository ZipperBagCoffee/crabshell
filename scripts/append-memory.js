#!/usr/bin/env node
/**
 * append-memory.js — Safely append a summary to logbook.md
 *
 * Reads summary from delta_summary_temp.txt, generates dual timestamps,
 * appends to logbook.md, and cleans up the temp file.
 *
 * Usage: node append-memory.js --project-dir=/path/to/project
 */

const fs = require('fs');
const path = require('path');
const { STORAGE_ROOT, MEMORY_FILE } = require('./constants');

function getProjectDir() {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg.startsWith('--project-dir=')) return arg.slice('--project-dir='.length);
  }
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function getTimestamps() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const utc = `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  const local = `${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  return { utc, local };
}

function main() {
  const projectDir = getProjectDir();
  const memoryDir = path.join(projectDir, STORAGE_ROOT, 'memory');
  const summaryPath = path.join(memoryDir, 'delta_summary_temp.txt');
  const memoryPath = path.join(memoryDir, MEMORY_FILE);

  // Read summary
  if (!fs.existsSync(summaryPath)) {
    console.error('ERROR: delta_summary_temp.txt not found');
    process.exit(1);
  }

  const summary = fs.readFileSync(summaryPath, 'utf8').trim();
  if (!summary) {
    console.error('ERROR: delta_summary_temp.txt is empty');
    process.exit(1);
  }

  // Generate timestamps
  const ts = getTimestamps();

  // Append to logbook.md
  const entry = `\n## ${ts.utc} (local ${ts.local})\n${summary}\n`;
  fs.appendFileSync(memoryPath, entry, 'utf8');
  console.log(`Appended to ${MEMORY_FILE}: ## ${ts.utc} (local ${ts.local})`);

  // Clean up temp file
  try { fs.unlinkSync(summaryPath); } catch (e) { /* ignore */ }
  console.log('Cleaned up delta_summary_temp.txt');
}

main();
