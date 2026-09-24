// All configurable values in one place
module.exports = {
  // Token thresholds (with 5% safety margin)
  ROTATION_THRESHOLD_TOKENS: 23750,  // 25000 * 0.95
  CARRYOVER_TOKENS: 2375,            // 2500 * 0.95

  // Byte fallbacks
  ROTATION_THRESHOLD_BYTES: 95000,   // ~100KB * 0.95
  CARRYOVER_BYTES: 9500,             // ~10KB * 0.95

  // Token calculation
  BYTES_PER_TOKEN: 4,

  // Storage root directory (project-level)
  STORAGE_ROOT: '.crabshell',

  // Directory names (relative to STORAGE_ROOT)
  MEMORY_DIR: 'memory',
  SESSIONS_DIR: 'memory/sessions',
  LOGS_DIR: 'memory/logs',
  WORKFLOW_DIR: 'workflow',
  DISCUSSION_DIR: 'discussion',
  PLAN_DIR: 'plan',
  TICKET_DIR: 'ticket',
  INVESTIGATION_DIR: 'investigation',
  HOTFIX_DIR: 'hotfix',

  // File names
  MEMORY_FILE: 'logbook.md',
  INDEX_FILE: 'memory-index.json',
  COUNTER_FILE: 'counter.json',
  LOCK_FILE: '.rotation.lock',
  REGRESSING_STATE_FILE: 'regressing-state.json',
  SKILL_ACTIVE_FILE: 'skill-active.json',
  DOC_WATCHDOG_FILE: 'doc-watchdog.json',

  // Doc-watchdog threshold
  DOC_WATCHDOG_THRESHOLD: 5,

  // Lock file names
  INDEX_LOCK_FILE: '.memory-index.lock',

  // Lock settings
  LOCK_STALE_MS: 60000,  // 60 seconds
  LOCK_WAIT_MS: 250,     // how long a hook waits for a live lock holder before skipping

  // Edits to these files never need a passing check before commit: prose,
  // stylesheets and images. Every other file — code, configuration (JSON, YAML,
  // hooks manifests), build files, unknown or no extension — arms the commit gate.
  NON_SOURCE_EXTENSIONS: [
    '.md', '.markdown', '.mdx', '.txt', '.rst', '.adoc',
    '.css', '.scss', '.sass', '.less',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.pdf',
  ],
  NON_SOURCE_BASENAMES: ['readme', 'license', 'licence', 'changelog', 'changes', 'notice', 'authors', 'contributors', 'contributing', 'copying'],
  SOURCE_EXCLUDED_DIRS: ['.crabshell', '.claude', 'node_modules', '.git', 'dist', 'build'],

  // SessionStart context budget. Claude Code moves additionalContext over 10,000
  // characters to a file and passes only a 2,000-character preview, so the
  // injected memory must stay below the host cap to reach the model.
  SESSION_START_MAX_CHARS: 9500,

  // Per-session state (memory/session-state/<first 8 chars of session_id>/).
  // Key rule: file names and folders (L1 files, session-state/, memory-index
  // sessionDelta) use the first 8 characters of the session id; JSON maps of
  // per-session decisions (completion-control sessions, regressing owner) use the
  // full id, since Codex ids share time-ordered prefixes.
  SESSION_STATE_DIR: 'session-state',
  SESSION_STATE_MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000,  // same retention as L1 files

  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,  // Base delay for exponential backoff

  // Limits for L3 summary
  MAX_THEMES: 10,
  MAX_DECISIONS: 10,
  MAX_ISSUES: 10,
  SUMMARY_SENTENCES: { min: 10, max: 15 },

  // Archive settings
  ARCHIVE_PREFIX: 'logbook_',
  SUMMARY_SUFFIX: '.summary.json',

  // Delta extraction settings
  DELTA_TEMP_FILE: 'delta_temp.txt',
  DELTA_JOBS_DIR: 'delta-jobs',
  DELTA_SUMMARY_FILE: 'delta_summary_temp.txt',
  HAIKU_CONTEXT_LIMIT: 200000,  // 200K tokens
  HAIKU_SAFE_MARGIN: 0.95,      // 5% margin
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
