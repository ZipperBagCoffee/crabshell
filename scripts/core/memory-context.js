'use strict';

const fs = require('fs');
const path = require('path');
const { getStorageRoot, readFileOrDefault, readJsonOrDefault } = require('../utils');
const {
  MEMORY_DIR,
  SESSIONS_DIR,
  INDEX_FILE,
  MEMORY_FILE,
  SESSION_START_MAX_CHARS,
} = require('../constants');
const { getPostCompactWarning, getProjectMemoryPath } = require('../shared-context');
const { buildWorkflowContext } = require('./workflow-context');

const DEFAULT_TAIL_LINES = 50;

const MEMORY_NOTES = `
## Crabshell Operational Notes
- When you make a mistake, explain the reasoning that led to it.
- Crabshell project memory is stored under .crabshell; it is separate from host-managed memory.

## Memory Timestamp Format
Session headers use: \`## YYYY-MM-DD_HHMM (local MM-DD_HHMM)\`
- First timestamp: UTC time (primary reference)
- Second timestamp: user's local time (context)
`;

function getUnreflectedL1Content(l1Path, memoryContent) {
  try {
    const lines = fs.readFileSync(l1Path, 'utf8').split(/\r?\n/).filter(line => line.trim()).slice(-50);
    const summary = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role !== 'assistant' || !entry.text) continue;
        const text = typeof entry.text === 'string'
          ? entry.text
          : entry.text.map(content => content.text || '').join('');
        if (text.length > 50 && !memoryContent.includes(text.substring(0, 50))) {
          summary.push(text.substring(0, 200));
        }
      } catch {}
    }
    return summary.length > 0 ? summary : null;
  } catch {
    return null;
  }
}

// Section caps (characters) inside the SessionStart budget, highest priority first.
const PART_CAPS = {
  project: 1200, workflow: 2500, recovery: 2000, recent: 6000,
  previous: 1200, pending: 400, unreflected: 800, digest: 2500,
};
const MIN_PART_CHARS = 80;

// Keep the end of the text, starting at a line boundary when one is available.
function tailWithin(text, limit) {
  if (text.length <= limit) return text;
  const slice = text.slice(-limit);
  const newline = slice.indexOf('\n');
  return newline >= 0 && newline < slice.length - 1 ? slice.slice(newline + 1) : slice;
}

function headWithin(text, limit) {
  if (text.length <= limit) return text;
  const marker = '\n[... truncated for the SessionStart budget ...]';
  return text.slice(0, Math.max(0, limit - marker.length)) + marker;
}

function collectMemorySections(projectDir, options = {}) {
  const storageRoot = getStorageRoot(projectDir);
  const memoryDir = path.join(storageRoot, MEMORY_DIR);
  const parts = {};
  const pendingSummaries = [];

  const projectText = readFileOrDefault(getProjectMemoryPath(projectDir), '').trim();
  if (projectText) parts.project = `## Project Overview\n${projectText}`;

  const index = readJsonOrDefault(path.join(memoryDir, INDEX_FILE), null);
  const rotatedFiles = index && Array.isArray(index.rotatedFiles) ? index.rotatedFiles : [];
  for (const entry of rotatedFiles.filter(candidate => !candidate.summaryGenerated)) {
    if (entry && entry.file) pendingSummaries.push(entry.file);
  }
  if (pendingSummaries.length > 0) parts.pending = `## Pending Memory Summaries\n${pendingSummaries.map(file => `- ${file}`).join('\n')}`;
  const generated = rotatedFiles.filter(entry => entry && entry.summaryGenerated && entry.summary);
  if (generated.length > 0) {
    const latest = generated[generated.length - 1];
    const summary = readJsonOrDefault(path.join(memoryDir, latest.summary), null);
    if (summary && summary.overallSummary) {
      parts.previous = `## Previous Memory Summary\n${summary.overallSummary}`;
    }
  }

  const memoryPath = path.join(memoryDir, MEMORY_FILE);
  const memoryContent = readFileOrDefault(memoryPath, '');
  const sessionsDir = path.join(storageRoot, SESSIONS_DIR);
  if (fs.existsSync(sessionsDir)) {
    const l1Files = fs.readdirSync(sessionsDir).filter(file => file.endsWith('.l1.jsonl')).sort().reverse();
    if (l1Files.length > 0) {
      const unreflected = getUnreflectedL1Content(path.join(sessionsDir, l1Files[0]), memoryContent);
      if (unreflected) parts.unreflected = `## Unreflected from Last Session\n${unreflected.join('\n')}`;
    }
  }

  if (memoryContent.trim()) {
    const tailLines = Number(options.tailLines || DEFAULT_TAIL_LINES);
    const lines = memoryContent.split(/\r?\n/);
    parts.recent = lines.length > tailLines ? lines.slice(-tailLines).join('\n') : memoryContent;
  }

  const mocDigest = readFileOrDefault(path.join(storageRoot, 'moc-digest.md'), '').trim();
  if (mocDigest) parts.digest = mocDigest;

  const sections = ['project', 'previous', 'unreflected', 'recent', 'digest']
    .filter(name => parts[name])
    .map(name => name === 'recent' ? `## Recent Sessions\n${parts.recent}` : parts[name]);
  return { sections, parts, pendingSummaries };
}

// Assemble the context within the budget: parts are admitted in priority order
// (each cut to its cap and to what is left), then rendered in reading order.
function buildMemoryContext(projectDir, options = {}) {
  const source = options.source || 'unknown';
  const projectName = path.basename(projectDir);
  const budget = options.maxChars || SESSION_START_MAX_CHARS;
  const { parts } = collectMemorySections(projectDir, options);
  const workflowContext = buildWorkflowContext(projectDir, { purpose: 'session', now: options.now }) || '';
  const recovery = options.includeCheckpoint !== false
    ? require('./recovery-context').buildRecoveryContext(projectDir, options.sessionId).trim() : '';
  const hasMemory = Boolean(parts.project || parts.previous || parts.unreflected || parts.recent || parts.digest);

  const header = hasMemory ? `=== Crabshell: ${projectName} ===` : `--- Crabshell: No memory for ${projectName} ---`;
  const warning = source === 'compact' && options.includeRecovery !== false ? getPostCompactWarning(projectDir).trim() : '';
  const footer = [MEMORY_NOTES.trim(), hasMemory ? '=== End of Memory ===' : ''].filter(Boolean);
  let remaining = budget - [header, warning, ...footer].join('\n\n').length - 120;

  const admitted = {};
  function admit(name, text, keepTail) {
    if (!text) return;
    const limit = Math.min(PART_CAPS[name], remaining);
    if (limit < MIN_PART_CHARS) return;
    admitted[name] = keepTail ? tailWithin(text, limit) : headWithin(text, limit);
    remaining -= admitted[name].length + 7;
  }
  admit('project', parts.project);
  admit('workflow', workflowContext.trim());
  admit('recovery', recovery);
  if (parts.recent) {
    const heading = '## Recent Sessions (newest last)\n';
    const limit = Math.min(PART_CAPS.recent, remaining) - heading.length;
    if (limit >= MIN_PART_CHARS) {
      admitted.recent = heading + tailWithin(parts.recent, limit);
      remaining -= admitted.recent.length + 7;
    }
  }
  admit('previous', parts.previous);
  admit('pending', parts.pending);
  admit('unreflected', parts.unreflected);
  admit('digest', parts.digest);

  const memoryBody = ['project', 'previous', 'pending', 'recent', 'unreflected', 'digest']
    .filter(name => admitted[name]).map(name => admitted[name]).join('\n\n---\n\n');
  const output = [header, warning, memoryBody, admitted.workflow, admitted.recovery, ...footer];
  return output.filter(Boolean).join('\n\n') + '\n';
}

function createSessionStartOutput(context) {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  };
}

function validateSessionStartOutput(output) {
  const specific = output && output.hookSpecificOutput;
  if (!specific || specific.hookEventName !== 'SessionStart') throw new Error('Expected SessionStart hook output.');
  if (typeof specific.additionalContext !== 'string' || !specific.additionalContext.includes('Crabshell:')) {
    throw new Error('SessionStart output is missing Crabshell memory context.');
  }
  return true;
}

module.exports = {
  DEFAULT_TAIL_LINES,
  MEMORY_NOTES,
  buildMemoryContext,
  collectMemorySections,
  createSessionStartOutput,
  getUnreflectedL1Content,
  validateSessionStartOutput,
};
