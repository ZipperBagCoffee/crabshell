'use strict';

const fs = require('fs');
const path = require('path');
const { getStorageRoot, readFileOrDefault, readJsonOrDefault } = require('../utils');
const {
  MEMORY_DIR,
  SESSIONS_DIR,
  INDEX_FILE,
  MEMORY_FILE,
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

function collectMemorySections(projectDir, options = {}) {
  const storageRoot = getStorageRoot(projectDir);
  const memoryDir = path.join(storageRoot, MEMORY_DIR);
  const sections = [];
  const pendingSummaries = [];

  const projectText = readFileOrDefault(getProjectMemoryPath(projectDir), '').trim();
  if (projectText) sections.push(`## Project Overview\n${projectText}`);

  const index = readJsonOrDefault(path.join(memoryDir, INDEX_FILE), null);
  const rotatedFiles = index && Array.isArray(index.rotatedFiles) ? index.rotatedFiles : [];
  for (const entry of rotatedFiles.filter(candidate => !candidate.summaryGenerated)) {
    if (entry && entry.file) pendingSummaries.push(entry.file);
  }
  const generated = rotatedFiles.filter(entry => entry && entry.summaryGenerated && entry.summary);
  if (generated.length > 0) {
    const latest = generated[generated.length - 1];
    const summary = readJsonOrDefault(path.join(memoryDir, latest.summary), null);
    if (summary && summary.overallSummary) {
      sections.push(`## Previous Memory Summary\n${summary.overallSummary}`);
    }
  }

  const memoryPath = path.join(memoryDir, MEMORY_FILE);
  const memoryContent = readFileOrDefault(memoryPath, '');
  const sessionsDir = path.join(storageRoot, SESSIONS_DIR);
  if (fs.existsSync(sessionsDir)) {
    const l1Files = fs.readdirSync(sessionsDir).filter(file => file.endsWith('.l1.jsonl')).sort().reverse();
    if (l1Files.length > 0) {
      const unreflected = getUnreflectedL1Content(path.join(sessionsDir, l1Files[0]), memoryContent);
      if (unreflected) sections.push(`## Unreflected from Last Session\n${unreflected.join('\n')}`);
    }
  }

  if (memoryContent.trim()) {
    const tailLines = Number(options.tailLines || DEFAULT_TAIL_LINES);
    const lines = memoryContent.split(/\r?\n/);
    if (lines.length > tailLines) {
      sections.push(`## Recent Sessions (last ${tailLines} lines)\n${lines.slice(-tailLines).join('\n')}`);
    } else {
      sections.push(`## Recent Sessions\n${memoryContent}`);
    }
  }

  const mocDigest = readFileOrDefault(path.join(storageRoot, 'moc-digest.md'), '').trim();
  if (mocDigest) sections.push(mocDigest);

  return { sections, pendingSummaries };
}

function buildMemoryContext(projectDir, options = {}) {
  const source = options.source || 'unknown';
  const projectName = path.basename(projectDir);
  const { sections, pendingSummaries } = collectMemorySections(projectDir, options);
  const workflowContext = buildWorkflowContext(projectDir, { purpose: 'session', now: options.now });
  const output = [];

  if (sections.length > 0) {
    output.push(`=== Crabshell: ${projectName} ===`);
    if (source === 'compact') output.push(getPostCompactWarning(projectDir).trim());
    if (pendingSummaries.length > 0) {
      output.push(`## Pending Memory Summaries\n${pendingSummaries.map(file => `- ${file}`).join('\n')}`);
    }
    output.push(sections.join('\n\n---\n\n'));
    if (workflowContext) output.push(workflowContext);
    output.push(MEMORY_NOTES.trim());
    output.push('=== End of Memory ===');
  } else {
    output.push(`--- Crabshell: No memory for ${projectName} ---`);
    if (source === 'compact') output.push(getPostCompactWarning(projectDir).trim());
    if (workflowContext) output.push(workflowContext);
    output.push(MEMORY_NOTES.trim());
  }

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
