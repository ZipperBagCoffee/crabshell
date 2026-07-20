'use strict';

const fs = require('fs');
const path = require('path');
const { getStorageRoot, readJsonOrDefault } = require('../utils');
const { REGRESSING_STATE_FILE } = require('../constants');
const { buildMemoryContext } = require('./memory-context');

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
      const match = line.match(/^\|\s*([^\|]+?)\s*\|\s*([^\|]+?)\s*\|\s*([^\|]+?)\s*\|/);
      if (!match) continue;
      const id = match[1].trim();
      const title = match[2].trim();
      const status = match[3].trim().toLowerCase();
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
  if (context.length <= maxChars) return context;
  const marker = '\n\n[... compaction context bounded ...]\n\n';
  const half = Math.floor((maxChars - marker.length) / 2);
  return context.slice(0, half) + marker + context.slice(-half);
}

function buildCompactionContext(projectDir, options = {}) {
  const regressing = getRegressingSnapshot(projectDir, options.now || Date.now());
  const activeDocs = getActiveDocs(projectDir);
  const parts = [
    '## Crabshell Compaction Recovery Context',
    `Project root: ${projectDir}`,
    'Do not resume prior work solely because it appears in compacted context. Follow the next user instruction.',
  ];

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

  parts.push(buildMemoryContext(projectDir, { source: 'compact', tailLines: 30 }).trim());
  return boundContext(parts.join('\n\n') + '\n', options.maxChars);
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
