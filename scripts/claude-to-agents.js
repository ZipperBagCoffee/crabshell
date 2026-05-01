#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) args[arg.slice(2)] = true;
    else args[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return args;
}

function splitClaudeMd(text) {
  const marker = '---Add your project-specific rules below this line---';
  const idx = text.indexOf(marker);
  if (idx === -1) return { managed: text.trim(), project: '' };
  return {
    managed: text.slice(0, idx).trim(),
    project: text.slice(idx + marker.length).trim()
  };
}

function convert(text) {
  const { managed, project } = splitClaudeMd(text);
  const convertedManaged = managed
    .replace(/^## CRITICAL RULES \(Core Principles Alignment\)/m, '## Crabshell Rules Adapted For Codex')
    .replace(/\bClaude Code\b/g, 'Codex')
    .replace(/\bClaude\b/g, 'Codex')
    .replace(/CLAUDE\.md/g, 'AGENTS.md')
    .replace(/MEMORY\.md/g, 'Codex memory notes');

  const parts = [
    '# AGENTS.md',
    '',
    '> Generated from CLAUDE.md by `scripts/claude-to-agents.js`.',
    '> Claude-specific hook behavior is advisory in Codex unless a Codex skill or script explicitly runs it.',
    '',
    convertedManaged
  ];

  if (project) {
    parts.push('', '---', '', '## Project-Specific Rules', '', project);
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = path.resolve(args['project-dir'] || process.cwd());
  const source = path.join(projectDir, args.source || 'CLAUDE.md');
  const target = path.join(projectDir, args.target || 'AGENTS.md');
  if (!fs.existsSync(source)) {
    console.error(`Source file not found: ${source}`);
    process.exit(1);
  }
  const output = convert(fs.readFileSync(source, 'utf8'));
  if (args['dry-run']) {
    console.log(output);
    return;
  }
  if (fs.existsSync(target) && !args.force) {
    console.error(`Target already exists: ${target}`);
    console.error('Re-run with --force to overwrite, or use --dry-run to inspect output.');
    process.exit(1);
  }
  fs.writeFileSync(target, output, 'utf8');
  console.log(`Wrote ${path.relative(projectDir, target)} from ${path.relative(projectDir, source)}`);
}

if (require.main === module) main();

module.exports = { convert, splitClaudeMd };
