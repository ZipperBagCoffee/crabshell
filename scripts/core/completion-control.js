'use strict';

const crypto = require('crypto');
const path = require('path');
const { getLastUserMessage } = require('../transcript-utils');
const { getStorageRoot, readJsonOrDefault, writeJson } = require('../utils');
const { classifyUserIntent } = require('./turn-intent');
const { commandObservation } = require('./command-observation');
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
  writeJson(statePath(projectDir), next);
  return next;
}

function textHash(value) {
  return crypto.createHash('sha256').update(String(value || '').trim()).digest('hex');
}

function turnId(payload = {}) {
  return payload.turn_id || payload.turnId || null;
}

function sessionId(payload = {}) {
  return payload.session_id || payload.sessionId || null;
}

function isWorkflowActive(projectDir) {
  return Boolean(buildWorkflowContext(projectDir, { purpose: 'session' }));
}

function noteExecutionAuthorization(projectDir, payload = {}, options = {}) {
  const prompt = payload.prompt || payload.user_prompt || payload.input || '';
  if (classifyUserIntent(prompt) !== 'execution') return { recorded: false, reason: 'not-execution' };
  const current = loadState(projectDir);
  const nextTurnId = turnId(payload);
  const nextPromptHash = textHash(prompt);
  const sameTurn = current.authorizedSessionId === sessionId(payload)
    && current.authorizedTurnId === nextTurnId
    && current.authorizedPromptHash === nextPromptHash;
  if (sameTurn) return { recorded: false, reason: 'already-authorized', state: current };
  const next = saveState(projectDir, {
    ...defaultState(),
    authorizedSessionId: sessionId(payload),
    authorizedTurnId: nextTurnId,
    authorizedPromptHash: nextPromptHash,
  });
  return { recorded: true, state: next };
}

function currentUserMessage(payload = {}) {
  const direct = payload.user_prompt || payload.prompt || payload.last_user_message;
  if (direct) return String(direct);
  try { return getLastUserMessage(payload.transcript_path); } catch { return ''; }
}

function isExecutionAuthorized(state, payload = {}, eventName = '') {
  const currentSession = sessionId(payload);
  if (state.authorizedSessionId && currentSession && state.authorizedSessionId !== currentSession) return false;
  const currentTurn = turnId(payload);
  if (state.authorizedTurnId && currentTurn) return state.authorizedTurnId === currentTurn;
  if (eventName === 'SubagentStop' || eventName === 'PostToolUse') {
    return Boolean(state.authorizedSessionId && currentSession === state.authorizedSessionId);
  }
  if (state.pendingParentEvidence && state.authorizedSessionId === currentSession) return true;
  const userMessage = currentUserMessage(payload);
  return classifyUserIntent(userMessage) === 'execution'
    && textHash(userMessage) === state.authorizedPromptHash;
}

function noteSubagentStop(projectDir, payload = {}) {
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
    reportIssued: false,
  });
  return { recorded: true, state: next };
}

function recordParentObservation(projectDir, payload = {}) {
  const state = loadState(projectDir);
  if (!state.pendingParentEvidence) return { recorded: false, reason: 'no-child-claim' };
  if (!isExecutionAuthorized(state, payload, 'PostToolUse')) return { recorded: false, reason: 'not-authorized' };
  const observation = commandObservation(payload);
  if (!observation) return { recorded: false, reason: 'not-decisive-command' };
  if (!observation.conclusive) return { recorded: false, reason: 'ambiguous-command-result' };
  let repeatedFailure = null;
  if (!observation.passed) {
    const previous = state.repeatedFailure;
    repeatedFailure = {
      fingerprint: observation.fingerprint,
      count: previous?.fingerprint === observation.fingerprint ? previous.count + 1 : 1,
    };
  }
  const next = saveState(projectDir, {
    ...state,
    observation: { ...observation, observedAt: new Date().toISOString() },
    repeatedFailure,
    reportIssued: observation.passed ? false : state.reportIssued,
  });
  return { recorded: true, state: next, observation };
}

function block(reason, extra = {}) {
  return { action: 'block', reason: `${HOOK_AUTHORITY_BOUNDARY}\n${reason}`, ...extra };
}

function decideStop(projectDir, payload = {}) {
  if (payload.stop_hook_active === true) return { action: 'allow', reason: 'continuation-already-active' };
  if (!isWorkflowActive(projectDir)) return { action: 'allow', reason: 'inactive-workflow' };
  const state = loadState(projectDir);
  if (!isExecutionAuthorized(state, payload, 'Stop')) return { action: 'allow', reason: 'not-authorized' };

  if (state.pendingParentEvidence && !state.observation) {
    return block('A child report is not completion evidence. The parent must run the most direct acceptance check and inspect its actual result before claiming completion.');
  }

  if (state.observation && !state.observation.passed) {
    const failure = state.repeatedFailure || { count: 1 };
    const detail = `Parent-executed verification failed: ${state.observation.command} (exit ${state.observation.exitCode}). ${state.observation.excerpt || 'No output was captured.'}`;
    if (failure.count >= MAX_IDENTICAL_FAILURES) {
      if (state.reportIssued) return { action: 'allow', reason: 'bounded-failure-already-reported', systemMessage: detail };
      saveState(projectDir, { ...state, reportIssued: true });
      return block(`Automatic continuation limit reached after ${failure.count} identical direct failures. Report this concrete failure to the user and stop; do not retry automatically and do not claim completion. ${detail}`, { reportOnly: true });
    }
    return block(`${detail} Fix the observed failure or run a materially different decisive check before completion.`);
  }

  if (state.observation?.passed) {
    return block('Parent verification passed, but the persisted D/P/T or W workflow is still active. Update the authoritative document state and continue only its unmet outcomes; stop only after the workflow is marked complete.');
  }

  return block('The persisted workflow is still active. Continue from its current documents and unmet outcomes. Do not infer additional scope from this hook message.');
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
  loadState,
  noteExecutionAuthorization,
  noteSubagentStop,
  recordParentObservation,
  saveState,
  statePath,
  textHash,
  validateStopDecision,
};
