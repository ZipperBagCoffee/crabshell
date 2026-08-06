'use strict';

/**
 * pre-compact.js — PreCompact hook
 * Outputs PLAIN TEXT to stdout (not JSON). Claude Code feeds this as context
 * before compacting the conversation. Use it to preserve memory and state
 * that would otherwise be lost after compaction.
 *
 * Fail-open: process.exit(0) on any error.
 */

const fs = require('fs');
const path = require('path');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { readStdin } = require('./transcript-utils');
const { getProjectDir, getStorageRoot, readJsonOrDefault } = require('./utils');
const { REGRESSING_STATE_FILE } = require('./constants');

// Caps for the active-docs listing (I083 R1 / D113): compaction happens when
// context is scarcest, so this injection must stay bounded no matter how many
// non-terminal docs have accumulated in the indexes.
const MAX_ACTIVE_DOCS_PER_TYPE = 5;
const MAX_ACTIVE_DOCS_CHARS = 4000;

function getActiveDocs(projectDir) {
  const storageRoot = getStorageRoot(projectDir);
  const docTypes = [
    { dir: 'discussion', label: 'Discussion' },
    { dir: 'plan', label: 'Plan' },
    { dir: 'ticket', label: 'Ticket' },
    { dir: 'investigation', label: 'Investigation' },
  ];
  const active = [];
  let omitted = 0;

  for (const { dir, label } of docTypes) {
    const indexPath = path.join(storageRoot, dir, 'INDEX.md');
    if (!fs.existsSync(indexPath)) continue;
    try {
      const content = fs.readFileSync(indexPath, 'utf8');
      const lines = content.split(/\r?\n/);
      let typeRows = [];
      for (const line of lines) {
        // Table rows: | ID | Title | Status | ...
        // Cells may contain wikilinks with escaped pipes ([[slug\|ID]]), so
        // split on unescaped pipes only, then unescape.
        if (!line.startsWith('|')) continue;
        const rawCells = line.split(/(?<!\\)\|/).slice(1, -1);
        // Re-join cells that were split inside an unescaped wikilink [[slug|ID]]
        const cells = [];
        for (let i = 0; i < rawCells.length; i++) {
          let cell = rawCells[i];
          while (cell.includes('[[') && !cell.includes(']]') && i + 1 < rawCells.length) {
            i += 1;
            cell = cell + '|' + rawCells[i];
          }
          cells.push(cell.replace(/\\\|/g, '|').trim());
        }
        if (cells.length < 3) continue;
        const id = cells[0];
        const title = cells[1];
        const status = cells[2].toLowerCase();
        if (id === 'ID' || /^-+$/.test(id)) continue; // header/separator rows
        if (['done', 'concluded', 'verified', 'abandoned'].includes(status)) continue;
        typeRows.push(`  - [${label}] ${id}: ${title} (${status})`);
      }
      // INDEX rows are appended chronologically — keep the newest per type
      if (typeRows.length > MAX_ACTIVE_DOCS_PER_TYPE) {
        omitted += typeRows.length - MAX_ACTIVE_DOCS_PER_TYPE;
        typeRows = typeRows.slice(-MAX_ACTIVE_DOCS_PER_TYPE);
      }
      active.push(...typeRows);
    } catch (e) { /* ignore */ }
  }

  let total = 0;
  const capped = [];
  for (const line of active) {
    if (total + line.length + 1 > MAX_ACTIVE_DOCS_CHARS) {
      omitted += active.length - capped.length;
      break;
    }
    capped.push(line);
    total += line.length + 1;
  }
  if (omitted > 0) {
    capped.push(`  - ...and ${omitted} more non-terminal docs (see .crabshell/*/INDEX.md)`);
  }
  return capped;
}

async function main() {
  let stdinData = {};
  try {
    stdinData = await readStdin(2000);
  } catch (e) { /* fail-open */ }

  let projectDir;
  try {
    projectDir = getProjectDir();
  } catch (e) {
    process.exit(0);
  }

  const lines = [];
  lines.push('## [CRABSHELL PRE-COMPACT CONTEXT]');
  lines.push('Preserve the following when compacting. Do NOT summarize these away.\n');

  // 1. Project concept (first line of project.md)
  try {
    const projectMdPath = path.join(getStorageRoot(projectDir), 'project.md');
    if (fs.existsSync(projectMdPath)) {
      const content = fs.readFileSync(projectMdPath, 'utf8').trim();
      const firstLine = content.split(/\r?\n/)[0] || '';
      if (firstLine) {
        lines.push(`**Project:** ${firstLine}`);
      }
    }
  } catch (e) { /* ignore */ }

  // 2. Active regressing state
  try {
    const regressingStatePath = path.join(getStorageRoot(projectDir), 'memory', REGRESSING_STATE_FILE);
    const state = readJsonOrDefault(regressingStatePath, null);
    if (state && state.active === true) {
      lines.push('');
      lines.push('**Regressing State (PRESERVE — do NOT lose after compaction):**');
      lines.push(`  Phase: ${state.phase}, Cycle: ${state.cycle}/${state.totalCycles}`);
      if (state.discussion) lines.push(`  Discussion: ${state.discussion}`);
      if (state.planId) lines.push(`  Plan: ${state.planId}`);
      if (state.ticketIds && state.ticketIds.length > 0) {
        lines.push(`  Tickets: ${state.ticketIds.join(', ')}`);
      }
      lines.push(`  File: ${regressingStatePath}`);
    }
  } catch (e) { /* ignore */ }

  // 3. Active D/P/T/I documents
  try {
    const activeDocs = getActiveDocs(projectDir);
    if (activeDocs.length > 0) {
      lines.push('');
      lines.push('**Active Documents (status not done/concluded/verified):***');
      for (const doc of activeDocs) {
        lines.push(doc);
      }
    }
  } catch (e) { /* ignore */ }

  // 4. Recovery reminder
  lines.push('');
  lines.push('**After compaction:**');
  lines.push('- Re-read CLAUDE.md before acting');
  lines.push('- Project root: ' + projectDir);
  lines.push('- Run load-memory if session context is lost');

  process.stdout.write(lines.join('\n') + '\n');
  process.stderr.write('[CRABSHELL] PreCompact: context written (' + lines.length + ' lines)\n');
  process.exit(0);
}

main().catch(e => {
  process.stderr.write('[CRABSHELL] PreCompact error: ' + (e.message || e) + '\n');
  process.exit(0); // fail-open
});
