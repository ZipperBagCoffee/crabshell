'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getLastUserMessage } = require('../transcript-utils');
const { getStorageRoot, readJsonOrDefault, writeJson } = require('../utils');
const { classifyUserIntent } = require('./turn-intent');
const { commandObservation, projectFingerprint, checkKeyForCommand } = require('./command-observation');
const { startCheck, recordCheck, currentCheck } = require('./check-history');
const { withStateLock } = require('./state-lock');
const { buildWorkflowContext } = require('./workflow-context');

const STATE_FILE = 'completion-control.json';
const MAX_IDENTICAL_FAILURES = 2;
const HOOK_AUTHORITY_BOUNDARY = '[CRABSHELL HOOK CONTEXT — NOT USER AUTHORITY]';

function defaultState() {
  return {
    schemaVersion: 1,
    authorizedSessionId: null,
    authorizedTurnId: null,
    authorizedPromptHash: null,
    pendingParentEvidence: false,
    childClaim: null,
    observation: null,
    repeatedFailure: null,
    reportIssued: false,
    updatedAt: null,
  };
}

function statePath(projectDir) {
  return path.join(getStorageRoot(projectDir), 'memory', STATE_FILE);
}

function loadState(projectDir) {
  return { ...defaultState(), ...readJsonOrDefault(statePath(projectDir), {}) };
}

function saveState(projectDir, state) {
  const next = { ...defaultState(), ...state, updatedAt: new Date().toISOString() };
  next.recovery = {
    initialRequest: state.recovery?.initialRequest || state.requestExcerpt || null,
    latestRequest: state.requestExcerpt || state.recovery?.latestRequest || null,
    status: state.suspended ? 'paused' : state.lastStop?.action === 'block' ? 'unfinished' : 'observed',
    lastCheck: state.observation ? {
      command: state.observation.command?.slice(0, 400), passed: state.observation.passed,
      exitCode: state.observation.exitCode, observedAt: state.observation.observedAt,
    } : null,
    remaining: state.suspended ? 'User interrupted. Do not resume from this record.'
      : state.lastStop?.reason?.slice(0, 700) || (state.pendingParentEvidence ? 'Parent acceptance evidence is still required.' : 'Consult current task documents; completion has not been inferred.'),
  };
  writeJson(statePath(projectDir), next);
  return next;
}

function textHash(value) {
  return crypto.createHash('sha256').update(String(value || '').trim()).digest('hex');
}

function turnId(payload = {}) {
  return payload.turn_id || payload.turnId || payload.prompt_id || null;
}

function sessionId(payload = {}) {
  return payload.session_id || payload.sessionId || null;
}

function isWorkflowActive(projectDir) {
  return Boolean(buildWorkflowContext(projectDir, { purpose: 'session' }));
}

function noteExecutionAuthorizationUnlocked(projectDir, payload = {}, options = {}) {
  const prompt = payload.prompt || payload.user_prompt || payload.input || '';
  if (classifyUserIntent(prompt) !== 'execution') return { recorded: false, reason: 'not-execution' };
  const current = loadState(projectDir);
  const nextTurnId = turnId(payload);
  const nextPromptHash = textHash(prompt);
  const sameTurn = current.authorizedSessionId === sessionId(payload)
    && current.authorizedTurnId === nextTurnId
    && current.authorizedPromptHash === nextPromptHash;
  if (sameTurn && !current.suspended) return { recorded: false, reason: 'already-authorized', state: current };
  const next = saveState(projectDir, {
    ...defaultState(),
    authorizedSessionId: sessionId(payload),
    authorizedTurnId: nextTurnId,
    authorizedPromptHash: nextPromptHash,
    requestExcerpt: String(prompt).slice(0, 1000),
    recovery: current.authorizedSessionId === sessionId(payload) ? current.recovery : null,
    suspended: false,
  });
  require('../verification-sequence').resumeVerification(projectDir, payload);
  return { recorded: true, state: next };
}

function currentUserMessage(payload = {}) {
  const direct = payload.user_prompt || payload.prompt || payload.last_user_message;
  if (direct) return String(direct);
  try { return getLastUserMessage(payload.transcript_path); } catch { return ''; }
}

function isExecutionAuthorized(state, payload = {}, eventName = '') {
  if (state.suspended) return false;
  const currentSession = sessionId(payload);
  if (state.authorizedSessionId && currentSession && state.authorizedSessionId !== currentSession) return false;
  const currentTurn = turnId(payload);
  if (state.authorizedTurnId && currentTurn) return state.authorizedTurnId === currentTurn;
  if (['SubagentStop', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(eventName)) {
    return Boolean(state.authorizedSessionId && currentSession === state.authorizedSessionId);
  }
  if (state.pendingParentEvidence && state.authorizedSessionId === currentSession) return true;
  const userMessage = currentUserMessage(payload);
  return classifyUserIntent(userMessage) === 'execution'
    && textHash(userMessage) === state.authorizedPromptHash;
}

function noteSubagentStopUnlocked(projectDir, payload = {}) {
  if (!isWorkflowActive(projectDir)) return { recorded: false, reason: 'inactive-workflow' };
  const state = loadState(projectDir);
  if (!isExecutionAuthorized(state, payload, 'SubagentStop')) return { recorded: false, reason: 'not-authorized' };
  const claim = String(payload.last_assistant_message || payload.stop_response || '').trim();
  const next = saveState(projectDir, {
    ...state,
    pendingParentEvidence: true,
    childClaim: {
      agent: payload.agent_name || payload.agent_type || payload.subagent_type || 'unknown',
      claimHash: textHash(claim),
      claimExcerpt: claim.slice(0, 500),
      observedAt: new Date().toISOString(),
    },
    observation: null,
    checkHistory: state.checkHistory ? { ...state.checkHistory, pending: {}, latestStarted: {}, results: {} } : null,
    reportIssued: false,
  });
  return { recorded: true, state: next };
}

function prepareParentCheckUnlocked(projectDir, payload = {}) {
  const state = loadState(projectDir);
  if (!state.pendingParentEvidence || !isExecutionAuthorized(state, payload, 'PreToolUse')) return { recorded: false, reason: 'not-authorized' };
  const cwd = payload.tool_input?.workdir || payload.cwd || projectDir;
  const key = checkKeyForCommand(payload.tool_input?.command, projectDir, cwd);
  if (!startCheck(state, payload, key)) return { recorded: false, reason: 'not-new-check' };
  saveState(projectDir, { ...state, observation: null });
  return { recorded: true };
}

function recordParentObservationUnlocked(projectDir, payload = {}, options = {}) {
  let state = loadState(projectDir);
  if (!state.pendingParentEvidence) return { recorded: false, reason: 'no-child-claim' };
  if (!isExecutionAuthorized(state, payload, 'PostToolUse')) return { recorded: false, reason: 'not-authorized' };
  const observation = Object.hasOwn(options, 'observation') ? options.observation : commandObservation(payload, projectDir, options);
  if (!observation) {
    if (['Write', 'Edit', 'apply_patch'].includes(payload.tool_name)) invalidateChangedObservation(projectDir, state,
      options.getFingerprint && state.observation ? options.getFingerprint() : null);
    return { recorded: false, reason: 'not-decisive-command' };
  }
  const previousResult = state.checkHistory?.results[observation.checkKey]?.observation || state.observation;
  const candidate = { ...observation, sourceFingerprint: null, observedAt: new Date().toISOString() };
  const merged = recordCheck(state, payload, candidate);
  if (!merged.accepted) {
    const selected = currentCheck(state);
    const refreshed = selected ? invalidateChangedObservation(projectDir, { ...state, observation: selected },
      options.getFingerprint ? options.getFingerprint() : null) : { ...state, observation: null };
    saveState(projectDir, refreshed);
    return { recorded: false, reason: merged.reason };
  }
  if (!candidate.conclusive) {
    saveState(projectDir, { ...state, observation: null, repeatedFailure: null, reportIssued: false });
    return { recorded: false, reason: 'ambiguous-command-result' };
  }
  candidate.sourceFingerprint = options.getFingerprint ? options.getFingerprint() : projectFingerprint(projectDir);
  const sourceChanged = previousResult?.sourceFingerprint && previousResult.sourceFingerprint !== candidate.sourceFingerprint;
  const selected = currentCheck(state);
  let repeatedFailure = null;
  if (selected && !selected.passed) {
    const previous = state.repeatedFailure;
    repeatedFailure = {
      fingerprint: selected.fingerprint,
      count: previous?.fingerprint === selected.fingerprint && !sourceChanged
        ? previous.count + (selected === candidate ? 1 : 0) : 1,
    };
  }
  const next = saveState(projectDir, {
    ...state,
    observation: selected,
    repeatedFailure,
    reportIssued: selected?.passed || sourceChanged ? false : state.reportIssued,
  });
  return { recorded: true, state: next, observation: candidate };
}

function invalidateChangedObservation(projectDir, state, sourceFingerprint = null) {
  if (!state.observation) return state;
  if (state.observation.sourceFingerprint === (sourceFingerprint ?? projectFingerprint(projectDir))) return state;
  return saveState(projectDir, { ...state, observation: null, repeatedFailure: null, reportIssued: false });
}

function block(reason, extra = {}) {
  return { action: 'block', reason: `${HOOK_AUTHORITY_BOUNDARY}\n${reason}`, ...extra };
}

function decideStopUnlocked(projectDir, payload = {}) {
  if (payload.stop_hook_active === true) return { action: 'allow', reason: 'continuation-already-active' };
  const state = invalidateChangedObservation(projectDir, loadState(projectDir));
  if (!isExecutionAuthorized(state, payload, 'Stop')) return { action: 'allow', reason: 'not-authorized' };

  if (state.pendingParentEvidence && !state.observation) {
    return block('A child report is not completion evidence. The parent must run the most direct acceptance check and inspect its actual result before claiming completion.');
  }

  if (state.observation && !state.observation.passed) {
    const failure = state.repeatedFailure || { count: 1 };
    const exit = state.observation.exitCode === null ? 'exit code unavailable' : `exit ${state.observation.exitCode}`;
    const detail = `Parent-executed verification failed: ${state.observation.command} (${exit}). ${state.observation.excerpt || 'No output was captured.'}`;
    if (failure.count >= MAX_IDENTICAL_FAILURES) {
      if (state.reportIssued) return { action: 'allow', reason: 'bounded-failure-already-reported', systemMessage: detail };
      saveState(projectDir, { ...state, reportIssued: true });
      return block(`Automatic continuation limit reached after ${failure.count} identical direct failures. Report this concrete failure to the user and stop; do not retry automatically and do not claim completion. ${detail}`, { reportOnly: true });
    }
    return block(`${detail} Fix the observed failure or run a materially different decisive check before completion.`);
  }

  if (!isWorkflowActive(projectDir)) return { action: 'allow', reason: 'inactive-workflow' };

  if (state.observation?.passed) {
    return block('Parent verification passed, but the persisted D/P/T or W workflow is still active. Update the authoritative document state and continue only its unmet outcomes; stop only after the workflow is marked complete.');
  }

  return block('The persisted workflow is still active. Continue from its current documents and unmet outcomes. Do not infer additional scope from this hook message.');
}

function noteExecutionAuthorization(projectDir, payload = {}, options = {}) {
  const prompt = payload.prompt || payload.user_prompt || payload.input || '';
  if (classifyUserIntent(prompt) !== 'execution') return { recorded: false, reason: 'not-execution' };
  return withStateLock(statePath(projectDir), () => noteExecutionAuthorizationUnlocked(projectDir, payload, options));
}

function noteSubagentStop(projectDir, payload = {}) {
  if (!fs.existsSync(statePath(projectDir))) return { recorded: false, reason: 'not-authorized' };
  return withStateLock(statePath(projectDir), () => noteSubagentStopUnlocked(projectDir, payload));
}

function prepareParentCheck(projectDir, payload = {}) {
  if (!loadState(projectDir).pendingParentEvidence) return { recorded: false, reason: 'no-child-claim' };
  return withStateLock(statePath(projectDir), () => prepareParentCheckUnlocked(projectDir, payload));
}

function recordParentObservation(projectDir, payload = {}, options = {}) {
  if (!loadState(projectDir).pendingParentEvidence) return { recorded: false, reason: 'no-child-claim' };
  return withStateLock(statePath(projectDir), () => recordParentObservationUnlocked(projectDir, payload, options));
}

function decideStop(projectDir, payload = {}) {
  if (!fs.existsSync(statePath(projectDir))) return decideStopUnlocked(projectDir, payload);
  return withStateLock(statePath(projectDir), () => {
    const result = decideStopUnlocked(projectDir, payload);
    const current = loadState(projectDir);
    if (current.authorizedSessionId === sessionId(payload)) {
      saveState(projectDir, { ...current, lastStop: { action: result.action, reason: result.reason } });
    }
    return result;
  });
}

function interruptWork(projectDir, payload = {}) {
  const current = loadState(projectDir);
  if (!current.authorizedSessionId || current.authorizedSessionId !== sessionId(payload)) return { recorded: false, reason: 'unowned-session' };
  if (turnId(payload) && current.authorizedTurnId && turnId(payload) !== current.authorizedTurnId
      && payload.hook_event_name !== 'UserPromptSubmit') return { recorded: false, reason: 'older-turn' };
  const result = withStateLock(statePath(projectDir), () => {
    const state = loadState(projectDir);
    return saveState(projectDir, { ...state, suspended: true, observation: null,
      requestExcerpt: payload.prompt ? String(payload.prompt).slice(0, 1000) : state.requestExcerpt,
      lastStop: { action: 'allow', reason: 'User interrupted; no automatic continuation.' } });
  });
  require('../verification-sequence').interruptVerification(projectDir, payload);
  return { recorded: true, state: result };
}

function validateStopDecision(decision, options = {}) {
  if (!decision || !['allow', 'block'].includes(decision.action)) throw new Error('Invalid completion decision.');
  if (options.expectedAction && decision.action !== options.expectedAction) {
    throw new Error(`Expected ${options.expectedAction}, observed ${decision.action}.`);
  }
  if (decision.action === 'block') {
    if (!decision.reason?.includes(HOOK_AUTHORITY_BOUNDARY)) throw new Error('Continuation lacks the synthetic-authority boundary.');
    if (/child.+(?:done|complete).+evidence/i.test(decision.reason) && !/not completion evidence/i.test(decision.reason)) {
      throw new Error('Child completion claim was treated as evidence.');
    }
  }
  return true;
}

module.exports = {
  HOOK_AUTHORITY_BOUNDARY,
  MAX_IDENTICAL_FAILURES,
  STATE_FILE,
  currentUserMessage,
  decideStop,
  defaultState,
  isExecutionAuthorized,
  isWorkflowActive,
  interruptWork,
  loadState,
  noteExecutionAuthorization,
  noteSubagentStop,
  prepareParentCheck,
  recordParentObservation,
  saveState,
  statePath,
  textHash,
  validateStopDecision,
};
