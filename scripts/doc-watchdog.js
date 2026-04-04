'use strict';
const path = require('path');
const fs = require('fs');
const { readStdin, normalizePath } = require('./transcript-utils');

// Constants
const CODE_EXTENSIONS = ['.js','.ts','.jsx','.tsx','.py','.rb','.go','.rs','.java','.c','.cpp','.h','.lua','.php','.sh'];
const EXCLUDED_DIRS = ['.crabshell','.claude','node_modules','.git','dist','build'];
const DOC_PATTERN = /\.crabshell\/(discussion|plan|ticket|investigation)\/[^/]+\.md$/i;
const DOC_WATCHDOG_THRESHOLD = 5;
const STATE_FILE = 'doc-watchdog.json';

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

function getStatePath() {
  return path.join(getProjectDir(), '.crabshell', 'memory', STATE_FILE);
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(getStatePath(), 'utf8'));
  } catch {
    return { editsSinceDocUpdate: 0, lastDocUpdateAt: null, lastCodeEditAt: null, lastCodeEditFile: null };
  }
}

function writeState(state) {
  const dir = path.dirname(getStatePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2));
}

function isCodeFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  // Exclude paths in excluded dirs
  for (const dir of EXCLUDED_DIRS) {
    if (normalized.includes('/' + dir + '/') || normalized.startsWith(dir + '/')) return false;
  }
  const ext = path.extname(normalized).toLowerCase();
  return CODE_EXTENSIONS.includes(ext);
}

function isDocFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  // Must be in .crabshell D/P/T/I dirs, must be .md, must NOT be INDEX.md
  if (DOC_PATTERN.test(normalized) && !normalized.endsWith('INDEX.md')) return true;
  return false;
}

function isRegressingActive() {
  try {
    const statePath = path.join(getProjectDir(), '.crabshell', 'memory', 'regressing-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return state && state.active === true;
  } catch {
    return false;
  }
}

function getRegressingTicketIds() {
  try {
    const statePath = path.join(getProjectDir(), '.crabshell', 'memory', 'regressing-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return (state && state.ticketIds) || [];
  } catch {
    return [];
  }
}

// Mode: record (PostToolUse)
async function record() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') { process.exit(0); return; }

  const input = hookData.tool_input;
  if (!input) { process.exit(0); return; }

  const filePath = normalizePath(input.file_path || input.path || '');
  if (!filePath) { process.exit(0); return; }

  const state = readState();

  if (isCodeFile(filePath)) {
    state.editsSinceDocUpdate = (state.editsSinceDocUpdate || 0) + 1;
    state.lastCodeEditAt = new Date().toISOString();
    state.lastCodeEditFile = filePath;
  } else if (isDocFile(filePath)) {
    state.editsSinceDocUpdate = 0;
    state.lastDocUpdateAt = new Date().toISOString();
    state.lastDocUpdateFile = filePath;
  }

  writeState(state);
  process.exit(0);
}

// Mode: gate (PreToolUse)
async function gate() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') { process.exit(0); return; }

  const input = hookData.tool_input;
  if (!input) { process.exit(0); return; }

  const filePath = normalizePath(input.file_path || input.path || '');
  if (!filePath) { process.exit(0); return; }

  // Only gate code files (doc files are the solution, not the problem)
  if (!isCodeFile(filePath)) { process.exit(0); return; }

  // Only active during regressing
  if (!isRegressingActive()) { process.exit(0); return; }

  const state = readState();
  const threshold = DOC_WATCHDOG_THRESHOLD;

  if (threshold <= 0) { process.exit(0); return; } // 0 = disabled

  if ((state.editsSinceDocUpdate || 0) >= threshold) {
    // Warning via additionalContext (NOT hard block)
    const msg = `[DOC-WATCHDOG] ${state.editsSinceDocUpdate} code edits since last D/P/T document update (threshold: ${threshold}). Update the relevant ticket/plan log before making more code changes. Last code edit: ${state.lastCodeEditFile || 'unknown'}`;
    process.stderr.write(msg + '\n');
    // Return additionalContext for PreToolUse (soft warning, not block)
    const output = JSON.stringify({ additionalContext: msg });
    process.stdout.write(output + '\n');
    process.exit(0);
    return;
  }

  process.exit(0);
}

// Mode: stop (Stop hook)
async function stop() {
  const hookData = await readStdin();

  // Prevent infinite Stop hook loops
  if (hookData && hookData.stop_hook_active) { process.exit(0); return; }

  // Only active during regressing
  if (!isRegressingActive()) { process.exit(0); return; }

  const state = readState();

  // No code edits this session → nothing to check
  if (!state.lastCodeEditAt) { process.exit(0); return; }

  // Check if any ticket has a log entry after the last code edit
  const ticketIds = getRegressingTicketIds();
  if (ticketIds.length === 0) { process.exit(0); return; }

  const projectDir = getProjectDir();
  const ticketDir = path.join(projectDir, '.crabshell', 'ticket');

  for (const ticketId of ticketIds) {
    // Find ticket file
    const pattern = ticketId + '-';
    let ticketFile = null;
    try {
      const files = fs.readdirSync(ticketDir);
      ticketFile = files.find(f => f.startsWith(pattern) || f.startsWith(ticketId + '.'));
      if (!ticketFile) ticketFile = files.find(f => f.includes(ticketId));
    } catch { continue; }

    if (!ticketFile) continue;

    const ticketPath = path.join(ticketDir, ticketFile);
    let content;
    try { content = fs.readFileSync(ticketPath, 'utf8'); } catch { continue; }

    // Check for log entries: ### [YYYY-MM-DD HH:MM]
    const logMatch = content.match(/### \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\]/g);
    if (!logMatch || logMatch.length <= 1) {
      // Only "Created" entry — no work log
      const reason = `Document update pending: ticket ${ticketId} has no work log entry since last code edit (${state.lastCodeEditFile || 'unknown'} at ${state.lastCodeEditAt}). Update the ticket log before ending the session.`;
      process.stderr.write(`[DOC-WATCHDOG] ${reason}\n`);
      process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
      process.exit(2);
      return;
    }
  }

  process.exit(0);
}

// Dispatch by mode
const mode = process.argv[2];
if (mode === 'record') record().catch(() => process.exit(0));
else if (mode === 'gate') gate().catch(() => process.exit(0));
else if (mode === 'stop') stop().catch(() => process.exit(0));
else process.exit(0);
