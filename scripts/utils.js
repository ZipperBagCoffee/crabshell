const fs = require('fs');
const path = require('path');
const os = require('os');
const { STORAGE_ROOT, MEMORY_DIR } = require('./constants');

// Subprocess marker — top-level guard for fail-open invariant. D106 IA-10.
function isBackground() { return process.env.CRABSHELL_BACKGROUND === '1'; }

function getProjectName() { return path.basename(getProjectDir()); }

function getProjectDir() {
  // CLAUDE_PROJECT_DIR is set by Claude Code for hooks — always the project root,
  // regardless of Bash cd or session restarts. This is the authoritative source.
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  if (process.env.PROJECT_DIR) return process.env.PROJECT_DIR;
  return process.cwd();
}

function parseProjectDirArg(argv) {
  for (const a of argv) if (a.startsWith('--project-dir=')) return a.slice('--project-dir='.length);
  return getProjectDir();
}

function getStorageRoot(projectDir) { return path.join(projectDir || getProjectDir(), STORAGE_ROOT); }

function getMemoryDir() { return path.join(getStorageRoot(), MEMORY_DIR); }

const MEMORY_ROOT = path.join(os.homedir(), STORAGE_ROOT, 'projects');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readFileOrDefault(filePath, defaultValue) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return defaultValue; }
}

function readJsonOrDefault(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    // Editors on Windows may save JSON with a byte-order mark.
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''));
  } catch { return defaultValue; }
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  const content = JSON.stringify(data, null, 2);
  // Per-process temp name: a shared "<file>.tmp" let concurrent hook instances
  // overwrite each other's half-written temp, so a rename could publish another
  // process's partial JSON (observed as "Unexpected end of JSON input" readers
  // in _test-inject-rules-race). rename stays the only publish operation —
  // readers never see a torn file.
  const tempPath = `${filePath}.${process.pid}.tmp`;
  // Windows: renameSync can fail with EPERM while a concurrent hook instance
  // or antivirus briefly holds the target open. Retry with a short backoff;
  // fall back to a direct (non-atomic) write only as the final attempt.
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      fs.writeFileSync(tempPath, content, 'utf8');
      fs.renameSync(tempPath, filePath);
      return;
    } catch (e) {
      lastError = e;
      try { fs.unlinkSync(tempPath); } catch {}
      // Synchronous backoff (hooks are short-lived sync CLIs): 5/10/15ms.
      try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 * (attempt + 1)); } catch {}
    }
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

module.exports = { MEMORY_ROOT, isBackground, getProjectName, getProjectDir, parseProjectDirArg, getStorageRoot, getMemoryDir, ensureDir, readFileOrDefault, readJsonOrDefault, writeFile, writeJson };
