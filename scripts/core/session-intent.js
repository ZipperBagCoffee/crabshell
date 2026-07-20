'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyUserIntent } = require('./turn-intent');

const MUTATING_TOOL_NAMES = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Task',
  'TaskCreate',
]);

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => block && block.type === 'text' && block.text).map(block => block.text).join('\n');
}

function inspectSessionTranscript(transcriptPath) {
  if (!transcriptPath) return { persist: false, reason: 'missing-transcript', userPrompts: [], toolNames: [] };
  let text;
  try {
    text = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return { persist: false, reason: 'unreadable-transcript', userPrompts: [], toolNames: [] };
  }

  const userPrompts = [];
  const toolNames = [];
  let validLines = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
      validLines += 1;
    } catch {
      continue;
    }
    if (entry.type === 'human' || entry.type === 'user') {
      const prompt = contentText(entry.message && entry.message.content || entry.content).trim();
      if (prompt) userPrompts.push(prompt);
    }
    if (entry.type === 'assistant' && Array.isArray(entry.message && entry.message.content)) {
      for (const block of entry.message.content) {
        if (block && block.type === 'tool_use' && typeof block.name === 'string') toolNames.push(block.name);
      }
    }
  }

  if (validLines === 0 || userPrompts.length === 0) {
    return { persist: false, reason: 'malformed-transcript', userPrompts, toolNames };
  }

  const intents = userPrompts.map(classifyUserIntent);
  const hasExecutionPrompt = intents.includes('execution');
  const latestIntent = intents[intents.length - 1];
  const hasMutatingTool = toolNames.some(name => MUTATING_TOOL_NAMES.has(name));

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
  MUTATING_TOOL_NAMES,
  contentText,
  inspectSessionTranscript,
  resolveClaudeTranscript,
};
