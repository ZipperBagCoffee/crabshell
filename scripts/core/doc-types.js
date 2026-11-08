'use strict';

const { STORAGE_ROOT, TICKET_DIR } = require('../constants');

// Document types, one row per folder under STORAGE_ROOT. Each flag names a
// feature that covers the folder, so consumers derive their list from here:
//   workflow    D/P/T/I/H documents (doc watchdog, INDEX log guard)
//   skillOnly   written only while a document skill is active (docs guard)
//   linked      Obsidian link lint and frontmatter migration
//   tracked     listed as active work in compaction recovery context
//   regressing  its skill advances the regressing phase
// indexColumns is the INDEX.md header the bundled Codex document tool writes.
const DOC_TYPES = [
  { dir: 'discussion', prefix: 'D', title: 'Discussion', skill: 'discussing', workflow: true, skillOnly: true, linked: true, tracked: true, regressing: true, indexColumns: ['ID', 'Topic', 'Status', 'Date'] },
  { dir: 'plan', prefix: 'P', title: 'Plan', skill: 'planning', workflow: true, skillOnly: true, linked: true, tracked: true, regressing: true, indexColumns: ['ID', 'Plan', 'Status', 'Date', 'Related'] },
  { dir: 'ticket', prefix: 'T', title: 'Ticket', skill: 'ticketing', workflow: true, skillOnly: true, linked: true, tracked: true, regressing: true, indexColumns: ['ID', 'Ticket', 'Status', 'Date', 'Parent'] },
  { dir: 'investigation', prefix: 'I', title: 'Investigation', skill: 'investigating', workflow: true, skillOnly: true, linked: true, tracked: true, indexColumns: ['ID', 'Title', 'Status', 'Created', 'Related'] },
  { dir: 'hotfix', prefix: 'H', title: 'Hotfix', skill: 'hotfix', workflow: true, skillOnly: true, linked: true, indexColumns: ['ID', 'Title', 'Status', 'Date'] },
  { dir: 'worklog', prefix: 'W', title: 'Worklog', skillOnly: true, linked: true, indexColumns: ['ID', 'Task', 'Status', 'Date', 'Related'] },
  { dir: 'knowledge', prefix: 'K', title: 'Knowledge', indexColumns: ['ID', 'Title', 'Cat', 'Tags', 'Source'] },
];

// Ticket IDs are <parent>_T<NNN>. The parent is a discussion (D###, the current
// form: the discussion carries the plan) or a plan (P###, kept for existing
// documents). Regex sources, so every guard derives the same shape.
const TICKET_PARENT_SOURCE = '[DP]\\d{3}';
const TICKET_ID_SOURCE = '[DP]\\d{3}_T\\d{3}';
// Skills allowed to write documents: each type's own skill plus the two
// workflow skills that drive them.
const DOC_SKILLS = [...new Set(DOC_TYPES.map(type => type.skill).filter(Boolean)), 'regressing', 'verifying'];

// Regex source for "<STORAGE_ROOT>/(<dir>|...)" over the document types a
// filter keeps (DOC_TYPES above), so guards never retype the folder list.
function docDirsPattern(filter) {
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `${escape(STORAGE_ROOT)}\\/(${DOC_TYPES.filter(filter).map(type => escape(type.dir)).join('|')})`;
}

// Regex source for a ticket document path "<STORAGE_ROOT>/ticket/<ticket id>"
// (TICKET_ID_SOURCE above: a discussion or plan parent).
function ticketDocPattern() {
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `${escape(STORAGE_ROOT)}\\/${escape(TICKET_DIR)}\\/${TICKET_ID_SOURCE}`;
}

module.exports = { DOC_TYPES, TICKET_PARENT_SOURCE, TICKET_ID_SOURCE, DOC_SKILLS, docDirsPattern, ticketDocPattern };
