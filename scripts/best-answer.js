'use strict';

// D177: after every main-agent answer, ask once "Is that your best?" — the question the
// user kept typing by hand. A rule read before the answer is written has no draft to aim
// at; this asks after the answer exists and presumes a defect. Once per user prompt
// (prompt_id); deferred while another Stop check blocks; Claude only.

const path = require('path');
const { getStorageRoot, readJsonOrDefault, writeJson } = require('./utils');
const { SESSION_STATE_MAX_AGE_MS } = require('./constants');
const { withStateLock } = require('./core/state-lock');

const QUESTION = 'Is that your best? Find what the user would point at if they asked that: '
  + 'a source you did not open, a guess stated as fact, a shortcut, a hardcoded value, a requested item left out, '
  + 'wording longer or harder than the reader needs. '
  + 'A change needs evidence from this turn — a tool result, a file line, or a requirement the first answer missed; '
  + 'never reverse or soften a claim without it. '
  + 'Fix the answer, not the work: start no edit or command the user has not authorized, and keep any question you asked the user. '
  + 'If you change it, give the corrected answer; if nothing changes, say in one line that it stands and what you checked.';

const STATE_FILE = 'best-answer.json';
const LEGACY_SESSION = '_';

function memoryDir(projectDir) {
  return path.join(getStorageRoot(projectDir), 'memory');
}

// Runs whose final message is read by a program, not a person: `claude -p` and the Agent
// SDK report CLAUDE_CODE_ENTRYPOINT "sdk-cli", "sdk-ts", ... (interactive: "cli", measured
// D177). There a second message would replace the answer the caller reads.
const DEFAULT_SKIP_ENTRYPOINTS = ['sdk'];

function settingsOf(projectDir) {
  const config = readJsonOrDefault(path.join(memoryDir(projectDir), 'config.json'), {}) || {};
  return config && typeof config.bestAnswer === 'object' && config.bestAnswer ? config.bestAnswer : {};
}

// On unless the project sets bestAnswer.ask to false in .crabshell/memory/config.json
// (the file web-guard reads), or the run's entrypoint starts with one of
// bestAnswer.skipEntrypoints (default ["sdk"]); an unreadable file keeps the defaults.
function enabled(projectDir, env = process.env) {
  const settings = settingsOf(projectDir);
  if (settings.ask === false) return false;
  const skip = Array.isArray(settings.skipEntrypoints)
    ? settings.skipEntrypoints.filter(item => typeof item === 'string' && item) : DEFAULT_SKIP_ENTRYPOINTS;
  const entry = String(env.CLAUDE_CODE_ENTRYPOINT || '');
  return !skip.some(prefix => entry.startsWith(prefix));
}

function statePath(projectDir) {
  return path.join(memoryDir(projectDir), STATE_FILE);
}

function readState(projectDir) {
  const raw = readJsonOrDefault(statePath(projectDir), null);
  return raw && typeof raw === 'object' && raw.sessions && typeof raw.sessions === 'object'
    ? raw : { schemaVersion: 1, sessions: {} };
}

const sessionOf = payload => (payload && payload.session_id) || LEGACY_SESSION;

// This prompt's entry; another prompt's entry counts as a fresh one.
function entryFor(state, payload) {
  const entry = state.sessions[sessionOf(payload)];
  if (entry && entry.promptId === payload.prompt_id) return entry;
  return { promptId: payload.prompt_id, asked: false, othersBlocked: false };
}

function saveEntry(projectDir, payload, change) {
  const file = statePath(projectDir);
  return withStateLock(file, () => {
    const state = readState(projectDir);
    const id = sessionOf(payload);
    state.sessions[id] = { ...entryFor(state, payload), ...change, updatedAt: new Date().toISOString() };
    const now = Date.now();
    state.sessions = Object.fromEntries(Object.entries(state.sessions)
      .filter(([key, entry]) => key === id || now - (Date.parse(entry && entry.updatedAt || '') || 0) <= SESSION_STATE_MAX_AGE_MS));
    writeJson(file, state);
    return state.sessions[id];
  });
}

const isMainStop = payload => Boolean(payload) && payload.hook_event_name === 'Stop';

// After the question continued the turn, stop_hook_active stays true even past tool calls
// (measured, D177), which would switch every other Stop check off for the revised answer.
// They run once more when the question was this prompt's only continuation so far.
function othersMayRun(payload, projectDir) {
  if (!isMainStop(payload) || payload.stop_hook_active !== true || !payload.prompt_id) return false;
  const entry = entryFor(readState(projectDir), payload);
  return entry.asked === true && entry.othersBlocked !== true;
}

// The question to send at this Stop, or null. othersBlocked: another check blocks this Stop,
// so the question waits for the next one instead of joining a different instruction.
function stopStep(payload, projectDir, othersBlocked) {
  if (!isMainStop(payload) || !enabled(projectDir)) return null;
  if (!payload.prompt_id) {
    // No prompt id (older host): the continuation flag alone keeps it to one question.
    return othersBlocked || payload.stop_hook_active === true ? null : QUESTION;
  }
  const entry = entryFor(readState(projectDir), payload);
  if (othersBlocked) {
    // Recorded asked or not: after the question, the other checks get one more run only.
    saveEntry(projectDir, payload, { othersBlocked: true });
    return null;
  }
  if (entry.asked) return null;
  try {
    saveEntry(projectDir, payload, { asked: true });
  } catch (error) {
    // Unsaved: ask only where the continuation flag still guards against a second time.
    if (payload.stop_hook_active === true) return null;
  }
  return QUESTION;
}

module.exports = { QUESTION, STATE_FILE, enabled, statePath, othersMayRun, stopStep };
