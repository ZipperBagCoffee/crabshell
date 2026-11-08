'use strict';

const fs = require('fs');
const path = require('path');
const { getStorageRoot, readJsonOrDefault } = require('../utils');
const { REGRESSING_STATE_FILE } = require('../constants');
const { WORKER_PROMPT_CONTRACT, COMPRESSED_CHECKLIST } = require('../shared-context');
const { readProjectConcept, readModelRouting } = require('./project-memory');
const { findDocument, readSection } = require('./doc-lookup');

// Below the host cap: Claude Code moves hook additionalContext over 10,000 characters
// to a file (see SESSION_START_MAX_CHARS). At 6,000 an active regressing task scope
// pushed the end of the checklist off the context.
const MAX_CONTEXT_CHARS = 9500;

function readDocument(storageRoot, directory, id) {
  const filePath = findDocument(storageRoot, directory, id);
  if (!filePath) return { id, filePath: null, content: '' };
  try { return { id, filePath, content: fs.readFileSync(filePath, 'utf8') }; }
  catch { return { id, filePath, content: '' }; }
}

function compact(value, maxChars) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)) + '...';
}

function activeTaskScope(projectDir) {
  const storageRoot = getStorageRoot(projectDir);
  const state = readJsonOrDefault(path.join(storageRoot, 'memory', REGRESSING_STATE_FILE), null);
  if (!state || state.active !== true) return '';
  const discussionId = state.discussion || null;
  const planId = state.planId || null;
  const ticketIds = Array.isArray(state.ticketIds) ? state.ticketIds : state.ticketId ? [state.ticketId] : [];
  const discussion = readDocument(storageRoot, 'discussion', discussionId);
  const plan = readDocument(storageRoot, 'plan', planId);
  const tickets = ticketIds.map(id => readDocument(storageRoot, 'ticket', id));
  const ticketIntent = tickets.map(ticket => readSection(ticket.content, 'Intent')).filter(Boolean).join(' | ');
  const ticketAllowed = tickets.map(ticket => readSection(ticket.content, 'Allowed Files')).filter(Boolean).join(' | ');
  const ticketAcceptance = tickets.map(ticket => readSection(ticket.content, 'Acceptance Criteria')).filter(Boolean).join(' | ');
  const planScope = readSection(plan.content, 'Scope');
  // Discussion-based cycles have no plan: each ticket's own Scope (Included / Excluded) is the boundary.
  const ticketScopes = tickets.map(ticket => readSection(ticket.content, 'Scope')).filter(Boolean);
  const scopePart = (text, excluded) => { const at = text.search(/Excluded:/i); return at < 0 ? text : (excluded ? text.slice(at) : text.slice(0, at)).trim(); };
  const ticketIncluded = ticketScopes.map(text => scopePart(text, false)).join(' | ');
  const ticketExcluded = ticketScopes.map(text => scopePart(text, true)).join(' | ');
  const discussionNonGoals = readSection(discussion.content, 'Non-Goals');
  const references = [discussion, plan, ...tickets]
    .filter(document => document.id)
    .map(document => document.filePath ? `${document.id} (${path.relative(projectDir, document.filePath)})` : `${document.id} (missing)`)
    .join(', ');

  return [
    '## Active Worker Task Scope',
    `Original request / governing intent: ${compact(readSection(discussion.content, 'Intent'), 500) || '<not available>'}`,
    `Exact task: ${compact(ticketIntent || readSection(plan.content, 'Intent'), 600) || '<not available>'}`,
    `Non-goals: ${compact(discussionNonGoals, 550) || '<not available>'}`,
    `Authoritative references: ${references || '<not available>'}`,
    `Allowed changes: ${compact(ticketAllowed || planScope || ticketIncluded, 650) || '<not available>'}`,
    `Forbidden changes: ${compact(planScope || ticketExcluded, 550) || '<not available>'}`,
    `Observable success: ${compact(ticketAcceptance || readSection(plan.content, 'Acceptance Criteria'), 900) || '<not available>'}`,
  ].join('\n');
}

function buildSubagentContext(projectDir, options = {}) {
  const parts = [];
  const nodePath = process.execPath.replace(/\\/g, '/');
  parts.push(
    `## Project Root Anchor\nProject root: \`${projectDir}\`\n` +
    `Node.js path: \`${nodePath}\`\n` +
    'All file paths are relative to project root.'
  );

  const concept = readProjectConcept(projectDir, 20, 500);
  if (concept) parts.push(`## Project Concept\n${concept}`);
  const routing = readModelRouting(projectDir, 300);
  if (routing) parts.push(routing);

  const storageRoot = getStorageRoot(projectDir);
  const state = readJsonOrDefault(path.join(storageRoot, 'memory', REGRESSING_STATE_FILE), null);
  if (state && state.active === true) {
    let text = `## Regressing State\nPhase: ${state.phase}, Cycle: ${state.cycle}/${state.totalCycles}`;
    if (state.discussion) text += `\nDiscussion: ${state.discussion}`;
    if (state.planId) text += `\nPlan: ${state.planId}`;
    const tickets = Array.isArray(state.ticketIds) ? state.ticketIds : state.ticketId ? [state.ticketId] : [];
    if (tickets.length > 0) text += `\nTickets: ${tickets.join(', ')}`;
    parts.push(text);
  }

  const scope = activeTaskScope(projectDir);
  if (scope) parts.push(scope);
  parts.push(WORKER_PROMPT_CONTRACT.trim());
  parts.push(COMPRESSED_CHECKLIST.trim());

  const maxChars = options.maxChars || MAX_CONTEXT_CHARS;
  const context = parts.join('\n\n');
  return context.length <= maxChars ? context : context.slice(0, maxChars - 3) + '...';
}

function createSubagentOutput(context) {
  return {
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: context,
    },
  };
}

function validateSubagentOutput(output, requiredMarkers = []) {
  const specific = output && output.hookSpecificOutput;
  if (!specific || specific.hookEventName !== 'SubagentStart') throw new Error('Expected SubagentStart hook output.');
  const context = specific.additionalContext;
  if (typeof context !== 'string' || !context.includes('## Worker Contract') || !context.includes('## Project Root Anchor')) {
    throw new Error('SubagentStart output is missing the shared worker context.');
  }
  for (const marker of requiredMarkers) {
    if (!context.includes(marker)) throw new Error(`SubagentStart output is missing required task marker: ${marker}`);
  }
  return true;
}

module.exports = {
  MAX_CONTEXT_CHARS,
  activeTaskScope,
  buildSubagentContext,
  compact,
  createSubagentOutput,
  readDocument,
  validateSubagentOutput,
};
