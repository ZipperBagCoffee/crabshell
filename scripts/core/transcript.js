'use strict';

// Claude Code session transcripts: where the current one is and what the user last said.

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Encode project path to Claude Code's ~/.claude/projects/ directory name format.
 * C:\Users\chulg\Documents\Project -> C--Users-chulg-Documents-Project
 */
function encodeProjectPath(projectDir) {
  return projectDir.replace(/\\/g, '/').replace(/\//g, '-').replace(':', '-');
}

/**
 * Find current session transcript by exact project path match.
 * Returns the most recently modified .jsonl file path, or null.
 */
function findTranscriptPath() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
  const encoded = encodeProjectPath(projectDir);
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    if (!fs.existsSync(claudeProjectsDir)) return null;
    const projects = fs.readdirSync(claudeProjectsDir);
    // Exact match first (case-insensitive for Windows)
    const match = projects.find(p => p.toLowerCase() === encoded.toLowerCase());
    if (match) {
      const projPath = path.join(claudeProjectsDir, match);
      const files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
      if (files.length > 0) {
        const sorted = files.map(f => ({
          path: path.join(projPath, f),
          mtime: fs.statSync(path.join(projPath, f)).mtime
        })).sort((a, b) => b.mtime - a.mtime);
        return sorted[0].path;
      }
    }
  } catch (e) { return null; }
  return null;
}

/**
 * Extract the last user (human) message text from a transcript JSONL file.
 * Reads the last 16KB, finds the last "human" type entry.
 * Returns the text content or null (fail-open).
 * @param {string} transcriptPath
 * @returns {string|null}
 */
function getLastUserMessage(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size === 0) return null;
    const readSize = Math.min(16384, stat.size);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/).filter(l => l.trim());

    // Search backward for the last human message
    for (let i = lines.length - 1; i >= 0; i--) {
      let obj;
      try { obj = JSON.parse(lines[i]); } catch { continue; }
      if (obj.type === 'human' || obj.type === 'user') {
        // A background task's completion notice is recorded as a user line but is
        // host output, not the user's request (origin.kind "task-notification").
        if (obj.origin?.kind === 'task-notification') continue;
        if (typeof obj.message?.content === 'string' && /^\s*<task-notification>/.test(obj.message.content)) continue;
        // Extract text from content array or string
        if (typeof obj.message?.content === 'string') return obj.message.content;
        if (Array.isArray(obj.message?.content)) {
          return obj.message.content
            .filter(c => c.type === 'text' && c.text)
            .map(c => c.text)
            .join('\n');
        }
        // Direct content field
        if (typeof obj.content === 'string') return obj.content;
        if (Array.isArray(obj.content)) {
          return obj.content
            .filter(c => c.type === 'text' && c.text)
            .map(c => c.text)
            .join('\n');
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// A person's prompt, as opposed to a tool result or a background task's notice that the
// host also records as a user line.
function isHumanPrompt(entry) {
  if (!entry || entry.type !== 'user') return false;
  if (entry.origin && entry.origin.kind) return entry.origin.kind === 'human';
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return !/^\s*<task-notification>/.test(content);
  return Array.isArray(content) && content.some(part => part && part.type === 'text')
    && !content.some(part => part && part.type === 'tool_result');
}

/**
 * What the assistant did since the person's last prompt (D161, D162): its text and tool
 * calls in order, as { kind: 'text', text } and { kind: 'tool', name }. Reads only the
 * transcript's last `maxBytes`; when the prompt lies before that, the whole read part
 * counts. Returns null when the transcript cannot be read.
 */
function currentTurn(transcriptPath, { maxBytes = 1048576 } = {}) {
  if (!transcriptPath) return null;
  try {
    const stat = fs.statSync(transcriptPath);
    const readSize = Math.min(maxBytes, stat.size);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(transcriptPath, 'r');
    try { fs.readSync(fd, buf, 0, readSize, stat.size - readSize); } finally { fs.closeSync(fd); }
    const lines = buf.toString('utf8').split(/\r?\n/);
    if (readSize < stat.size) lines.shift(); // the first line was cut by the read
    const entries = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch (_) { /* a line still being written */ }
    }
    let start = 0;
    for (let i = entries.length - 1; i >= 0; i--) if (isHumanPrompt(entries[i])) { start = i + 1; break; }
    const turn = [];
    for (const entry of entries.slice(start)) {
      const content = entry.type === 'assistant' && entry.message && entry.message.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && part.type === 'text' && part.text) turn.push({ kind: 'text', text: part.text });
        else if (part && part.type === 'tool_use' && part.name) turn.push({ kind: 'tool', name: part.name });
      }
    }
    return turn;
  } catch (_) {
    return null;
  }
}

module.exports = { findTranscriptPath, encodeProjectPath, getLastUserMessage, currentTurn, isHumanPrompt };
