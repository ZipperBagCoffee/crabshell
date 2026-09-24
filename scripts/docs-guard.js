'use strict';

const path = require('path');
const fs = require('fs');
const { STORAGE_ROOT, MEMORY_DIR, REGRESSING_STATE_FILE, DOC_TYPES } = require('./constants');
const { readStdin, normalizePath } = require('./transcript-utils');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir, readJsonOrDefault, docDirsPattern } = require('./utils');
const { getActiveSkill } = require('./core/skill-flag');

// Document folders only a document skill may write (constants DOC_TYPES skillOnly)
const PROTECTED_DOCS_PATTERN = new RegExp(`${docDirsPattern(type => type.skillOnly)}/`);

/**
 * Check if a Discussion document Edit is blocked by an active regressing session.
 * Approach B: full file-level block for any non-discussing skill during active regressing.
 * Returns null if allowed, error string if blocked.
 */
function checkDiscussionRegressingBlock(filePath, toolName, activeSkill, projectDir) {
  // Only apply to Edit tool on discussion/ paths
  if (toolName !== 'Edit') return null;
  if (!filePath.includes('discussion/') && !filePath.includes('discussion\\')) return null;

  // Absent or unreadable state → allow (fail-open)
  const data = readJsonOrDefault(path.join(projectDir, STORAGE_ROOT, MEMORY_DIR, REGRESSING_STATE_FILE), null);
  if (!data || data.active !== true) return null;

  // Regressing is active — discussing skill is the only legitimate actor for log appends
  if (activeSkill === 'discussing') return null;

  return 'Regressing session is active. Discussion document body cannot be modified during regressing. Only /discussing (log append) is permitted. To amend body sections, end the regressing session first.';
}

/**
 * For investigation documents: verify ## Constraints section exists.
 * Returns null if OK, error string if missing.
 */
function checkInvestigationConstraints(filePath, toolName) {
  if (!filePath.includes('investigation/') && !filePath.includes('investigation\\')) {
    return null;
  }
  // Write to non-existent file = first creation → allow
  if (toolName === 'Write') {
    try {
      if (!fs.existsSync(filePath)) return null;
    } catch { return null; }
  }
  // Check existing file for ## Constraints
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes('## Constraints')) {
      return 'I document missing ## Constraints section. Add constraints before further edits.';
    }
    return null;
  } catch { return null; }
}

// Returns { reason, log } when the write must be blocked, otherwise null.
function evaluateDocsGuard(hookData, projectDir) {
  if (!hookData || !hookData.tool_name) return null;

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') return null;

  const input = hookData.tool_input;
  if (!input) return null;

  const filePath = normalizePath(input.file_path || input.path || '');
  if (!filePath) return null;

  // Only guard protected .crabshell/ D/P/T/I paths
  if (!PROTECTED_DOCS_PATTERN.test(filePath)) return null;

  // INDEX.md files are simple listing files — never require skill-active protection
  if (path.basename(filePath) === 'INDEX.md') return null;

  // Check if a legitimate skill is active
  const activeSkill = getActiveSkill(projectDir, hookData.session_id);
  if (activeSkill) {
    // Skill is active — check Discussion body edit during regressing before allowing
    const discussionRegressingError = checkDiscussionRegressingBlock(filePath, toolName, activeSkill, projectDir);
    if (discussionRegressingError) {
      return { reason: discussionRegressingError, log: `[DOCS_GUARD] Blocked ${toolName} to ${filePath} — discussion body edit during regressing` };
    }
    // Check investigation Constraints before allowing
    const constraintError = checkInvestigationConstraints(filePath, toolName);
    if (constraintError) {
      return { reason: constraintError, log: `[DOCS_GUARD] Blocked ${toolName} to ${filePath} — ${constraintError}` };
    }
    return null;
  }

  // No active skill — block the write
  const docType = filePath.match(PROTECTED_DOCS_PATTERN);
  const category = docType ? docType[1] : 'docs';

  const typeRow = DOC_TYPES.find(type => type.dir === category);
  const suggestedSkill = (typeRow && typeRow.skill) || 'the appropriate document skill';

  return {
    reason: `Direct write to .crabshell/${category}/ blocked. You MUST invoke the Skill tool first (skill="${suggestedSkill}") before writing ${category} documents. This prevents post-compaction skill bypass where documents are created from memory without proper skill workflow.`,
    log: `[DOCS_GUARD] Blocked ${toolName} to ${filePath} — no active skill`,
  };
}

async function main() {
  const hookData = await readStdin();
  const result = evaluateDocsGuard(hookData, getProjectDir());
  if (!result) { process.exit(0); return; }
  process.stderr.write(result.log + '\n');
  console.log(JSON.stringify({ decision: 'block', reason: result.reason }));
  process.exit(2);
}

if (require.main === module) {
  main().catch(e => {
    console.error(`[DOCS GUARD ERROR] ${e.message}`);
    process.exit(0); // fail-open
  });
}

module.exports = { evaluateDocsGuard, checkInvestigationConstraints, checkDiscussionRegressingBlock };
