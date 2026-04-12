'use strict';

const path = require('path');
const fs = require('fs');
const { SKILL_ACTIVE_FILE } = require('./constants');
const { readStdin, normalizePath } = require('./transcript-utils');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

// Protected .crabshell/ subdirectories (D/P/T/I/W documents)
const PROTECTED_DOCS_PATTERN = /\.crabshell\/(discussion|plan|ticket|investigation|worklog)\//;

// Skills that legitimately create/modify .crabshell/ D/P/T/I files
const LEGITIMATE_SKILLS = [
  'discussing', 'planning', 'ticketing', 'investigating',
  'regressing', 'light-workflow', 'verifying'
];

// TTL for skill-active flag (15 minutes)
const SKILL_ACTIVE_TTL_MS = 15 * 60 * 1000;

/**
 * Check if a skill-active flag is valid (exists, not expired).
 * Returns the skill name if valid, null otherwise.
 */
function getActiveSkill(projectDir) {
  const { STORAGE_ROOT } = require('./constants');
  const flagPath = path.join(projectDir, STORAGE_ROOT, 'memory', SKILL_ACTIVE_FILE);
  try {
    if (!fs.existsSync(flagPath)) return null;
    const data = JSON.parse(fs.readFileSync(flagPath, 'utf8'));
    if (!data || !data.skill || !data.activatedAt) return null;

    // Check TTL
    const ttl = data.ttl || SKILL_ACTIVE_TTL_MS;
    const elapsed = Date.now() - new Date(data.activatedAt).getTime();
    if (elapsed > ttl) {
      // Expired — clean up
      try { fs.unlinkSync(flagPath); } catch {}
      return null;
    }

    // Check if it's a legitimate skill
    if (!LEGITIMATE_SKILLS.includes(data.skill)) return null;

    return data.skill;
  } catch {
    return null;
  }
}

/**
 * Check if a Discussion document Edit is blocked by an active regressing session.
 * Approach B: full file-level block for any non-discussing skill during active regressing.
 * Returns null if allowed, error string if blocked.
 */
function checkDiscussionRegressingBlock(filePath, toolName, activeSkill, projectDir) {
  // Only apply to Edit tool on discussion/ paths
  if (toolName !== 'Edit') return null;
  if (!filePath.includes('discussion/') && !filePath.includes('discussion\\')) return null;

  // Read regressing-state.json inline (avoid circular dependency)
  try {
    const { STORAGE_ROOT } = require('./constants');
    const statePath = require('path').join(projectDir, STORAGE_ROOT, 'memory', 'regressing-state.json');
    const data = JSON.parse(require('fs').readFileSync(statePath, 'utf8'));
    if (!data || data.active !== true) return null;
  } catch {
    // File absent or unreadable → allow (fail-open)
    return null;
  }

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

async function main() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') { process.exit(0); return; }

  const input = hookData.tool_input;
  if (!input) { process.exit(0); return; }

  const filePath = normalizePath(input.file_path || input.path || '');
  if (!filePath) { process.exit(0); return; }

  // Only guard protected .crabshell/ D/P/T/I paths
  if (!PROTECTED_DOCS_PATTERN.test(filePath)) { process.exit(0); return; }

  // INDEX.md files are simple listing files — never require skill-active protection
  if (path.basename(filePath) === 'INDEX.md') { process.exit(0); return; }

  const projectDir = getProjectDir();

  // Check if a legitimate skill is active
  const activeSkill = getActiveSkill(projectDir);
  if (activeSkill) {
    // Skill is active — check Discussion body edit during regressing before allowing
    const discussionRegressingError = checkDiscussionRegressingBlock(filePath, toolName, activeSkill, projectDir);
    if (discussionRegressingError) {
      const output = {
        decision: "block",
        reason: discussionRegressingError
      };
      process.stderr.write(`[DOCS_GUARD] Blocked ${toolName} to ${filePath} — discussion body edit during regressing\n`);
      console.log(JSON.stringify(output));
      process.exit(2);
      return;
    }
    // Check investigation Constraints before allowing
    const constraintError = checkInvestigationConstraints(filePath, toolName);
    if (constraintError) {
      const output = {
        decision: "block",
        reason: constraintError
      };
      process.stderr.write(`[DOCS_GUARD] Blocked ${toolName} to ${filePath} — ${constraintError}\n`);
      console.log(JSON.stringify(output));
      process.exit(2);
      return;
    }
    process.exit(0);
    return;
  }

  // No active skill — block the write
  const docType = filePath.match(PROTECTED_DOCS_PATTERN);
  const category = docType ? docType[1] : 'docs';

  const skillMap = {
    discussion: 'discussing',
    plan: 'planning',
    ticket: 'ticketing',
    investigation: 'investigating'
  };
  const suggestedSkill = skillMap[category] || 'the appropriate document skill';

  const output = {
    decision: "block",
    reason: `Direct write to .crabshell/${category}/ blocked. You MUST invoke the Skill tool first (skill="${suggestedSkill}") before writing ${category} documents. This prevents post-compaction skill bypass where documents are created from memory without proper skill workflow.`
  };

  process.stderr.write(`[DOCS_GUARD] Blocked ${toolName} to ${filePath} — no active skill\n`);
  console.log(JSON.stringify(output));
  process.exit(2);
}

main().catch(e => {
  console.error(`[DOCS GUARD ERROR] ${e.message}`);
  process.exit(0); // fail-open
});

module.exports = { checkInvestigationConstraints, checkDiscussionRegressingBlock };
