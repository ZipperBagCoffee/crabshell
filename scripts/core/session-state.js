'use strict';
// Per-session state under .crabshell/memory/session-state/<sid8>/, where sid8 is the
// first 8 characters of the host session_id (the same key the L1 file names use).
// Only the owning session writes its directory, so these files need no shared lock.
const fs = require('fs');
const path = require('path');
const { getStorageRoot, readJsonOrDefault, writeJson } = require('../utils');
const { MEMORY_DIR, SESSION_STATE_DIR, SESSION_STATE_MAX_AGE_MS } = require('../constants');

function sessionKey(sessionId) {
  if (typeof sessionId !== 'string') return null;
  const key = sessionId.slice(0, 8).replace(/[^A-Za-z0-9_-]/g, '');
  return key.length === 8 ? key : null;
}

function statesRoot(projectDir) {
  return path.join(getStorageRoot(projectDir), MEMORY_DIR, SESSION_STATE_DIR);
}

function stateFile(projectDir, sessionId, name) {
  const key = sessionKey(sessionId);
  return key ? path.join(statesRoot(projectDir), key, `${name}.json`) : null;
}

function readSessionState(projectDir, sessionId, name, fallback = null) {
  const file = stateFile(projectDir, sessionId, name);
  return file ? readJsonOrDefault(file, fallback) : fallback;
}

function writeSessionState(projectDir, sessionId, name, value) {
  const file = stateFile(projectDir, sessionId, name);
  if (!file) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJson(file, value);
  return true;
}

function removeSessionState(projectDir, sessionId, name) {
  const file = stateFile(projectDir, sessionId, name);
  if (!file) return false;
  try { fs.unlinkSync(file); return true; } catch { return false; }
}

// Returns [{ key, name, file, value }] for every session that has the named state.
function listSessionStates(projectDir, name) {
  const root = statesRoot(projectDir);
  let keys = [];
  try { keys = fs.readdirSync(root); } catch { return []; }
  const found = [];
  for (const key of keys) {
    const file = path.join(root, key, `${name}.json`);
    const value = readJsonOrDefault(file, null);
    if (value !== null) found.push({ key, name, file, value });
  }
  return found;
}

// Remove session directories untouched for longer than the retention window.
function pruneSessionStates(projectDir, now = Date.now()) {
  const root = statesRoot(projectDir);
  let keys = [];
  try { keys = fs.readdirSync(root); } catch { return 0; }
  let removed = 0;
  for (const key of keys) {
    const dir = path.join(root, key);
    try {
      const newest = fs.readdirSync(dir).reduce((latest, file) => Math.max(latest, fs.statSync(path.join(dir, file)).mtimeMs), fs.statSync(dir).mtimeMs);
      if (now - newest > SESSION_STATE_MAX_AGE_MS) { fs.rmSync(dir, { recursive: true, force: true }); removed++; }
    } catch {}
  }
  return removed;
}

module.exports = {
  listSessionStates,
  pruneSessionStates,
  readSessionState,
  removeSessionState,
  sessionKey,
  stateFile,
  writeSessionState,
};
