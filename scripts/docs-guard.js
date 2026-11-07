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
const { leadingId } = require('./core/index-rows');
const { planProblem, ticketHasDetails } = require('./core/plan-entry');
const { fileWrites } = require('./core/tool-shape');

// Document folders only a document skill may write (constants DOC_TYPES skillOnly)
const PROTECTED_DOCS_PATTERN = new RegExp(`${docDirsPattern(type => type.skillOnly)}/`);

/**
 * Check if a Discussion document Edit is blocked by an active regressing session.
 * Approach B: full file-level block for any non-discussing skill during active regressing.
 * Returns null if allowed, error string if blocked.
 */
function checkDiscussionRegressingBlock(filePath, kind, activeSkill, projectDir) {
  // Only apply to string edits (core/tool-shape kind 'edit') on discussion/ paths
  if (kind !== 'edit') return null;
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
function checkInvestigationConstraints(filePath, kind) {
  if (!filePath.includes('investigation/') && !filePath.includes('investigation\\')) {
    return null;
  }
  // A whole-file write to a non-existent file = first creation → allow
  if (kind === 'whole') {
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

/**
 * A new discussion-parent ticket needs its discussion's plan and its own part of
 * it (D123): written without them, the ticket was made before anyone settled how
 * to build. Only the first Write of a D###_T### file is checked; a missing parent
 * or unreadable file passes (the ticketing skill reports a missing parent).
 * Returns null if OK, error string if blocked.
 */
function checkTicketPlan(filePath, kind, content, projectDir) {
  if (kind !== 'whole') return null;
  const match = filePath.match(/(?:^|\/)ticket\/(D\d{3})_T\d{3}[^/]*\.md$/);
  if (!match) return null;
  try {
    if (fs.existsSync(filePath.replace(/\//g, path.sep))) return null;
    const discussionDir = path.join(projectDir, STORAGE_ROOT, 'discussion');
    const parentFile = fs.existsSync(discussionDir) && fs.readdirSync(discussionDir).find(name => name.startsWith(`${match[1]}-`) && name.endsWith('.md'));
    if (!parentFile) return null;
    const problem = planProblem(fs.readFileSync(path.join(discussionDir, parentFile), 'utf8'), match[1]);
    if (problem) return `New ticket under ${match[1]} blocked: ${problem}`;
    if (!ticketHasDetails(content)) {
      return `New ticket under ${match[1]} blocked: its ## Implementation Details is empty. Fill it with this ticket's part of ${match[1]}'s plan — each file → function/section → what changes — then write the ticket.`;
    }
    return null;
  } catch { return null; }
}

// Returns { reason, log } when a write of the call must be blocked, otherwise null.
// Every file the call writes is checked, whatever the tool is named (core/tool-shape).
function evaluateDocsGuard(hookData, projectDir) {
  if (!hookData) return null;
  for (const write of fileWrites(hookData)) {
    const result = evaluateWrite(hookData, write, projectDir);
    if (result) return result;
  }
  return null;
}

function evaluateWrite(hookData, write, projectDir) {
  const toolName = hookData.tool_name;
  const kind = write.kind;
  const filePath = normalizePath(write.path);
  if (!filePath) return null;

  // Only guard protected .crabshell/ D/P/T/I paths
  if (!PROTECTED_DOCS_PATTERN.test(filePath)) return null;

  // INDEX.md files are simple listing files — never require skill-active protection
  if (path.basename(filePath) === 'INDEX.md') return null;

  // Check if a legitimate skill is active
  const activeSkill = getActiveSkill(projectDir, hookData.session_id);
  if (activeSkill) {
    // Skill is active — check Discussion body edit during regressing before allowing
    const discussionRegressingError = checkDiscussionRegressingBlock(filePath, kind, activeSkill, projectDir);
    if (discussionRegressingError) {
      return { reason: discussionRegressingError, log: `[DOCS_GUARD] Blocked ${toolName} to ${filePath} — discussion body edit during regressing` };
    }
    // Check investigation Constraints before allowing
    const constraintError = checkInvestigationConstraints(filePath, kind);
    if (constraintError) {
      return { reason: constraintError, log: `[DOCS_GUARD] Blocked ${toolName} to ${filePath} — ${constraintError}` };
    }
    const planError = checkTicketPlan(filePath, kind, write.content, projectDir);
    if (planError) {
      return { reason: planError, log: `[DOCS_GUARD] Blocked ${toolName} to ${filePath} — ticket before its discussion's plan or details` };
    }
    return null;
  }

  // No active skill — block the write
  const docType = filePath.match(PROTECTED_DOCS_PATTERN);
  const category = docType ? docType[1] : 'docs';

  const typeRow = DOC_TYPES.find(type => type.dir === category);
  const suggestedSkill = (typeRow && typeRow.skill) || 'the appropriate document skill';
  // An existing document is continued in the skill's update mode, called with its ID.
  const docId = leadingId(path.basename(filePath, '.md'));
  const existing = Boolean(docId) && fs.existsSync(filePath.replace(/\//g, path.sep));
  const call = existing ? `skill="${suggestedSkill}", args="${docId}"` : `skill="${suggestedSkill}"`;

  return {
    reason: `Direct write to .crabshell/${category}/ blocked: this session has not loaded the ${suggestedSkill} skill (a new session, or compaction re-attached only the start of it). Invoke the Skill tool first (${call})${existing ? ` — ${docId} exists, so call it in update mode with that ID` : ''}. Re-invoking reloads the instructions; it does not redo one-time setup.`,
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

module.exports = { evaluateDocsGuard, checkInvestigationConstraints, checkDiscussionRegressingBlock, checkTicketPlan };
