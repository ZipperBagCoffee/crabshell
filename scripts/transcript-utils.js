'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Normalize a file path: backslash -> forward slash.
 */
function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

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
 * Read hook data from stdin with timeout.
 * Uses HOOK_DATA env var fast path when available (hook-runner.js v2).
 * Returns {} on failure (never null).
 * @param {number} timeoutMs - Timeout in milliseconds (default: 500)
 */
function readStdin(timeoutMs = 500) {
  // hook-runner.js v2 stores parsed stdin in HOOK_DATA env var
  if (process.env.HOOK_DATA) {
    try { return Promise.resolve(JSON.parse(process.env.HOOK_DATA)); }
    catch { return Promise.resolve({}); }
  }

  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (result) => { if (!resolved) { resolved = true; resolve(result); } };
    const timer = setTimeout(() => {
      done(data.trim() ? (() => { try { return JSON.parse(data.trim()); } catch { return {}; } })() : {});
    }, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      if (data.trim()) { try { done(JSON.parse(data.trim())); } catch { done({}); } }
      else { done({}); }
    });
    process.stdin.on('error', () => { clearTimeout(timer); done({}); });
    process.stdin.resume();
  });
}

/**
 * Parse recent Bash tool_use commands and their results from a transcript JSONL file.
 * Reads the last 32KB, returns [{command, result}] pairs.
 * Returns null if transcript is unavailable (fail-open signal).
 * Returns [] if transcript is readable but contains no Bash commands.
 * @param {string} transcriptPath - Path to the JSONL transcript file.
 * @returns {Array<{command: string, result: string}> | null}
 */
function getRecentBashCommands(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const stat = fs.statSync(transcriptPath);
    if (stat.size === 0) return [];
    const readSize = Math.min(32768, stat.size);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    const text = buf.toString('utf8');
    const lines = text.split('\n').filter(l => l.trim());

    const commands = [];
    const pendingCommands = new Map();

    for (const line of lines) {
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }

      if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
        for (const block of obj.message.content) {
          if (block.type === 'tool_use' && block.name === 'Bash' && block.input?.command) {
            pendingCommands.set(block.id, block.input.command);
          }
        }
      }

      if (obj.type === 'tool_result' || obj.type === 'tool-result') {
        const toolUseId = obj.tool_use_id || obj.toolUseId;
        if (toolUseId && pendingCommands.has(toolUseId)) {
          const cmd = pendingCommands.get(toolUseId);
          let result = '';
          if (typeof obj.content === 'string') {
            result = obj.content;
          } else if (Array.isArray(obj.content)) {
            result = obj.content
              .filter(c => c.type === 'text' && c.text)
              .map(c => c.text)
              .join('\n');
          }
          commands.push({ command: cmd, result });
          pendingCommands.delete(toolUseId);
        }
      }
    }

    for (const [, cmd] of pendingCommands) {
      commands.push({ command: cmd, result: '' });
    }

    return commands;
  } catch {
    return null;
  }
}

module.exports = { readStdin, findTranscriptPath, encodeProjectPath, normalizePath, getRecentBashCommands };
