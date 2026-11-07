'use strict';
const path = require('path');
const fs = require('fs');
const { readStdin, normalizePath } = require('./transcript-utils');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir, readJsonOrDefault, docDirsPattern } = require('./utils');
const { isProjectInput } = require('./core/project-state');
const { writtenPaths } = require('./core/tool-shape');
const { readSessionState, writeSessionState } = require('./core/session-state');
const { sessionId } = require('./core/turn-id');
const { readIndexRows } = require('./core/index-rows');
const { STORAGE_ROOT, MEMORY_DIR, TICKET_DIR, DOC_WATCHDOG_FILE, DOC_WATCHDOG_THRESHOLD, REGRESSING_STATE_FILE } = require('./constants');

const DOC_PATTERN = new RegExp(`^${docDirsPattern(type => type.workflow)}\\/[^/]+\\.md$`, 'i');
// Per-session record (D147_T004): one session's edits never remind another session.
const STATE_NAME = path.basename(DOC_WATCHDOG_FILE, '.json');
// Ticket INDEX statuses that end a ticket (the ticketing skill's terminal statuses).
const FINISHED_STATUSES = new Set(['verified', 'abandoned']);

function emptyState() {
  return { editsSinceDocUpdate: 0, lastDocUpdateAt: null, lastCodeEditAt: null, lastCodeEditFile: null, docsWritten: {} };
}

function readState(projectDir, payload) {
  const session = sessionId(payload || {});
  if (!session) return emptyState();
  return { ...emptyState(), ...(readSessionState(projectDir, session, STATE_NAME, null) || {}) };
}

function writeState(projectDir, payload, state) {
  const session = sessionId(payload || {});
  if (session) writeSessionState(projectDir, session, STATE_NAME, state);
}

// Path relative to the project, or null for a file outside it (scratch copies,
// other projects): those edits say nothing about this project's documents.
function projectRelative(projectDir, filePath) {
  const relative = path.relative(projectDir, path.resolve(projectDir, filePath));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
  return normalizePath(relative);
}

// A project file as the runner sees it (core/project-state): inside the project, not
// excluded by the manifest, not Crabshell's own storage — no extension list.
function isCodeFile(projectDir, filePath) {
  return projectRelative(projectDir, filePath) !== null && isProjectInput(projectDir, filePath);
}

// A D/P/T/I/H document of this project, excluding INDEX.md.
function isDocFile(projectDir, filePath) {
  const relative = projectRelative(projectDir, filePath);
  return relative !== null && DOC_PATTERN.test(relative) && !relative.endsWith('INDEX.md');
}

function readRegressingState(projectDir) {
  return readJsonOrDefault(path.join(projectDir, STORAGE_ROOT, MEMORY_DIR, REGRESSING_STATE_FILE), null);
}

// The files a call writes, whatever the tool is named (core/tool-shape).
function editedFiles(hookData) {
  return writtenPaths(hookData).map(normalizePath).filter(Boolean);
}

// PostToolUse: count code edits since the last document update. A call counts once:
// a document it writes resets the count, otherwise a code file it writes adds one.
function recordEdit(hookData, projectDir) {
  if (!sessionId(hookData || {})) return;
  const filePaths = editedFiles(hookData);
  if (!filePaths.length) return;
  const state = readState(projectDir, hookData);
  const doc = filePaths.find(filePath => isDocFile(projectDir, filePath));
  const code = filePaths.find(filePath => isCodeFile(projectDir, filePath));
  const now = new Date().toISOString();
  if (doc) {
    state.editsSinceDocUpdate = 0;
    state.lastDocUpdateAt = now;
    state.lastDocUpdateFile = doc;
    state.docsWritten = { ...(state.docsWritten || {}), [projectRelative(projectDir, doc)]: now };
  } else if (code) {
    state.editsSinceDocUpdate = (state.editsSinceDocUpdate || 0) + 1;
    state.lastCodeEditAt = now;
    state.lastCodeEditFile = code;
  }
  writeState(projectDir, hookData, state);
}

// PreToolUse: a soft warning (never a block) after too many code edits during regressing.
// Returns { context, log } or null.
function gateEdit(hookData, projectDir) {
  // Only gate code files (doc files are the solution, not the problem)
  if (!editedFiles(hookData).some(filePath => isCodeFile(projectDir, filePath))) return null;
  const regressing = readRegressingState(projectDir);
  if (!regressing || regressing.active !== true) return null;
  const threshold = DOC_WATCHDOG_THRESHOLD;
  if (threshold <= 0) return null; // 0 = disabled
  const state = readState(projectDir, hookData);
  if ((state.editsSinceDocUpdate || 0) < threshold) return null;
  const msg = `[DOC-WATCHDOG] ${state.editsSinceDocUpdate} code edits since last D/P/T document update (threshold: ${threshold}). Update the relevant ticket/plan log before making more code changes. Last code edit: ${state.lastCodeEditFile || 'unknown'}`;
  return { context: msg, log: msg };
}

// The workflow's tickets that the ticket INDEX does not mark finished, with their files.
function unfinishedTickets(projectDir, ticketIds) {
  const ticketDir = path.join(projectDir, STORAGE_ROOT, TICKET_DIR);
  let files = [];
  let statuses = new Map();
  try { files = fs.readdirSync(ticketDir); } catch { return []; }
  try {
    statuses = new Map(readIndexRows(fs.readFileSync(path.join(ticketDir, 'INDEX.md'), 'utf8')).map(row => [row.id, row.status]));
  } catch { /* no INDEX: every ticket counts as unfinished */ }
  const tickets = [];
  for (const id of ticketIds) {
    if (FINISHED_STATUSES.has(statuses.get(id))) continue;
    const name = files.find(f => f.startsWith(id + '-') || f === id + '.md');
    if (!name) continue;
    tickets.push({ id, file: path.join(ticketDir, name), relative: normalizePath(path.join(STORAGE_ROOT, TICKET_DIR, name)) });
  }
  return tickets;
}

// True when the ticket was written after the code edit — by this session, or by anyone
// (its file is newer; a shell append is not a recorded write).
function loggedAfter(ticket, state) {
  const written = (state.docsWritten || {})[ticket.relative];
  if (written && written >= state.lastCodeEditAt) return true;
  try { return fs.statSync(ticket.file).mtimeMs >= Date.parse(state.lastCodeEditAt); } catch { return true; }
}

// Stop: the reason to keep going when this session edited code in its execution turn and
// an unfinished workflow ticket was not updated after that edit, or null (D147_T004).
function stopReason(payload, projectDir) {
  const hook = payload || {};
  // Prevent infinite Stop hook loops
  if (hook.stop_hook_active) return null;
  // After a question or a reprimand from the user the turn ends without demands (D147_T003).
  const latest = require('./core/turn-state').latestUserIntent(projectDir, hook);
  if (latest && latest !== 'execution') return null;
  const regressing = readRegressingState(projectDir);
  if (!regressing || regressing.active !== true) return null;
  // Another session's workflow is that session's to log (no owner recorded = unowned).
  if (regressing.sessionId && regressing.sessionId !== sessionId(hook)) return null;
  const control = require('./core/completion-control');
  if (!control.isExecutionAuthorized(control.loadState(projectDir, hook), hook, 'Stop')) return null;
  const state = readState(projectDir, hook);
  if (!state.lastCodeEditAt) return null;
  const unfinished = unfinishedTickets(projectDir, regressing.ticketIds || []);
  const own = unfinished.filter(ticket => (state.docsWritten || {})[ticket.relative]);
  const pending = (own.length ? own : unfinished).filter(ticket => !loggedAfter(ticket, state));
  if (!pending.length) return null;
  return `Document update pending: ${pending.map(ticket => ticket.id).join(', ')} was not updated after your code edit to ${state.lastCodeEditFile || 'a project file'} at ${state.lastCodeEditAt}. Add a work log entry to it before ending the turn.`;
}

async function main(mode) {
  const hookData = await readStdin();
  const projectDir = getProjectDir();
  if (mode === 'record') {
    if (hookData && hookData.tool_name) recordEdit(hookData, projectDir);
  } else if (mode === 'gate') {
    const result = gateEdit(hookData, projectDir);
    if (result) {
      process.stderr.write(result.log + '\n');
      // PreToolUse context reaches the model only through hookSpecificOutput (soft warning, not block)
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: result.context } }) + '\n');
    }
  } else if (mode === 'stop') {
    const reason = stopReason(hookData, projectDir);
    if (reason) {
      process.stderr.write(`[DOC-WATCHDOG] ${reason}\n`);
      process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
      process.exit(2);
      return;
    }
  }
  process.exit(0);
}

if (require.main === module) {
  const mode = process.argv[2];
  if (['record', 'gate', 'stop'].includes(mode)) main(mode).catch(() => process.exit(0));
  else process.exit(0);
}

module.exports = { recordEdit, gateEdit, stopReason, STATE_NAME };
