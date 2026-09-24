// All configurable values in one place

// Document types, one row per folder under STORAGE_ROOT. Each flag names a
// feature that covers the folder, so consumers derive their list from here:
//   workflow    D/P/T/I/H documents (doc watchdog, INDEX log guard)
//   skillOnly   written only while a document skill is active (docs guard)
//   linked      Obsidian link lint and frontmatter migration
//   tracked     listed as active work in compaction recovery context
//   regressing  its skill advances the regressing phase
// indexColumns is the INDEX.md header the bundled Codex document tool writes.
const DOC_TYPES = [
  { dir: 'discussion', prefix: 'D', title: 'Discussion', skill: 'discussing', workflow: true, skillOnly: true, linked: true, tracked: true, regressing: true, indexColumns: ['ID', 'Topic', 'Status', 'Date'] },
  { dir: 'plan', prefix: 'P', title: 'Plan', skill: 'planning', workflow: true, skillOnly: true, linked: true, tracked: true, regressing: true, indexColumns: ['ID', 'Plan', 'Status', 'Date', 'Related'] },
  { dir: 'ticket', prefix: 'T', title: 'Ticket', skill: 'ticketing', workflow: true, skillOnly: true, linked: true, tracked: true, regressing: true, indexColumns: ['ID', 'Ticket', 'Status', 'Date', 'Parent'] },
  { dir: 'investigation', prefix: 'I', title: 'Investigation', skill: 'investigating', workflow: true, skillOnly: true, linked: true, tracked: true, indexColumns: ['ID', 'Title', 'Status', 'Created', 'Related'] },
  { dir: 'hotfix', prefix: 'H', title: 'Hotfix', skill: 'hotfix', workflow: true, skillOnly: true, linked: true, indexColumns: ['ID', 'Title', 'Status', 'Date'] },
  { dir: 'worklog', prefix: 'W', title: 'Worklog', skillOnly: true, linked: true, indexColumns: ['ID', 'Task', 'Status', 'Date', 'Related'] },
  { dir: 'knowledge', prefix: 'K', title: 'Knowledge', indexColumns: ['ID', 'Title', 'Cat', 'Tags', 'Source'] },
];

module.exports = {
  // Token thresholds (with 5% safety margin)
  ROTATION_THRESHOLD_TOKENS: 23750,  // 25000 * 0.95
  CARRYOVER_TOKENS: 2375,            // 2500 * 0.95

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

  // A document skill's project-wide flag (payloads without a session id) lapses
  // after this; a session's own flag lasts until the session compacts or ends.
  SKILL_ACTIVE_TTL_MS: 15 * 60 * 1000,
  // Regressing state not updated for this long is reported as possibly stale.
  REGRESSING_STALE_MS: 24 * 60 * 60 * 1000,

  DOC_TYPES,
  // Ticket IDs are <parent>_T<NNN>. The parent is a discussion (D###, the current
  // form: the discussion carries the plan) or a plan (P###, kept for existing
  // documents). Regex sources, so every guard derives the same shape.
  TICKET_PARENT_SOURCE: '[DP]\\d{3}',
  TICKET_ID_SOURCE: '[DP]\\d{3}_T\\d{3}',
  // Skills allowed to write documents: each type's own skill plus the two
  // workflow skills that drive them.
  DOC_SKILLS: [...new Set(DOC_TYPES.map(type => type.skill).filter(Boolean)), 'regressing', 'verifying'],

  // Archive settings
  ARCHIVE_PREFIX: 'logbook_',
  SUMMARY_SUFFIX: '.summary.json',

  // Delta extraction settings
  DELTA_TEMP_FILE: 'delta_temp.txt',
  DELTA_JOBS_DIR: 'delta-jobs',
  DELTA_SUMMARY_FILE: 'delta_summary_temp.txt',
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
