'use strict';

// D177: after every main-agent answer, ask once whether it is the best answer — the
// question the user kept typing by hand — yes/no checks (D184: ad hoc added), then (D181) a concise summary of the answer. The per-turn checklist (shared-context.js)
// defines both words. A rule read before the answer is written has no draft to aim
// at; this asks after the answer exists. Once per user prompt
// (prompt_id); deferred while another Stop check blocks; Claude only.

const os = require('os');
const path = require('path');
const { getStorageRoot, readJsonOrDefault, writeJson } = require('./utils');
const { SESSION_STATE_MAX_AGE_MS, STORAGE_ROOT } = require('./constants');
const { withStateLock } = require('./core/state-lock');

const QUESTION = 'Is your answer 1) not your best? 2) agree without checking? 3) cutting corners? 4) ad hoc? If all are no, summarize the answer concisely; otherwise fix it, then summarize.';

const STATE_FILE = 'best-answer.json';
const LEGACY_SESSION = '_';

function memoryDir(projectDir) {
  return path.join(getStorageRoot(projectDir), 'memory');
}

// Runs whose final message is read by a program, not a person: `claude -p` and the Agent
// SDK report CLAUDE_CODE_ENTRYPOINT "sdk-cli", "sdk-ts", ... (interactive: "cli", measured
// D177). There a second message would replace the answer the caller reads.
const DEFAULT_SKIP_ENTRYPOINTS = ['sdk'];

function bestAnswerIn(file) {
  const config = readJsonOrDefault(file, {}) || {};
  return config && typeof config.bestAnswer === 'object' && config.bestAnswer ? config.bestAnswer : {};
}

// The user-wide ~/.crabshell/config.json first, the project's .crabshell/memory/config.json
// over it key by key, so one line turns it off in every project and a project can differ.
function settingsOf(projectDir) {
  return { ...bestAnswerIn(path.join(os.homedir(), STORAGE_ROOT, 'config.json')),
    ...bestAnswerIn(path.join(memoryDir(projectDir), 'config.json')) };
}

// On unless bestAnswer.ask is false (user-wide or project config), or the run's entrypoint
// starts with one of bestAnswer.skipEntrypoints (default ["sdk"]); an unreadable file keeps
// the defaults.
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
