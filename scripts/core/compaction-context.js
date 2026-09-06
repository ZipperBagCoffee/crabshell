'use strict';

const fs = require('fs');
const path = require('path');
const { getStorageRoot, readJsonOrDefault } = require('../utils');
const { REGRESSING_STATE_FILE } = require('../constants');
const { buildMemoryContext } = require('./memory-context');
const { getPostCompactWarning } = require('../shared-context');

const MAX_CONTEXT_CHARS = 9000;
const TERMINAL_DOC_STATUSES = new Set(['done', 'concluded', 'verified', 'abandoned']);

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
    let content;
    try { content = fs.readFileSync(indexPath, 'utf8'); } catch { continue; }
    for (const line of content.split(/\r?\n/)) {
      if (!line.startsWith('|')) continue;
      const rawCells = line.split(/(?<!\\)\|/).slice(1, -1), cells = [];
      for (let i = 0; i < rawCells.length; i++) {
        let cell = rawCells[i];
        while (cell.includes('[[') && !cell.includes(']]') && i + 1 < rawCells.length) cell += '|' + rawCells[++i];
        cells.push(cell.replace(/\\\|/g, '|').trim());
      }
      if (cells.length < 3) continue;
      const [id, title] = cells;
      const status = cells[2].toLowerCase();
      if (id === 'ID' || id.startsWith('-') || TERMINAL_DOC_STATUSES.has(status)) continue;
      active.push({ type: label, id, title, status });
    }
  }
  return active;
}

function getRegressingSnapshot(projectDir, now = Date.now()) {
  const statePath = path.join(getStorageRoot(projectDir), 'memory', REGRESSING_STATE_FILE);
  const state = readJsonOrDefault(statePath, null);
  if (!state || state.active !== true) return null;
  const updatedAt = state.lastUpdatedAt || null;
  const updatedMs = updatedAt ? new Date(updatedAt).getTime() : NaN;
  return {
    phase: state.phase || null,
    cycle: state.cycle ?? null,
    totalCycles: state.totalCycles ?? null,
    discussion: state.discussion || null,
    planId: state.planId || null,
    ticketIds: Array.isArray(state.ticketIds) ? state.ticketIds : state.ticketId ? [state.ticketId] : [],
    lastUpdatedAt: updatedAt,
    stale: Number.isFinite(updatedMs) ? now - updatedMs > 24 * 60 * 60 * 1000 : true,
    statePath,
  };
}

function boundContext(context, maxChars = MAX_CONTEXT_CHARS) {
  if (maxChars <= 0) return '';
  if (context.length <= maxChars) return context;
  const marker = '\n\n[... compaction context bounded ...]\n\n';
  if (maxChars <= marker.length) return context.slice(0, maxChars);
  const half = Math.floor((maxChars - marker.length) / 2);
  return context.slice(0, half) + marker + context.slice(-half);
}

function buildCompactionContext(projectDir, options = {}) {
  const regressing = getRegressingSnapshot(projectDir, options.now || Date.now());
  const activeDocs = getActiveDocs(projectDir);
  const pinned = '## Crabshell Compaction Recovery Context\n\n' + getPostCompactWarning(projectDir).trim() + '\n\n'
    + require('./recovery-context').buildRecoveryContext(projectDir);
  const maxChars = options.maxChars || MAX_CONTEXT_CHARS;
  if (pinned.length > maxChars) throw new Error('Compaction context limit is smaller than the pinned working rules.');
  const parts = [];

  if (regressing) {
    parts.push('### Active Regressing State');
    parts.push(`Freshness: ${regressing.stale ? 'STALE - confirm before continuation' : 'current'}`);
    parts.push(`Phase: ${regressing.phase || '<unknown>'}`);
    parts.push(`Cycle: ${regressing.cycle ?? '<unknown>'}/${regressing.totalCycles ?? '<unknown>'}`);
    if (regressing.discussion) parts.push(`Discussion: ${regressing.discussion}`);
    if (regressing.planId) parts.push(`Plan: ${regressing.planId}`);
    if (regressing.ticketIds.length > 0) parts.push(`Tickets: ${regressing.ticketIds.join(', ')}`);
    parts.push(`State source: ${regressing.statePath}`);
  } else {
    parts.push('### Active Regressing State\nNone observed.');
  }

  if (activeDocs.length > 0) {
    parts.push('### Active Documents');
    for (const doc of activeDocs) parts.push(`- [${doc.type}] ${doc.id}: ${doc.title} (${doc.status})`);
  } else {
    parts.push('### Active Documents\nNone observed.');
  }

  parts.push(buildMemoryContext(projectDir, { source: 'compact', tailLines: 30, includeRecovery: false, includeCheckpoint: false }).trim());
  return pinned + boundContext(parts.join('\n\n') + '\n', maxChars - pinned.length);
}

function createCompactionOutput(eventName, context) {
  if (!['PreCompact', 'PostCompact'].includes(eventName)) throw new Error(`Unsupported compaction event: ${eventName}`);
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: context,
    },
  };
}

function validateCompactionOutput(output, eventName) {
  const specific = output && output.hookSpecificOutput;
  if (!specific || specific.hookEventName !== eventName) throw new Error(`Expected ${eventName} hook output.`);
  if (typeof specific.additionalContext !== 'string' || !specific.additionalContext.includes('Crabshell Compaction Recovery Context')) {
    throw new Error('Compaction output is missing recovery context.');
  }
  return true;
}

module.exports = {
  MAX_CONTEXT_CHARS,
  TERMINAL_DOC_STATUSES,
  boundContext,
  buildCompactionContext,
  createCompactionOutput,
  getActiveDocs,
  getRegressingSnapshot,
  validateCompactionOutput,
};
