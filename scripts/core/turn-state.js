'use strict';
// What one host turn has seen so far (D147_T002): whether the fixed rule block was already
// added, and the intent of the latest text the user wrote. Kept per session
// (core/session-state), so sessions in one project never share it. A payload without a
// session or turn number has no turn state: callers fall back to their old behavior.
// The memory notices (core/memory-notice) go on the turn's first prompt only (D149).

const { readSessionState, writeSessionState } = require('./session-state');
const { turnId, sessionId } = require('./turn-id');

const STATE_NAME = 'turn';

// Records one prompt of the current turn. `injecting`: this prompt is the one that may add
// the block (the injection frequency did not skip it). `userAuthored`: the prompt holds
// text the user wrote (core/turn-intent userAuthoredText). Returns { sameTurn, newTurn }:
// sameTurn — the block was already added earlier in this turn; newTurn — this is the
// turn's first prompt (always true without a session or turn number).
function notePrompt(projectDir, payload = {}, { intent = 'default', userAuthored = false, injecting = true } = {}) {
  try {
    const session = sessionId(payload);
    const turn = turnId(payload);
    if (!session || !turn) return { sameTurn: false, newTurn: true };
    const stored = readSessionState(projectDir, session, STATE_NAME, null);
    const continuing = Boolean(stored && stored.turnId === turn);
    const sameTurn = continuing && stored.rulesInjected === true;
    const next = {
      ...(continuing ? stored : {}),
      turnId: turn,
      rulesInjected: sameTurn || Boolean(injecting),
      lastUserIntent: continuing ? stored.lastUserIntent || null : null,
      lastUserAt: continuing ? stored.lastUserAt || null : null,
    };
    if (userAuthored) {
      next.lastUserIntent = intent;
      next.lastUserAt = new Date().toISOString();
    }
    writeSessionState(projectDir, session, STATE_NAME, next);
    return { sameTurn, newTurn: !continuing };
  } catch (_) {
    return { sameTurn: false, newTurn: true };
  }
}

// The intent of the latest text the user wrote in this turn, or null when this turn has
// no record (another turn, or no session/turn number).
function latestUserIntent(projectDir, payload = {}) {
  try {
    const session = sessionId(payload);
    const turn = turnId(payload);
    if (!session || !turn) return null;
    const stored = readSessionState(projectDir, session, STATE_NAME, null);
    return stored && stored.turnId === turn ? stored.lastUserIntent || null : null;
  } catch (_) {
    return null;
  }
}

module.exports = { notePrompt, latestUserIntent, STATE_NAME };
