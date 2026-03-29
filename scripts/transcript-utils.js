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

module.exports = { readStdin, findTranscriptPath, encodeProjectPath, normalizePath };
