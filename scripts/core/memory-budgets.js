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

  // L1 (refined session log) entry sizes; a cut is marked by core/cut.js
  L1_COMMAND_CHARS: 200,        // shell command kept per tool entry
  L1_TOOL_OUTPUT_CHARS: 200,    // tool result text kept per entry
  L1_DIFF_LINES: 3,             // first lines of each side of an edit kept in the L1 diff summary
  L1_DIFF_CHARS: 100,           // characters of each side kept in the L1 diff summary

  // Memory context pieces (core/memory-context.js, recovery-context.js)
  UNREFLECTED_SCAN_ENTRIES: 50, // newest L1 lines checked for unreflected assistant text
  UNREFLECTED_TEXT_CHARS: 200,  // each unreflected assistant text
  RECOVERY_CHECK_COMMAND_CHARS: 400,  // last observed check command
  RECOVERY_CONTEXT_CHARS: 3500, // the whole last-work-record block

  // Relevant memory snippets added to a prompt (inject-rules.js)
  SNIPPET_MAX_SECTIONS: 3,
  SNIPPET_CAP_CHARS: 2000,

  // Project description readers (core/project-memory.js)
  PROJECT_CONCEPT_LINES: 20,
  PROJECT_CONCEPT_CHARS: 1000,
  MODEL_ROUTING_CHARS: 300,

  // Codex memory command defaults (codex-memory.js)
  CODEX_TAIL_LINES: 80,
  CODEX_SUMMARY_COUNT: 5,
  CODEX_SEARCH_LIMIT: 20,

  // Timestamp format function (UTC)
  getTimestamp: () => {
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    return `${now.getUTCFullYear()}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  }
};
