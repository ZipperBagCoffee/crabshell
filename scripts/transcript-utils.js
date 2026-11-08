'use strict';

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

module.exports = { readStdin, normalizePath };
