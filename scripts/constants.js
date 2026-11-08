// Storage names and the per-session retention. Other shared values live by subject:
// core/doc-types.js (document types), core/limits.js (time limits),
// core/memory-budgets.js (memory sizes), core/file-lock.js (lock timing).

module.exports = {
  // Storage root directory (project-level)
  STORAGE_ROOT: '.crabshell',

  // Directory names (relative to STORAGE_ROOT)
  MEMORY_DIR: 'memory',
  SESSIONS_DIR: 'memory/sessions',
  LOGS_DIR: 'memory/logs',
  WORKFLOW_DIR: 'workflow',
  TICKET_DIR: 'ticket',

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

  // Per-session state (memory/session-state/<first 8 chars of session_id>/).
  // Key rule: file names and folders (L1 files, session-state/, memory-index
  // sessionDelta) use the first 8 characters of the session id; JSON maps of
  // per-session decisions (completion-control sessions, regressing owner) use the
  // full id, since Codex ids share time-ordered prefixes.
  SESSION_STATE_DIR: 'session-state',
  SESSION_STATE_MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000,  // same retention as L1 files

  // Archive settings
  ARCHIVE_PREFIX: 'logbook_',
  SUMMARY_SUFFIX: '.summary.json',

  // Delta extraction settings
  DELTA_TEMP_FILE: 'delta_temp.txt',
  DELTA_JOBS_DIR: 'delta-jobs',
  DELTA_SUMMARY_FILE: 'delta_summary_temp.txt',
};
