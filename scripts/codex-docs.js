#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const { STORAGE_ROOT } = require('./constants');
const { ensureDir } = require('./utils');

const TYPES = {
  discussion: { dir: 'discussion', prefix: 'D', title: 'Discussion', index: ['ID', 'Topic', 'Status', 'Date'] },
  plan: { dir: 'plan', prefix: 'P', title: 'Plan', index: ['ID', 'Plan', 'Status', 'Date', 'Related'] },
  ticket: { dir: 'ticket', prefix: 'T', title: 'Ticket', index: ['ID', 'Ticket', 'Status', 'Date', 'Plan'] },
  investigation: { dir: 'investigation', prefix: 'I', title: 'Investigation', index: ['ID', 'Title', 'Status', 'Created', 'Related'] },
  hotfix: { dir: 'hotfix', prefix: 'H', title: 'Hotfix', index: ['ID', 'Title', 'Status', 'Date'] },
  worklog: { dir: 'worklog', prefix: 'W', title: 'Worklog', index: ['ID', 'Task', 'Status', 'Date', 'Related'] }
};

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

function nowParts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    minute: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  };
}

function slugify(input) {
  return String(input || 'untitled')
    .normalize('NFKD')
    .replace(/[\\/:*?"<>|#`]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'untitled';
}

function ensureIndex(root, type) {
  const spec = TYPES[type];
  const dir = path.join(root, STORAGE_ROOT, spec.dir);
  ensureDir(dir);
  const indexPath = path.join(dir, 'INDEX.md');
  if (!fs.existsSync(indexPath)) {
    const header = `# ${spec.title} Index\n\n| ${spec.index.join(' | ')} |\n| ${spec.index.map(() => '---').join(' | ')} |\n`;
    fs.writeFileSync(indexPath, header, 'utf8');
  }
  return { dir, indexPath, spec };
}

function nextId(dir, prefix) {
  const re = new RegExp(`^${prefix}(\\d{3})-.*\\.md$`);
  let max = 0;
  for (const file of fs.readdirSync(dir)) {
    const m = file.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function planIdFromLink(input) {
  const text = String(input || '').trim();
  const match = text.match(/\bP\d{3}\b/);
  return match ? match[0] : null;
}

function nextTicketId(dir, planId) {
  const re = new RegExp(`^${planId}_T(\\d{3})-.*\\.md$`);
  let max = 0;
  for (const file of fs.readdirSync(dir)) {
    const m = file.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${planId}_T${String(max + 1).padStart(3, '0')}`;
}

function appendIndex(indexPath, row) {
  fs.appendFileSync(indexPath, row + '\n', 'utf8');
}

function wikiTarget(filename) {
  return filename.replace(/\.md$/, '');
}

function createWorklog(root, title, args) {
  const { dir, indexPath } = ensureIndex(root, 'worklog');
  const id = nextId(dir, 'W');
  const slug = slugify(title);
  const t = nowParts();
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(dir, filename);
  const content = `---\ntype: worklog\nid: ${id}\ntitle: "${title}"\nstatus: in-progress\ncreated: ${t.date}\ntags: []\n---\n\n# ${id} - ${title}\n\n## Header\n**Date:** ${t.minute}\n**Source:** ${args.source || 'Codex user request'}\n**Scope estimate:** ${args.scope || 'Files: TBD. Components: TBD. Cross-cutting: TBD.'}\n\n## Task\n${args.task || title}\n\n## Problem\n${args.problem || 'TBD by Codex before implementation.'}\n\n## Approach\n${args.approach || 'TBD by Codex before implementation.'}\n\n## Files Changed\n| File | Change Description |\n|------|--------------------|\n| TBD | TBD |\n\n## Verification\n| Criterion | Method | Result |\n|-----------|--------|--------|\n| TBD | TBD | TBD |\n\n## Experiment Log\nTBD.\n\n## User Testing Needed\nTBD.\n\n## Result\nTBD.\n`;
  fs.writeFileSync(filePath, content, 'utf8');
  appendIndex(indexPath, `| [[${wikiTarget(filename)}|${id}]] | ${title} | in-progress | ${t.date} | ${args.related || ''} |`);
  console.log(path.relative(root, filePath));
}

function createHotfix(root, title, args) {
  const { dir, indexPath } = ensureIndex(root, 'hotfix');
  const id = nextId(dir, 'H');
  const slug = slugify(title);
  const t = nowParts();
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(dir, filename);
  const content = `---\ntype: hotfix\nid: ${id}\ntitle: "${title}"\nstatus: done\ncreated: ${t.date}\ntags: []\n---\n\n# ${id} - ${title}\n\n## Problem\n${args.problem || 'TBD.'}\n\n## Fix\n${args.fix || 'TBD.'}\n\n## Verification\n${args.verification || 'TBD.'}\n\n## Log\n### [${t.minute}] Created\n${args.context || 'Created from Codex hotfix skill.'}\n`;
  fs.writeFileSync(filePath, content, 'utf8');
  appendIndex(indexPath, `| [[${wikiTarget(filename)}|${id}]] | ${title} | done | ${t.date} |`);
  console.log(path.relative(root, filePath));
}

function listFromArg(value, fallback) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.split(/\s*(?:\r?\n|;)\s*/).filter(Boolean).map(item => `- ${item}`).join('\n');
}

function numberedListFromArg(value, fallbackItems) {
  const text = String(value || '').trim();
  const items = text ? text.split(/\s*(?:\r?\n|;)\s*/).filter(Boolean) : fallbackItems;
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

function createInvestigation(root, title, args) {
  const { dir, indexPath } = ensureIndex(root, 'investigation');
  const id = nextId(dir, 'I');
  const slug = slugify(title);
  const t = nowParts();
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(dir, filename);
  const topic = args.topic || args.intent || title;
  const questions = numberedListFromArg(args.questions, [
    'What is the current state?',
    'What evidence supports the conclusion?',
    'What gaps or risks remain?'
  ]);
  const constraints = listFromArg(args.constraints, '- [Inferred] Use at least two source types unless the user explicitly restricts sources.');
  const sources = listFromArg(args.sources, '- Internet: TBD\n- Local: TBD\n- User-specified: TBD');
  const content = `---\ntype: investigation\nid: ${id}\ntitle: "${title}"\nstatus: open\ncreated: ${t.date}\ntags: []\n---\n\n# ${id} - ${title}\n\n## Topic\n${topic}\n\n## Constraints\n${constraints}\n\n## Questions\n${questions}\n\n## Sources\n${sources}\n\n## Investigation Log\n\n### Workstream 1: Internet or external sources\nTBD. Record queries, URLs, dates, and source-specific evidence.\n\n### Workstream 2: Local project evidence\nTBD. Record files, commands, code paths, and observed outputs.\n\n### Workstream 3: Additional angle\nTBD. Use for user-specified sources, comparative analysis, or an independent counter-hypothesis.\n\n## Cross-Review\nTBD. Compare workstreams, list contradictions, weak evidence, and findings that survived review.\n\n## Synthesis\nTBD. Integrate the reviewed evidence into a coherent answer.\n\n## Conclusions\n- Key findings: TBD\n- Confidence level: TBD\n- Gaps/unknowns: TBD\n\n## Log\n### [${t.minute}] Investigation started\nCreated from Codex investigating skill. Update the workstream sections before reporting final conclusions.\n`;
  fs.writeFileSync(filePath, content, 'utf8');
  appendIndex(indexPath, `| [[${wikiTarget(filename)}|${id}]] | ${title} | open | ${t.date} | ${args.related || ''} |`);
  console.log(path.relative(root, filePath));
}

function createSimple(root, type, title, args) {
  const { dir, indexPath, spec } = ensureIndex(root, type);
  const planId = type === 'ticket' ? planIdFromLink(args.plan) : null;
  if (type === 'ticket' && !planId) {
    console.error('ERROR: ticket creation requires --plan with a valid P### reference, e.g. --plan="[[P001-topic|P001]]"');
    process.exit(1);
  }
  const id = type === 'ticket' ? nextTicketId(dir, planId) : nextId(dir, spec.prefix);
  const slug = slugify(title);
  const t = nowParts();
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(dir, filename);
  const status = type === 'discussion' ? 'open' : type === 'ticket' ? 'todo' : 'draft';
  const body = `---\ntype: ${type}\nid: ${id}\ntitle: "${title}"\nstatus: ${status}\ncreated: ${t.date}\ntags: []\n---\n\n# ${id} - ${title}\n\n## Intent\n${args.intent || title}\n\n## Context\n${args.context || 'TBD.'}\n\n## Acceptance Criteria\n${args.ac || '- TBD'}\n\n## Log\n### [${t.minute}] Created\nCreated from Codex ${type} skill.\n`;
  fs.writeFileSync(filePath, body, 'utf8');
  const link = `[[${wikiTarget(filename)}|${id}]]`;
  if (type === 'plan') appendIndex(indexPath, `| ${link} | ${title} | ${status} | ${t.date} | ${args.related || ''} |`);
  else if (type === 'ticket') appendIndex(indexPath, `| ${link} | ${title} | ${status} | ${t.date} | ${args.plan || ''} |`);
  else appendIndex(indexPath, `| ${link} | ${title} | ${status} | ${t.date} |`);
  console.log(path.relative(root, filePath));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._.shift();
  const title = args._.join(' ').trim() || args.title;
  const root = path.resolve(args['project-dir'] || process.cwd());
  if (!command || !title) {
    console.error('Usage: node scripts/codex-docs.js <worklog|hotfix|discussion|plan|ticket|investigation> <title>');
    process.exit(1);
  }
  if (command === 'worklog' || command === 'light-workflow') return createWorklog(root, title, args);
  if (command === 'hotfix') return createHotfix(root, title, args);
  if (command === 'investigation' || command === 'investigating') return createInvestigation(root, title, args);
  if (command === 'discussion' || command === 'plan' || command === 'ticket') return createSimple(root, command, title, args);
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = { createWorklog, createHotfix, createInvestigation, createSimple, slugify };
