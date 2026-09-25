#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { STORAGE_ROOT, DOC_TYPES, TICKET_PARENT_SOURCE } = require('./constants');
const { ensureDir } = require('./utils');
const { discussionHasPlan } = require('./core/plan-entry');

const TYPES = Object.fromEntries(DOC_TYPES.map(type => [type.dir, { dir: type.dir, prefix: type.prefix, title: type.title, index: type.indexColumns }]));

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

// The parent ID (a discussion D### or a plan P###) in a bare ID or a wikilink.
function parentIdFromLink(input) {
  const match = String(input || '').trim().match(new RegExp(`\\b${TICKET_PARENT_SOURCE}\\b`));
  return match ? match[0] : null;
}

function nextTicketId(dir, parentId) {
  const re = new RegExp(`^${parentId}_T(\\d{3})-.*\\.md$`);
  let max = 0;
  for (const file of fs.readdirSync(dir)) {
    const m = file.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${parentId}_T${String(max + 1).padStart(3, '0')}`;
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
  const content = `---\ntype: worklog\nid: ${id}\ntitle: "${title}"\nstatus: in-progress\ncreated: ${t.date}\ntags: []\n---\n\n# ${id} - ${title}\n\n## Header\n**Date:** ${t.minute}\n**Source:** ${args.source || 'Codex user request'}\n**Scope estimate:** ${args.scope || 'Risk and dependency boundary: TBD.'}\n\n## Task Contract (internal)\n- **original_request:** ${args['original-request'] || args.task || title}\n- **required_outcomes:** ${args['required-outcomes'] || 'TBD before implementation.'}\n- **non_goals:** ${args['non-goals'] || 'TBD before implementation.'}\n- **named_references:** ${args['named-references'] || 'None named.'}\n- **allowed_changes:** ${args['allowed-changes'] || 'TBD before implementation.'}\n- **forbidden_side_effects:** ${args['forbidden-side-effects'] || 'TBD before implementation.'}\n- **observable_success:** ${args['observable-success'] || 'TBD before implementation.'}\n- **blocking_unknowns:** ${args['blocking-unknowns'] || 'None currently identified.'}\n\n## Task\n${args.task || title}\n\n## Problem\n${args.problem || 'TBD by Codex before implementation.'}\n\n## Approach\n${args.approach || 'TBD by Codex before implementation.'}\n\n## Files Changed\n| File | Change Description |\n|------|--------------------|\n| TBD | TBD |\n\n## Verification\n| Criterion | Prediction | Observation | Gap | Result |\n|-----------|------------|-------------|-----|--------|\n| TBD | TBD | TBD | TBD | TBD |\n\n## Experiment Log\nTBD.\n\n## User Testing Needed\nTBD.\n\n## Result\nTBD.\n`;
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

function createKnowledge(root, title, args) {
  const { dir, indexPath } = ensureIndex(root, 'knowledge');
  const id = nextId(dir, 'K');
  const slug = slugify(title);
  const t = nowParts();
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(dir, filename);
  const category = (args.category === 'tip') ? 'tip' : 'fact';
  const source = args.source || 'observation';
  const tagsArr = String(args.tags || '').split(',').map(s => s.trim()).filter(Boolean);
  const tagsYaml = `[${tagsArr.join(', ')}]`;
  const tagsCell = tagsArr.join(', ');
  const what = args.what || 'TBD.';
  const when = args.when || 'TBD.';
  const content = `---\ntype: knowledge\nid: ${id}\ncategory: ${category}\ntitle: "${title}"\nsource: ${source}\ncreated: ${t.date}\ntags: ${tagsYaml}\n---\n\n# ${id} - ${title}\n\n## What\n${what}\n\n## When\n${when}\n`;
  fs.writeFileSync(filePath, content, 'utf8');
  appendIndex(indexPath, `| [[${wikiTarget(filename)}|${id}]] | ${title} | ${category} | ${tagsCell} | ${source} |`);
  console.log(path.relative(root, filePath));
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
  // --parent names the ticket's discussion (D###) or plan (P###); --plan is the older spelling.
  const parentRef = args.parent || args.plan;
  const parentId = type === 'ticket' ? parentIdFromLink(parentRef) : null;
  if (type === 'ticket' && !parentId) {
    console.error('ERROR: ticket creation requires --parent with the discussion (D###) or plan (P###) it belongs to, e.g. --parent=D001');
    process.exit(1);
  }
  if (type === 'ticket') {
    const parentDir = path.join(root, STORAGE_ROOT, TYPES[parentId.startsWith('D') ? 'discussion' : 'plan'].dir);
    const parentFile = fs.existsSync(parentDir) && fs.readdirSync(parentDir).find(file => file.startsWith(`${parentId}-`) && file.endsWith('.md'));
    if (!parentFile) {
      console.error(`ERROR: parent ${parentId} does not exist under ${path.relative(root, parentDir) || parentDir}; create it first.`);
      process.exit(1);
    }
    // A discussion parent carries the plan: no ticket before it, none without its part.
    if (parentId.startsWith('D') && !discussionHasPlan(fs.readFileSync(path.join(parentDir, parentFile), 'utf8'))) {
      console.error(`ERROR: ${parentId} has no plan yet. Fill its ## Plan (how it will be built: files and functions, order, rejected alternatives, risks) and get the user's confirmation before creating tickets.`);
      process.exit(1);
    }
    if (parentId.startsWith('D') && !(typeof args.details === 'string' && args.details.trim() && !/^TBD\.?$/i.test(args.details.trim()))) {
      console.error(`ERROR: a ticket under ${parentId} needs --details: its part of ${parentId}'s plan (each file → function/section → what changes).`);
      process.exit(1);
    }
  }
  const id = type === 'ticket' ? nextTicketId(dir, parentId) : nextId(dir, spec.prefix);
  const slug = slugify(title);
  const t = nowParts();
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(dir, filename);
  const status = type === 'discussion' ? 'open' : type === 'ticket' ? 'todo' : 'draft';
  const plan = type === 'discussion' ? `## Plan\n${typeof args.how === 'string' && args.how.trim() ? args.how : '(placeholder — plan before tickets: approach, each file → what changes, order, rejected alternatives, risks, intent check, user confirmation)'}\n\n` : '';
  const details = type === 'ticket' ? `## Implementation Details\n${typeof args.details === 'string' && args.details.trim() ? args.details : 'TBD.'}\n\n` : '';
  const fidelity = type === 'ticket' ? `## Intent Fidelity\n(placeholder — parent compares the result with the discussion's Intent Anchor and Plan here)\n\n` : '';
  const body = `---\ntype: ${type}\nid: ${id}\ntitle: "${title}"\nstatus: ${status}\ncreated: ${t.date}\ntags: []\n---\n\n# ${id} - ${title}\n\n## Intent\n${args.intent || title}\n\n## Context\n${args.context || 'TBD.'}\n\n${plan}${details}## Acceptance Criteria\n${args.ac || '- TBD'}\n\n${fidelity}## Log\n### [${t.minute}] Created\nCreated from Codex ${type} skill.\n`;
  fs.writeFileSync(filePath, body, 'utf8');
  const link = `[[${wikiTarget(filename)}|${id}]]`;
  if (type === 'plan') appendIndex(indexPath, `| ${link} | ${title} | ${status} | ${t.date} | ${args.related || ''} |`);
  else if (type === 'ticket') appendIndex(indexPath, `| ${link} | ${title} | ${status} | ${t.date} | ${parentRef || ''} |`);
  else appendIndex(indexPath, `| ${link} | ${title} | ${status} | ${t.date} |`);
  console.log(path.relative(root, filePath));
}

function main(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  if (options.requireProjectDir && (typeof args['project-dir'] !== 'string' || !path.isAbsolute(args['project-dir']))) {
    console.error('ERROR: the bundled document tool requires --project-dir with the absolute active project path.');
    process.exitCode = 1;
    return;
  }
  const command = args._.shift();
  const title = args._.join(' ').trim() || args.title;
  const root = path.resolve(args['project-dir'] || process.cwd());
  if (!command || !title) {
    console.error(`Usage: node scripts/codex-docs.js <${Object.keys(TYPES).join('|')}> <title>`);
    process.exit(1);
  }
  if (command === 'worklog') return createWorklog(root, title, args);
  if (command === 'hotfix') return createHotfix(root, title, args);
  if (command === 'investigation' || command === 'investigating') return createInvestigation(root, title, args);
  if (command === 'knowledge') return createKnowledge(root, title, args);
  // Every other document type uses the plain template.
  if (Object.prototype.hasOwnProperty.call(TYPES, command)) return createSimple(root, command, title, args);
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = { main, createWorklog, createHotfix, createInvestigation, createKnowledge, createSimple, slugify };
