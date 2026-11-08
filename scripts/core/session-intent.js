'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyUserIntent } = require('./turn-intent');
const { isFileWrite, transcriptCall } = require('./tool-shape');

// A file write is known by its shape (core/tool-shape), whatever the tool is named.
// Handing work to an agent has no shape of its own yet, so these names stay.
const DELEGATION_TOOL_NAMES = new Set([
  'Task',
  'TaskCreate',
]);

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => block && block.type === 'text' && block.text).map(block => block.text).join('\n');
}

// Each line of a transcript file, read in chunks so a large transcript is never held
// whole. `visit` returns true to stop early.
function eachTranscriptLine(transcriptPath, visit) {
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let rest = Buffer.alloc(0);
    for (let position = 0; ;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, position);
      const data = read > 0 ? Buffer.concat([rest, buffer.subarray(0, read)]) : rest;
      position += read;
      let start = 0;
      for (let newline = data.indexOf(0x0a); newline !== -1; newline = data.indexOf(0x0a, start)) {
        if (visit(data.subarray(start, newline).toString('utf8'))) return;
        start = newline + 1;
      }
      rest = Buffer.from(data.subarray(start));
      if (read === 0) {
        if (rest.length) visit(rest.toString('utf8'));
        return;
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

// Decides whether a session's end may write memory. The first execution request
// settles it, so reading stops there; the lists then hold the lines read so far.
function inspectSessionTranscript(transcriptPath) {
  if (!transcriptPath) return { persist: false, reason: 'missing-transcript', userPrompts: [], toolNames: [] };

  const userPrompts = [];
  const intents = [];
  const toolNames = [];
  let writesFile = false;
  let validLines = 0;
  let hasExecutionPrompt = false;
  try {
    eachTranscriptLine(transcriptPath, line => {
      if (!line.trim()) return false;
      let entry;
      try {
        entry = JSON.parse(line);
        validLines += 1;
      } catch {
        return false;
      }
      if (entry.type === 'human' || entry.type === 'user') {
        const prompt = contentText(entry.message && entry.message.content || entry.content).trim();
        if (prompt) {
          userPrompts.push(prompt);
          intents.push(classifyUserIntent(prompt));
          if (intents[intents.length - 1] === 'execution') hasExecutionPrompt = true;
        }
      }
      if (entry.type === 'assistant' && Array.isArray(entry.message && entry.message.content)) {
        for (const block of entry.message.content) {
          if (block && block.type === 'tool_use' && typeof block.name === 'string') toolNames.push(block.name);
          if (block && block.type === 'tool_use' && isFileWrite(transcriptCall(block))) writesFile = true;
        }
      }
      return hasExecutionPrompt;
    });
  } catch {
    return { persist: false, reason: 'unreadable-transcript', userPrompts: [], toolNames: [] };
  }

  if (validLines === 0 || userPrompts.length === 0) {
    return { persist: false, reason: 'malformed-transcript', userPrompts, toolNames };
  }

  const latestIntent = intents[intents.length - 1];
  const hasMutatingTool = writesFile || toolNames.some(name => DELEGATION_TOOL_NAMES.has(name));

  if (hasExecutionPrompt) return { persist: true, reason: 'execution-prompt', userPrompts, toolNames, intents };
  if (latestIntent === 'question') return { persist: false, reason: 'question-only', userPrompts, toolNames, intents };
  if (hasMutatingTool) return { persist: true, reason: 'mutating-tool', userPrompts, toolNames, intents };
  return { persist: false, reason: 'no-execution-evidence', userPrompts, toolNames, intents };
}

function resolveClaudeTranscript(hookData = {}, options = {}) {
  const direct = hookData.transcript_path;
  if (typeof direct === 'string' && direct && fs.existsSync(direct)) return direct;
  if (!hookData.session_id) return null;

  const configRoot = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const projectsDir = options.projectsDir || path.join(configRoot, 'projects');
  try {
    if (!fs.existsSync(projectsDir)) return null;
    for (const project of fs.readdirSync(projectsDir)) {
      const candidate = path.join(projectsDir, project, `${hookData.session_id}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {}
  return null;
}

module.exports = {
  DELEGATION_TOOL_NAMES,
  contentText,
  inspectSessionTranscript,
  resolveClaudeTranscript,
};
