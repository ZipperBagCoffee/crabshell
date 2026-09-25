'use strict';

/**
 * log-guard.js — PreToolUse guard for ticket status transitions
 *
 * Purpose: a ticket cannot be marked done while its Execution Results still
 * hold template text, or verified while any result section does (ticketing
 * Rule 10). Trigger: Edit OR Write on INDEX.md that changes a ticket's status
 * to done/verified. Rows are read with core/index-rows (wikilink ID cells
 * included).
 *
 * Other documents are not checked: a plan becomes done through the ticketing
 * cascade and a discussion concludes through its Final Report. The former
 * work-log length rule was removed in D119 cycle 8 — it had been inactive since
 * the wikilink INDEX migration and, replayed on this repository, would have
 * blocked 162 of 602 real transitions whose results live in result sections.
 *
 * KNOWN LIMITATION: a Bash command that edits INDEX.md directly is not seen.
 *
 * Matcher: Write|Edit (registered in hooks.json PreToolUse)
 */

const path = require('path');
const fs = require('fs');
const { readStdin, normalizePath } = require('./transcript-utils');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir, docDirsPattern } = require('./utils');
const { STORAGE_ROOT, TICKET_ID_SOURCE } = require('./constants');
const { parseIndexRow } = require('./core/index-rows');

// --- Constants ---

// INDEX.md path pattern
const INDEX_PATTERN = new RegExp(`${docDirsPattern(type => type.workflow)}\\/INDEX\\.md$`, 'i');

// All known statuses across document types
const ALL_STATUSES = new Set([
  'todo', 'in-progress', 'done', 'verified', 'blocked', 'abandoned',  // tickets
  'draft', 'approved',                                                   // plans
  'open', 'concluded'                                                    // discussions/investigations
]);

// Statuses that claim completion
const TERMINAL_STATUSES = new Set(['done', 'verified', 'concluded']);

const TICKET_ID = new RegExp(`^${TICKET_ID_SOURCE}$`);

// --- Helpers ---

/**
 * Check if a transition is exempt from the check.
 * Exempt = transitions that represent process steps, not completion claims.
 */
function isExemptTransition(fromStatus, toStatus) {
  if (toStatus === 'abandoned') return true;
  const exempt = [
    ['todo', 'in-progress'],
    ['draft', 'approved'],
    ['blocked', 'in-progress'],
    ['approved', 'in-progress'],
  ];
  return exempt.some(([f, t]) => f === fromStatus && t === toStatus);
}

/**
 * Status of an INDEX.md row (third column: | ID | Title | Status | ... |),
 * or null when the row is not a document row or the cell is not a status.
 */
function extractStatusFromRow(row) {
  const parsed = parseIndexRow(row);
  return parsed && ALL_STATUSES.has(parsed.status) ? parsed.status : null;
}

/**
 * Document ID of an INDEX.md row — bare (D052) or wikilinked ([[D052-slug|D052]]).
 */
function extractIdFromRow(row) {
  const parsed = parseIndexRow(row);
  return parsed ? parsed.id : null;
}

// Status changes between two versions of INDEX rows:
// [{ docId, fromStatus, toStatus, target }] (target = the row's link target).
function compareRows(oldText, newText) {
  const rows = text => String(text || '').split(/\r?\n/).map(parseIndexRow).filter(row => row && ALL_STATUSES.has(row.status));
  const oldMap = new Map(rows(oldText).map(row => [row.id, row.status]));
  const changes = [];
  for (const row of rows(newText)) {
    const fromStatus = oldMap.get(row.id);
    if (fromStatus && fromStatus !== row.status) changes.push({ docId: row.id, fromStatus, toStatus: row.status, target: row.target || null });
  }
  return changes;
}

/**
 * Detect ALL status changes between old_string and new_string (Edit).
 * Handles batch edits (multiple rows changed in one old→new).
 */
function detectStatusChanges(oldString, newString) {
  if (!oldString || !newString) return [];
  return compareRows(oldString, newString);
}

/**
 * Detect ALL status changes in a Write (full file replacement).
 * Reads existing file content from disk, compares with new content.
 */
function detectStatusChangesWrite(filePath, newContent) {
  let oldContent;
  try {
    oldContent = fs.readFileSync(filePath.replace(/\//g, path.sep), 'utf8');
  } catch {
    return []; // File doesn't exist — creation, not update
  }
  return compareRows(oldContent, newContent);
}

/**
 * Find the document file for an ID in a category directory: the row's link
 * target when it exists (two files can share an ID prefix, e.g. a draft next
 * to the document), otherwise the first file named after the ID.
 */
function findDocumentFile(projectDir, category, docId, target) {
  const docDir = path.join(projectDir, STORAGE_ROOT, category);
  try {
    if (target && fs.existsSync(path.join(docDir, `${target}.md`))) return path.join(docDir, `${target}.md`);
    if (!fs.existsSync(docDir)) return null;
    const match = fs.readdirSync(docDir).find(f =>
      f.startsWith(docId) && f.endsWith('.md') && f !== 'INDEX.md'
    );
    return match ? path.join(docDir, match) : null;
  } catch {
    return null;
  }
}

// Ticket result sections. The template puts "(placeholder — ...)" (older
// tickets: "(pending)") under each heading, some with a role suffix such as
// "(Work Agent)"; a section is unfinished while that marker and empty
// sub-headings are all it holds.
// Intent Fidelity (D123): the result compared with the discussion before verified.
const RESULT_SECTION = /^## (Execution Results|Verification Results|Intent Fidelity|Final Verification|Orchestrator Evaluation)\b[^\n]*$/gm;
const TEMPLATE_MARKER = /^\((?:pending|placeholder)\b/;

function unfinishedSections(content) {
  const unfinished = [];
  for (const match of content.matchAll(RESULT_SECTION)) {
    const rest = content.slice(match.index + match[0].length);
    const next = rest.search(/\n## [^#]/);
    const lines = (next === -1 ? rest : rest.slice(0, next)).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length && TEMPLATE_MARKER.test(lines[0]) && lines.slice(1).every(l => /^#{3,}\s/.test(l))) unfinished.push(match[1]);
  }
  return unfinished;
}

/**
 * Check that a ticket's result sections are filled in for the target status:
 * done needs Execution Results (verification comes after done); verified —
 * or an unspecified status — needs every result section.
 * Only applies to ticket documents (constants TICKET_ID_SOURCE).
 * Returns {valid: boolean, reason: string}.
 */
function validatePendingSections(content, docId, toStatus) {
  if (!content || !TICKET_ID.test(docId)) return { valid: true, reason: '' };

  const pendingSections = unfinishedSections(content)
    .filter(section => toStatus !== 'done' || section === 'Execution Results');

  if (pendingSections.length > 0) {
    return {
      valid: false,
      reason: `${docId}: cannot transition to "${toStatus || 'verified'}" — these sections still hold template text ("(placeholder" or "(pending)"): ${pendingSections.join(', ')}. Write the results into them first.`,
    };
  }

  return { valid: true, reason: '' };
}

// --- Main ---

// Returns { reason, log } to block, { log } for a diagnostic only, or null.
function evaluateLogGuard(hookData, projectDir) {
  if (!hookData || !hookData.tool_name) return null;

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') return null;

  const input = hookData.tool_input;
  if (!input) return null;

  const filePath = normalizePath(input.file_path || input.path || '');
  if (!filePath) return null;

  // Edit or Write on INDEX.md — a ticket status change to done/verified
  const indexMatch = filePath.match(INDEX_PATTERN);
  if (!indexMatch) return null;
  const category = indexMatch[1]; // the document folder (constants DOC_TYPES)

  const changes = toolName === 'Edit'
    ? detectStatusChanges(input.old_string || '', input.new_string || '')
    : detectStatusChangesWrite(filePath, input.content || '');

  const ticketChanges = changes.filter(c =>
    TICKET_ID.test(c.docId) && TERMINAL_STATUSES.has(c.toStatus) && !isExemptTransition(c.fromStatus, c.toStatus)
  );

  const logs = [];
  for (const change of ticketChanges) {
    const docFile = findDocumentFile(projectDir, category, change.docId, change.target);

    if (!docFile) {
      // Orphaned INDEX entry (document file missing) → fail-open with warning
      logs.push(`[LOG_GUARD] Warning: document file not found for ${change.docId} in ${category}/ — fail-open`);
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(docFile, 'utf8');
    } catch (e) {
      return { reason: `[LOG_GUARD] Cannot read ${change.docId} document: ${e.message}.`, log: `[LOG_GUARD] Blocked: cannot read ${docFile}` };
    }

    const pendingValidation = validatePendingSections(content, change.docId, change.toStatus);
    if (!pendingValidation.valid) {
      return { reason: `[LOG_GUARD] ${pendingValidation.reason}`, log: `[LOG_GUARD] Blocked: ${change.docId} ${change.fromStatus}→${change.toStatus} has unfinished sections` };
    }
  }

  if (ticketChanges.length > 0) {
    logs.push(`[LOG_GUARD] Allowed ${ticketChanges.length} ticket transition(s)`);
  }
  return logs.length ? { log: logs.join('\n') } : null;
}

async function main() {
  const hookData = await readStdin();
  const result = evaluateLogGuard(hookData, getProjectDir());
  if (!result) { process.exit(0); return; }
  if (result.log) process.stderr.write(result.log + '\n');
  if (!result.reason) { process.exit(0); return; }
  console.log(JSON.stringify({ decision: 'block', reason: result.reason }));
  process.exit(2);
}

// Only run main() when executed directly (not when require'd by tests)
if (require.main === module) {
  main().catch(e => {
    process.stderr.write(`[LOG_GUARD ERROR] ${e.message}\n`);
    process.exit(0); // fail-open
  });
}

// Exports for testing
module.exports = {
  evaluateLogGuard,
  extractStatusFromRow,
  extractIdFromRow,
  detectStatusChanges,
  detectStatusChangesWrite,
  isExemptTransition,
  findDocumentFile,
  validatePendingSections,
  ALL_STATUSES,
  TERMINAL_STATUSES,
  INDEX_PATTERN,
};
