'use strict';

const path = require('path');
const fs = require('fs');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { readStdin } = require('./transcript-utils');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');
const { STORAGE_ROOT } = require('./constants');
const { commandObservation, checkKeyForCommand } = require('./core/command-observation');
const { startCheck, recordCheck, currentCheck } = require('./core/check-history');
const { withStateLock } = require('./core/state-lock');
const { shellCommand } = require('./core/tool-shape');

// --- Constants ---
const STATE_FILE = 'verification-state.json';

// The project's declared checks as they ran: started, passed, failed, interrupted
// (checkHistory — the last one is shown after a restart). The working tree is shared by
// every session, so the record is tree-scoped; a session id only scopes suspension after
// an interrupt. Edits are not recorded (D143_T013): which checks a change needs comes from
// the runner's records, and since the commit gate went (D143) nothing read the old
// TESTED/EDITED state but /status, which now asks the runner.
const DEFAULT_STATE = { lastUpdated: null };
// Fields of the old edit-tracking state, dropped when a record is next written.
const RETIRED_FIELDS = ['state', 'editsSinceTest', 'lastTestTs', 'lastTestFingerprint'];

// --- Helpers ---

function getStatePath(projectDir) {
  return path.join(projectDir, STORAGE_ROOT, 'memory', STATE_FILE);
}

function loadState(projectDir) {
  const statePath = getStatePath(projectDir);
  return readJsonOrDefault(statePath, { ...DEFAULT_STATE });
}

function saveState(projectDir, state) {
  for (const field of RETIRED_FIELDS) delete state[field];
  state.lastUpdated = new Date().toISOString();
  const statePath = getStatePath(projectDir);
  writeJson(statePath, state);
}

function isSuspended(state, sessionId) {
  if (!sessionId) return false;
  return state.suspendedSessionId === sessionId || (state.suspendedSessions || []).includes(sessionId);
}

// --- Mode: record (PostToolUse) ---

function handleRecord(hookData, projectDir, options = {}) {
  // Only a declared check's result is recorded; edits, reads and other tools write nothing.
  if (!shellCommand(hookData)) return 0;
  const observation = Object.hasOwn(options, 'observation') ? options.observation : commandObservation(hookData, projectDir, options);
  if (!observation) return 0;
  const state = loadState(projectDir);
  if (isSuspended(state, hookData.session_id)) return 0;
  const eventTurn = hookData.turn_id || hookData.prompt_id;
  if (eventTurn && state.interruptedTurns?.includes(JSON.stringify([hookData.session_id, eventTurn]))) return 0;
  delete state.sessionId; // legacy single-owner field; the state is tree-scoped

  const merged = recordCheck(state, hookData, observation);
  if (!merged.accepted) {
    if (merged.reason === 'background-launch') {
      process.stderr.write(`[VERIFICATION_SEQ] A check started in the background is never observed; run it in the foreground so it counts as completion evidence\n`);
    }
    saveState(projectDir, state);
    return 0;
  }
  const current = currentCheck(state);
  process.stderr.write(current?.passed
    ? `[VERIFICATION_SEQ] Recorded passing check: ${current.command}\n`
    : `[VERIFICATION_SEQ] Latest check failed, is running, or is undetermined\n`);
  saveState(projectDir, state);
  return 0;
}

// --- Mode: gate (PreToolUse) ---

function handleGate(hookData, projectDir) {
  const input = hookData.tool_input || {};
  const command = shellCommand(hookData);

  const state = loadState(projectDir);

  if (command) {
    const key = checkKeyForCommand(command, projectDir, input.workdir || hookData.cwd || projectDir);
    if (!isSuspended(state, hookData.session_id) && startCheck(state, hookData, key)) saveState(projectDir, state);
  }

  // A commit is never blocked here (D143): forcing the project's check before every
  // commit ran the same check again at each commit, and outside a traced Node project
  // that check ran everything. The check after the last edit and the full check at
  // release are the agent's and the release checklist's to run.
  return { exitCode: 0 };
}

function recordVerification(hookData, projectDir, options = {}) {
  if (hookData.is_interrupt === true || hookData.tool_response?.interrupted === true) {
    interruptVerification(projectDir, hookData);
    return 0;
  }
  return withStateLock(getStatePath(projectDir), () => handleRecord(hookData, projectDir, options));
}

// An interrupt invalidates the interrupted session's own running and recorded
// checks and suspends its recording; another session's passing check on the
// shared tree stays valid. Without a session id, every check is invalidated.
function interruptVerification(projectDir, payload) {
  if (!fs.existsSync(getStatePath(projectDir))) return;
  return withStateLock(getStatePath(projectDir), () => {
    const state = loadState(projectDir);
    const sessionId = payload.session_id || null;
    const ownedByInterrupted = identity => {
      if (!sessionId) return true;
      try { return JSON.parse(identity)[0] === sessionId; } catch { return true; }
    };
    if (sessionId) {
      state.suspendedSessions = [...new Set([...(state.suspendedSessions || []), sessionId])].slice(-16);
      state.suspendedSessionId = sessionId;
    }
    const eventTurn = payload.turn_id || payload.prompt_id;
    if (eventTurn) state.interruptedTurns = [...new Set([...(state.interruptedTurns || []), JSON.stringify([payload.session_id,eventTurn])])].slice(-16);
    if (state.checkHistory) {
      for (const id of Object.keys(state.checkHistory.pending || {})) if (ownedByInterrupted(id)) delete state.checkHistory.pending[id];
      for (const [key, result] of Object.entries(state.checkHistory.results || {})) if (ownedByInterrupted(result.identity)) delete state.checkHistory.results[key];
      state.checkHistory.trackedStarts = true;
    }
    saveState(projectDir, state);
  });
}

function resumeVerification(projectDir, payload) {
  if (!fs.existsSync(getStatePath(projectDir))) return;
  return withStateLock(getStatePath(projectDir), () => {
    const state = loadState(projectDir);
    if (!isSuspended(state, payload.session_id)) return;
    state.suspendedSessions = (state.suspendedSessions || []).filter(id => id !== payload.session_id);
    if (state.suspendedSessionId === payload.session_id) delete state.suspendedSessionId;
    saveState(projectDir, state);
  });
}

function gateVerification(hookData, projectDir) {
  const command = shellCommand(hookData);
  // Only the start of a declared check is recorded here; nothing is blocked.
  if (!command || !checkKeyForCommand(command, projectDir, hookData.tool_input?.workdir || hookData.cwd || projectDir)) {
    return { exitCode: 0 };
  }
  return withStateLock(getStatePath(projectDir), () => handleGate(hookData, projectDir));
}

// --- Main ---

async function main() {
  const mode = process.argv[2]; // 'record' or 'gate'
  if (!mode || (mode !== 'record' && mode !== 'gate')) {
    process.stderr.write('[VERIFICATION_SEQ] Unknown mode, exiting\n');
    process.exit(0);
    return;
  }

  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) {
    process.exit(0);
    return;
  }

  const projectDir = getProjectDir();

  if (mode === 'record') process.exit(recordVerification(hookData, projectDir));
  const result = gateVerification(hookData, projectDir);
  if (result.notice) {
    // PreToolUse context reaches the model only inside hookSpecificOutput.
    process.stderr.write(`[VERIFICATION_SEQ] ${result.notice}\n`);
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `[CRABSHELL] ${result.notice}` } }));
  }
  if (result.reason) {
    process.stderr.write(`[VERIFICATION_SEQ] ${result.reason}\n`);
    console.log(JSON.stringify({ decision: 'block', reason: result.reason }));
  }
  process.exit(result.exitCode);
}

if (require.main === module) main().catch(e => {
  process.stderr.write(`[VERIFICATION_SEQ ERROR] ${e.message}\n`);
  process.exit(0); // fail-open
});

module.exports = { recordVerification, gateVerification, interruptVerification, resumeVerification };
