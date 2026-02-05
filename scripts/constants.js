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

  // Directory names (relative to .claude/)
  MEMORY_DIR: 'memory',
  SESSIONS_DIR: 'memory/sessions',
  LOGS_DIR: 'memory/logs',
  LESSONS_DIR: 'lessons',
  WORKFLOW_DIR: 'workflow',

  // File names
  MEMORY_FILE: 'memory.md',
  INDEX_FILE: 'memory-index.json',
  LOCK_FILE: '.rotation.lock',

  // Lock settings
  LOCK_STALE_MS: 60000,  // 60 seconds

  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,  // Base delay for exponential backoff

  // Limits for L3 summary
  MAX_THEMES: 10,
  MAX_DECISIONS: 10,
  MAX_ISSUES: 10,
  SUMMARY_SENTENCES: { min: 10, max: 15 },

  // Archive settings
  ARCHIVE_PREFIX: 'memory_',
  SUMMARY_SUFFIX: '.summary.json',

  // Delta extraction settings
  DELTA_TEMP_FILE: 'delta_temp.txt',
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
