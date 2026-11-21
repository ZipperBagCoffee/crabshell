'use strict';

const fs = require('fs');

/**
 * Normalize a file path: backslash -> forward slash.
 */
function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Read hook data from stdin with timeout.
 * Uses HOOK_DATA env var fast path when available (hook-runner.js v2).
 * Returns {} on failure (never null).
 * @param {number} timeoutMs - Timeout in milliseconds (default: 500)
 */
function readStdin(timeoutMs = 500, options = {}) {
  const capture = (raw, transport, complete) => {
    if (!process.env.CRABSHELL_HOOK_CAPTURE_DIR) return;
    try {
      require('./core/hook-capture').captureHookInput(raw, { host: options.host || 'claude', transport, complete });
    } catch {} // Debug capture cannot change hook behavior.
  };
  // hook-runner.js v2 stores parsed stdin in HOOK_DATA env var
  if (process.env.HOOK_DATA) {
    capture(process.env.HOOK_DATA, 'HOOK_DATA', true);
    try { return Promise.resolve(JSON.parse(process.env.HOOK_DATA)); }
    catch { return Promise.resolve({}); }
  }

  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (result, complete = true) => {
      if (!resolved) {
        resolved = true;
        capture(data, 'stdin', complete);
        resolve(result);
      }
    };
    const timer = setTimeout(() => {
      done(data.trim() ? (() => { try { return JSON.parse(data.trim()); } catch { return {}; } })() : {}, false);
    }, timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      if (data.trim()) { try { done(JSON.parse(data.trim())); } catch { done({}); } }
      else { done({}); }
    });
    process.stdin.on('error', () => { clearTimeout(timer); done({}, false); });
    process.stdin.resume();
  });
}

/**
 * The model of the last assistant message in a Claude transcript (JSONL), reading only the
 * last maxBytes of the file. Returns null when the file or a model is missing (D178).
 */
function lastAssistantModel(file, maxBytes = 65536) {
  if (!file || typeof file !== 'string') return null;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, Math.max(0, maxBytes));
    if (length === 0) return null;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"assistant"')) continue;
      let entry;
      try { entry = JSON.parse(lines[i]); } catch { continue; } // the first line may be cut
      const model = entry && entry.type === 'assistant' && entry.message && entry.message.model;
      if (typeof model === 'string' && model && model !== '<synthetic>') return model;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

module.exports = { readStdin, normalizePath, lastAssistantModel };
