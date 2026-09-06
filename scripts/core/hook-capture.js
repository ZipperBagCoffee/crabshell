'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STORAGE_ROOT } = require('../constants');
const { findProjectRoot } = require('../adapters/codex/hook-contract');

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function label(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
}

function captureHookInput(raw, options = {}) {
  const env = options.env || process.env;
  const configured = env.CRABSHELL_HOOK_CAPTURE_DIR;
  if (!configured || !raw) return { captured: false, reason: 'disabled-or-empty' };
  try {
    let payload = {};
    try { payload = JSON.parse(raw); } catch {}
    const host = options.host || 'claude';
    const projectDir = options.projectDir || (host === 'codex'
      ? findProjectRoot(payload.cwd)
      : env.CLAUDE_PROJECT_DIR || payload.cwd);
    if (!projectDir || !path.isAbsolute(projectDir)) return { captured: false, reason: 'missing-project-root' };
    const root = fs.realpathSync(projectDir);
    const storage = path.resolve(projectDir, STORAGE_ROOT);
    const target = path.resolve(projectDir, configured);
    if (!within(storage, target)) return { captured: false, reason: 'outside-project-storage' };
    // Reject directory links before creating anything; open the verified real
    // target below so an existing alias cannot redirect capture into source/home.
    let ancestor = target;
    while (within(path.resolve(projectDir), ancestor)) {
      if (fs.existsSync(ancestor) && fs.lstatSync(ancestor).isSymbolicLink()) {
        return { captured: false, reason: 'linked-capture-directory' };
      }
      if (ancestor === path.resolve(projectDir)) break;
      ancestor = path.dirname(ancestor);
    }
    fs.mkdirSync(target, { recursive: true });
    const directory = fs.realpathSync(target);
    if (!within(root, directory)) return { captured: false, reason: 'outside-real-project' };
    const capturedAt = new Date().toISOString();
    const stem = [label(host), label(payload.hook_event_name), label(payload.tool_name), Date.now(), crypto.randomUUID()].join('-');
    const inputFile = path.join(directory, `${stem}.input.json`);
    fs.writeFileSync(inputFile, raw, { encoding: 'utf8', flag: 'wx' });
    fs.writeFileSync(path.join(directory, `${stem}.meta.json`), JSON.stringify({
      host, capturedAt, transport: options.transport || 'stdin', complete: options.complete !== false,
      hookEvent: payload.hook_event_name || null, tool: payload.tool_name || null,
      nodeVersion: process.version, pid: process.pid,
      inputBytes: Buffer.byteLength(raw), inputSha256: crypto.createHash('sha256').update(raw).digest('hex'),
    }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    return { captured: true, inputFile };
  } catch (error) {
    return { captured: false, reason: 'capture-error', error: error.code || error.message };
  }
}

module.exports = { captureHookInput };
