'use strict';

// Memory size budgets: when the logbook rotates and how much carries over, what a
// delta summary and the SessionStart context may hold; and the archive timestamp.

module.exports = {
  // Token thresholds (with 5% safety margin)
  ROTATION_THRESHOLD_TOKENS: 23750,  // 25000 * 0.95
  CARRYOVER_TOKENS: 2375,            // 2500 * 0.95

  // SessionStart context budget. Claude Code moves additionalContext over 10,000
  // characters to a file and passes only a 2,000-character preview, so the
  // injected memory must stay below the host cap to reach the model.
  SESSION_START_MAX_CHARS: 9500,

  // Delta extraction settings
  HAIKU_SAFE_TOKENS: Math.floor(200000 * 0.95),  // 190K tokens
  FIRST_RUN_MAX_ENTRIES: 50,    // First run limit
  DELTA_OUTPUT_TRUNCATE: 300,   // Truncate tool output to this length

  // Timestamp format function (UTC)
  getTimestamp: () => {
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    return `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  }
};
