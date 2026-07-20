'use strict';

const fs = require('fs');
const path = require('path');
const { getStorageRoot, readJsonOrDefault } = require('../utils');
const { REGRESSING_STATE_FILE } = require('../constants');
const { findDocument, readSection } = require('./subagent-context');

const TERMINAL_STATUSES = new Set(['done', 'verified', 'concluded', 'abandoned', 'closed']);
const MAX_WORKFLOW_CONTEXT_CHARS = 5000;

function frontmatterField(content, field) {
  const match = String(content || '').match(new RegExp(`^${field}:\\s*["']?([^\\r\\n"']+)`, 'mi'));
  return match ? match[1].trim() : '';
}

function compact(value, maxChars) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maxChars ? text : text.slice(0, maxChars - 3) + '...';
}

function readPath(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
}

function activeWorklogs(storageRoot) {
  const directory = path.join(storageRoot, 'worklog');
  let names;
  try { names = fs.readdirSync(directory).filter(name => /^W\d+.*\.md$/i.test(name)).sort(); }
  catch { return []; }
  return names.map(name => {
    const filePath = path.join(directory, name);
    const content = readPath(filePath);
    return {
      id: frontmatterField(content, 'id') || path.basename(name).match(/^W\d+/i)?.[0] || name,
      status: (frontmatterField(content, 'status') || 'unknown').toLowerCase(),
      filePath,
      content,
    };
  }).filter(item => !TERMINAL_STATUSES.has(item.status));
}

function regressingContext(projectDir, state, now) {
  if (!state || state.active !== true) return '';
  const storageRoot = getStorageRoot(projectDir);
  const discussionId = state.discussion || null;
  const planId = state.planId || null;
  const ticketIds = Array.isArray(state.ticketIds) ? state.ticketIds : state.ticketId ? [state.ticketId] : [];
  const discussionPath = findDocument(storageRoot, 'discussion', discussionId);
  const planPath = findDocument(storageRoot, 'plan', planId);
  const ticketDocs = ticketIds.map(id => ({ id, path: findDocument(storageRoot, 'ticket', id) }));
  const activeTickets = ticketDocs.map(ticket => {
    const content = readPath(ticket.path);
    return { ...ticket, content, status: (frontmatterField(content, 'status') || 'unknown').toLowerCase() };
  }).filter(ticket => !TERMINAL_STATUSES.has(ticket.status));
  const outcomeSource = activeTickets.length > 0
    ? activeTickets.map(ticket => readSection(ticket.content, 'Acceptance Criteria')).filter(Boolean).join(' | ')
    : readSection(readPath(planPath), 'Acceptance Criteria');
  const updatedAt = state.lastUpdatedAt ? new Date(state.lastUpdatedAt).getTime() : NaN;
  const stale = !Number.isFinite(updatedAt) || now - updatedAt > 24 * 60 * 60 * 1000;
  const paths = [discussionPath, planPath, ...ticketDocs.map(ticket => ticket.path)]
    .filter(Boolean).map(filePath => path.relative(projectDir, filePath)).join(', ');

  return [
    '### Regressing',
    `Phase: ${state.phase || '<unknown>'}`,
    `Discussion: ${discussionId || '<none>'}`,
    `Plan: ${planId || '<none>'}`,
    `Active tickets: ${activeTickets.map(ticket => `${ticket.id} (${ticket.status})`).join(', ') || '<none>'}`,
    `Authoritative documents: ${paths || '<missing>'}`,
    `Unmet outcomes: ${compact(outcomeSource, 1400) || '<not available>'}`,
    `Freshness: ${stale ? 'STALE - confirm the state before execution' : 'current'}`,
  ].join('\n');
}

function worklogContext(projectDir, worklogs) {
  if (worklogs.length === 0) return '';
  const items = worklogs.map(worklog => {
    const contract = readSection(worklog.content, 'Task Contract (internal)');
    const verification = readSection(worklog.content, 'Verification');
    return [
      `### Light workflow ${worklog.id}`,
      `Status: ${worklog.status}`,
      `Authoritative document: ${path.relative(projectDir, worklog.filePath)}`,
      `Task contract: ${compact(contract, 900) || '<not available>'}`,
      `Unmet verification: ${compact(verification, 900) || '<not available>'}`,
    ].join('\n');
  });
  return items.join('\n\n');
}

function buildWorkflowContext(projectDir, options = {}) {
  const storageRoot = getStorageRoot(projectDir);
  const state = readJsonOrDefault(path.join(storageRoot, 'memory', REGRESSING_STATE_FILE), null);
  const regressing = regressingContext(projectDir, state, options.now || Date.now());
  const worklogs = worklogContext(projectDir, activeWorklogs(storageRoot));
  if (!regressing && !worklogs) return '';
  const purpose = options.purpose || 'session';
  const authority = purpose === 'execution'
    ? 'The current user prompt authorizes execution. Continue from the persisted phase, documents, and unmet outcomes below. Do not restart completed workflow setup.'
    : 'This is persisted context, not user authority to resume. Follow the latest user request. If the user asks to continue, start from the unmet outcomes below instead of restarting.';
  const context = ['## Active Crabshell Workflow', authority, regressing, worklogs].filter(Boolean).join('\n\n');
  const maxChars = options.maxChars || MAX_WORKFLOW_CONTEXT_CHARS;
  return context.length <= maxChars ? context : context.slice(0, maxChars - 3) + '...';
}

function validateWorkflowContext(context, options = {}) {
  if (typeof context !== 'string' || !context.includes('## Active Crabshell Workflow')) {
    throw new Error('Active workflow context is missing.');
  }
  for (const marker of options.requiredMarkers || []) {
    if (!context.includes(marker)) throw new Error(`Workflow context is missing required marker: ${marker}`);
  }
  for (const forbidden of ['Skill tool', 'Work Agent', 'Review Agent', 'WA count', 'RA count', 'cycle cap']) {
    if (context.includes(forbidden)) throw new Error(`Workflow context contains fixed or host-specific orchestration wording: ${forbidden}`);
  }
  if (options.purpose === 'session' && !context.includes('not user authority to resume')) {
    throw new Error('Session workflow context is missing the authority boundary.');
  }
  if (options.purpose === 'execution' && !context.includes('current user prompt authorizes execution')) {
    throw new Error('Execution workflow context is missing current-turn authority.');
  }
  return true;
}

module.exports = {
  MAX_WORKFLOW_CONTEXT_CHARS,
  TERMINAL_STATUSES,
  activeWorklogs,
  buildWorkflowContext,
  frontmatterField,
  regressingContext,
  validateWorkflowContext,
  worklogContext,
};
