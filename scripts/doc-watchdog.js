'use strict';
const path = require('path');
const fs = require('fs');
const { readStdin, normalizePath } = require('./transcript-utils');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir } = require('./utils');
const { isSourceFile } = require('./core/command-observation');

// Constants
const DOC_PATTERN = /^\.crabshell\/(discussion|plan|ticket|investigation|hotfix)\/[^/]+\.md$/i;
const DOC_WATCHDOG_THRESHOLD = 5;
const STATE_FILE = 'doc-watchdog.json';

function getStatePath(projectDir) {
  return path.join(projectDir, '.crabshell', 'memory', STATE_FILE);
}

function readState(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(getStatePath(projectDir), 'utf8'));
  } catch {
    return { editsSinceDocUpdate: 0, lastDocUpdateAt: null, lastCodeEditAt: null, lastCodeEditFile: null };
  }
}

function writeState(projectDir, state) {
  const dir = path.dirname(getStatePath(projectDir));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getStatePath(projectDir), JSON.stringify(state, null, 2));
}

// Path relative to the project, or null for a file outside it (scratch copies,
// other projects): those edits say nothing about this project's documents.
function projectRelative(projectDir, filePath) {
  const relative = path.relative(projectDir, path.resolve(projectDir, filePath));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
  return normalizePath(relative);
}

// Same source definition as the commit gate (core/command-observation).
function isCodeFile(projectDir, filePath) {
  const relative = projectRelative(projectDir, filePath);
  return relative !== null && isSourceFile(relative);
}

// A D/P/T/I/H document of this project, excluding INDEX.md.
function isDocFile(projectDir, filePath) {
  const relative = projectRelative(projectDir, filePath);
  return relative !== null && DOC_PATTERN.test(relative) && !relative.endsWith('INDEX.md');
}

function readRegressingState(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, '.crabshell', 'memory', 'regressing-state.json'), 'utf8'));
  } catch {
    return null;
  }
}

// The edited file of a Write/Edit payload, or '' when there is none.
function editedFile(hookData) {
  if (!hookData || (hookData.tool_name !== 'Write' && hookData.tool_name !== 'Edit') || !hookData.tool_input) return '';
  return normalizePath(hookData.tool_input.file_path || hookData.tool_input.path || '');
}

// PostToolUse: count code edits since the last document update.
function recordEdit(hookData, projectDir) {
  const filePath = editedFile(hookData);
  if (!filePath) return;
  const state = readState(projectDir);
  if (isCodeFile(projectDir, filePath)) {
    state.editsSinceDocUpdate = (state.editsSinceDocUpdate || 0) + 1;
    state.lastCodeEditAt = new Date().toISOString();
    state.lastCodeEditFile = filePath;
  } else if (isDocFile(projectDir, filePath)) {
    state.editsSinceDocUpdate = 0;
    state.lastDocUpdateAt = new Date().toISOString();
    state.lastDocUpdateFile = filePath;
  }
  writeState(projectDir, state);
}

// PreToolUse: a soft warning (never a block) after too many code edits during regressing.
// Returns { context, log } or null.
function gateEdit(hookData, projectDir) {
  const filePath = editedFile(hookData);
  // Only gate code files (doc files are the solution, not the problem)
  if (!filePath || !isCodeFile(projectDir, filePath)) return null;
  const regressing = readRegressingState(projectDir);
  if (!regressing || regressing.active !== true) return null;
  const threshold = DOC_WATCHDOG_THRESHOLD;
  if (threshold <= 0) return null; // 0 = disabled
  const state = readState(projectDir);
  if ((state.editsSinceDocUpdate || 0) < threshold) return null;
  const msg = `[DOC-WATCHDOG] ${state.editsSinceDocUpdate} code edits since last D/P/T document update (threshold: ${threshold}). Update the relevant ticket/plan log before making more code changes. Last code edit: ${state.lastCodeEditFile || 'unknown'}`;
  return { context: msg, log: msg };
}

// Stop: the reason to keep going when a regressing ticket has no work log after
// code edits, or null.
function stopReason(payload, projectDir) {
  // Prevent infinite Stop hook loops
  if (payload && payload.stop_hook_active) return null;
  const regressing = readRegressingState(projectDir);
  if (!regressing || regressing.active !== true) return null;
  const state = readState(projectDir);
  // No code edits this session → nothing to check
  if (!state.lastCodeEditAt) return null;
  const ticketIds = regressing.ticketIds || [];
  const ticketDir = path.join(projectDir, '.crabshell', 'ticket');
  for (const ticketId of ticketIds) {
    let ticketFile = null;
    try {
      const files = fs.readdirSync(ticketDir);
      ticketFile = files.find(f => f.startsWith(ticketId + '-') || f.startsWith(ticketId + '.'));
      if (!ticketFile) ticketFile = files.find(f => f.includes(ticketId));
    } catch { continue; }
    if (!ticketFile) continue;
    let content;
    try { content = fs.readFileSync(path.join(ticketDir, ticketFile), 'utf8'); } catch { continue; }
    // Check for log entries: ### [YYYY-MM-DD HH:MM]
    const logMatch = content.match(/### \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/g);
    if (!logMatch || logMatch.length <= 1) {
      // Only "Created" entry — no work log
      return `Document update pending: ticket ${ticketId} has no work log entry since last code edit (${state.lastCodeEditFile || 'unknown'} at ${state.lastCodeEditAt}). Update the ticket log before ending the session.`;
    }
  }
  return null;
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

module.exports = { recordEdit, gateEdit, stopReason };
