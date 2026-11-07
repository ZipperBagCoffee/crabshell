'use strict';
// The host's identifiers for a session and a turn (D147). Claude sends `prompt_id` on
// every hook event, and a message that arrives mid-turn keeps its turn's value (captured
// on Claude Code 2.1.319: scripts/fixtures/hook-payloads/native/claude-UserPromptSubmit-*.json);
// Codex sends `turn_id`. One place reads them so every hook means the same turn.

function turnId(payload = {}) {
  return payload.turn_id || payload.turnId || payload.prompt_id || null;
}

function sessionId(payload = {}) {
  return payload.session_id || payload.sessionId || null;
}

module.exports = { turnId, sessionId };
