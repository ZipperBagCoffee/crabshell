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

function getActiveDocs(projectDir) {
  const storageRoot = getStorageRoot(projectDir);
  const docTypes = [
    { dir: 'discussion', label: 'Discussion' },
    { dir: 'plan', label: 'Plan' },
    { dir: 'ticket', label: 'Ticket' },
    { dir: 'investigation', label: 'Investigation' },
  ];
  const active = [];

  for (const { dir, label } of docTypes) {
    const indexPath = path.join(storageRoot, dir, 'INDEX.md');
    if (!fs.existsSync(indexPath)) continue;
    try {
      const content = fs.readFileSync(indexPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        // Table rows: | ID | Title | Status | ...
        // Match rows where status is NOT done/concluded/verified/abandoned
        const match = line.match(/^\|\s*([^\|]+?)\s*\|\s*([^\|]+?)\s*\|\s*([^\|]+?)\s*\|/);
        if (!match) continue;
        const id = match[1].trim();
        const title = match[2].trim();
        const status = match[3].trim().toLowerCase();
        if (id === 'ID' || id.startsWith('-')) continue; // header/separator rows
        if (['done', 'concluded', 'verified', 'abandoned'].includes(status)) continue;
        active.push(`  - [${label}] ${id}: ${title} (${status})`);
      }
    } catch (e) { /* ignore */ }
  }
  return active;
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
