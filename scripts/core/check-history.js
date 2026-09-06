'use strict';

function identity(payload) {
  if (!payload.tool_use_id) return null;
  return JSON.stringify([payload.session_id || '', payload.turn_id || payload.prompt_id || '', payload.tool_use_id]);
}

function historyOf(state) {
  if (!state.checkHistory) state.checkHistory = { sequence: 0, pending: {}, latestStarted: {}, results: {}, trackedStarts: false };
  return state.checkHistory;
}

function startCheck(state, payload, checkKey) {
  const id = identity(payload);
  if (!id || !checkKey) return false;
  const history = historyOf(state);
  if (Object.hasOwn(history.pending, id)) return false;
  if (history.results[checkKey]?.identity === id) return false;
  const order = ++history.sequence;
  history.pending[id] = { checkKey, order };
  history.latestStarted[checkKey] = order;
  history.trackedStarts = true;
  return true;
}

function recordCheck(state, payload, observation) {
  const history = historyOf(state);
  const key = observation.checkKey;
  const id = identity(payload);
  const previous = history.results[key];
  const pending = id && Object.hasOwn(history.pending, id) ? history.pending[id] : null;
  if (previous && id && previous.identity === id) {
    if (previous.observation.outcome === 'interrupted') return { accepted: false, reason: 'interrupted-invocation' };
    if (previous.observation.conclusive && !observation.conclusive) return { accepted: false, reason: 'late-progress' };
    if (previous.observation.conclusive && previous.observation.fingerprint !== observation.fingerprint) {
      observation.conclusive = false;
      observation.passed = false;
      observation.outcome = 'unknown';
    } else if (previous.observation.conclusive || !observation.conclusive) return { accepted: false, reason: 'duplicate-result' };
  } else if (history.trackedStarts && !pending) {
    return { accepted: false, reason: 'untracked-or-superseded-result' };
  }
  if (pending && pending.order < history.latestStarted[key]) {
    delete history.pending[id];
    return { accepted: false, reason: 'superseded-result' };
  }
  if (previous?.observation.startedAtMs && observation.startedAtMs
      && observation.startedAtMs < previous.observation.startedAtMs) {
    if (pending) delete history.pending[id];
    return { accepted: false, reason: 'older-result' };
  }
  const order = pending?.order || (previous && id && previous.identity === id ? previous.order : ++history.sequence);
  if (pending && observation.outcome !== 'running') delete history.pending[id];
  history.results[key] = { identity: id, order, observation };
  return { accepted: true, reason: 'recorded' };
}

function currentCheck(state) {
  const history = state.checkHistory;
  if (!history) return state.observation || null;
  const rows = Object.values(history.results).sort((a, b) => b.order - a.order);
  const failure = rows.find(row => row.observation.outcome === 'failed');
  if (failure) return failure.observation;
  if (Object.keys(history.pending).length > 0) return null;
  if (rows.some(row => !row.observation.conclusive)) return null;
  return rows[0]?.observation || null;
}

module.exports = { identity, startCheck, recordCheck, currentCheck };
