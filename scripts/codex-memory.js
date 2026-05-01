#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const { ensureMemoryStructure } = require('./init');
const { searchMemory } = require('./search');
const {
  getProjectDir,
  getStorageRoot,
  readFileOrDefault,
  readJsonOrDefault,
  writeJson,
  ensureDir
} = require('./utils');
const {
  MEMORY_DIR,
  MEMORY_FILE,
  INDEX_FILE,
  COUNTER_FILE
} = require('./constants');

function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) args[arg.slice(2)] = true;
      else args[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function projectDirFromArgs(args) {
  return args['project-dir'] ? path.resolve(args['project-dir']) : getProjectDir();
}

function timestamps() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return {
    utc: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}`,
    local: `${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
  };
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function tailLines(text, count) {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - count)).join('\n').trim();
}

function ensure(projectDir) {
  ensureMemoryStructure(projectDir);
  const memoryDir = path.join(getStorageRoot(projectDir), MEMORY_DIR);
  ensureDir(memoryDir);
  return memoryDir;
}

function load(args) {
  const projectDir = projectDirFromArgs(args);
  const memoryDir = ensure(projectDir);
  const tail = Number(args['tail-lines'] || 80);
  const sections = [];

  const projectText = readFileOrDefault(path.join(memoryDir, 'project.md'), '').trim();
  if (projectText) sections.push(`## Project Memory\n${projectText}`);

  const index = readJsonOrDefault(path.join(memoryDir, INDEX_FILE), { rotatedFiles: [] });
  const summaries = Array.isArray(index.rotatedFiles)
    ? index.rotatedFiles.filter(x => x.summaryGenerated && x.summary).slice(-5)
    : [];
  const summaryText = summaries.map(entry => {
    const summary = readJsonOrDefault(path.join(memoryDir, entry.summary), null);
    if (!summary) return null;
    if (summary.overallSummary) return `- ${entry.summary}: ${summary.overallSummary}`;
    return `- ${entry.summary}`;
  }).filter(Boolean).join('\n');
  if (summaryText) sections.push(`## Rotated Memory Summaries\n${summaryText}`);

  const logbook = readFileOrDefault(path.join(memoryDir, MEMORY_FILE), '').trim();
  if (logbook) sections.push(`## Recent Logbook Tail\n${tailLines(logbook, tail)}`);

  if (!sections.length) {
    console.log(`No Crabshell memory found for ${projectDir}`);
    return;
  }
  console.log(sections.join('\n\n'));
}

function save(args) {
  const projectDir = projectDirFromArgs(args);
  const memoryDir = ensure(projectDir);
  const memoryPath = path.join(memoryDir, MEMORY_FILE);
  const title = args.title || 'Codex session note';
  const body = (args.message || readStdin()).trim();
  if (!body) {
    console.error('Usage: node scripts/codex-memory.js save --message="summary"');
    process.exit(1);
  }
  const ts = timestamps();
  const entry = `\n## ${ts.utc} (local ${ts.local})\n### ${title}\n${body}\n`;
  fs.appendFileSync(memoryPath, entry, 'utf8');
  writeJson(path.join(memoryDir, COUNTER_FILE), { counter: 0 });
  console.log(`Saved Crabshell memory entry to ${path.relative(projectDir, memoryPath)}: ## ${ts.utc} (local ${ts.local})`);
}

function search(args) {
  const query = args._.join(' ').trim() || args.query;
  if (!query) {
    console.error('Usage: node scripts/codex-memory.js search <query> [--deep]');
    process.exit(1);
  }
  const projectDir = projectDirFromArgs(args);
  ensure(projectDir);
  process.env.PROJECT_DIR = projectDir;
  const results = searchMemory(query, { deep: Boolean(args.deep), regex: Boolean(args.regex) });
  if (!results.length) {
    console.log(`No matches for "${query}".`);
    return;
  }
  for (const group of results) {
    console.log(`\n## ${group.source}`);
    for (const match of group.matches.slice(0, Number(args.limit || 20))) {
      if (match.line) console.log(`- line ${match.line}: ${match.text}`);
      else if (match.file) console.log(`- ${match.file}: ${match.content || match.text || JSON.stringify(match.entry)}`);
      else console.log(`- ${JSON.stringify(match)}`);
    }
  }
}

function status(args) {
  const projectDir = projectDirFromArgs(args);
  const memoryDir = ensure(projectDir);
  const index = readJsonOrDefault(path.join(memoryDir, INDEX_FILE), {});
  const memoryPath = path.join(memoryDir, MEMORY_FILE);
  const size = fs.existsSync(memoryPath) ? fs.statSync(memoryPath).size : 0;
  console.log(JSON.stringify({
    projectDir,
    memoryDir,
    logbook: MEMORY_FILE,
    logbookBytes: size,
    rotations: index.stats && index.stats.totalRotations || 0,
    rotatedFiles: Array.isArray(index.rotatedFiles) ? index.rotatedFiles.length : 0
  }, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._.shift();
  if (command === 'load') return load(args);
  if (command === 'save') return save(args);
  if (command === 'search') return search(args);
  if (command === 'status') return status(args);
  console.error('Usage: node scripts/codex-memory.js <load|save|search|status>');
  process.exit(1);
}

if (require.main === module) main();

module.exports = { load, save, search, status, parseArgs };
