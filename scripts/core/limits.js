'use strict';

// Time limits shared by modules, defined once. Per-session state retention
// (SESSION_STATE_MAX_AGE_MS) stays with the session-state names in constants.js.

module.exports = {
  // A document skill's project-wide flag (payloads without a session id) lapses
  // after this; a session's own flag lasts until the session compacts or ends.
  SKILL_ACTIVE_TTL_MS: 15 * 60 * 1000,
  // Regressing state not updated for this long is reported as possibly stale.
  REGRESSING_STALE_MS: 24 * 60 * 60 * 1000,
  // A before-run file record (core/declaration-guidance) older than this is a run that never finished.
  RUN_SNAPSHOT_MAX_AGE_MS: 24 * 60 * 60 * 1000,
};
