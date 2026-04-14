'use strict';

/**
 * log-guard.js — PreToolUse guard for D/P/T/I status transitions
 *
 * Purpose: Prevent status transitions to terminal states in INDEX.md
 * unless the corresponding document file has substantive log entries.
 *
 * Two triggers:
 *   Trigger 1: Edit OR Write on INDEX.md that changes status → terminal
 *   Trigger 2: Write/Edit creating new plan/ticket during regressing cycle > 1
 *              (Bypass 5 defense: LLM skips to next cycle without closing previous)
 *
 * Bypass defenses:
 *   Bypass 1 (Rubber-stamp): Non-Created entries must have body > 30 chars.
 *     countLogEntries is replaced by parseLogEntries + validateLogForTerminal.
 *   Bypass 2 (Bash INDEX.md): Not solvable here — path-guard.js restricts
 *     Bash on .crabshell/ paths. KNOWN LIMITATION: if Bash somehow modifies
 *     INDEX.md status directly (e.g., sed), this guard won't catch it.
 *   Bypass 5 (Next-step trigger): Checks regressing-state.json prevPlanId
 *     when creating new plan/ticket docs in cycle > 1; blocks if previous
 *     cycle tickets are not in terminal status.
 *
 * Matcher: Write|Edit (registered in hooks.json PreToolUse)
 */

const path = require('path');
const fs = require('fs');
const { readStdin, normalizePath } = require('./transcript-utils');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

// --- Constants ---

// INDEX.md path pattern
const INDEX_PATTERN = /\.crabshell\/(discussion|plan|ticket|investigation|hotfix)\/INDEX\.md$/i;

// Plan/ticket document pattern (not INDEX.md) — used by Trigger 2
const PLAN_DOC_PATTERN = /\.crabshell\/plan\/P\d{3}[^/]*\.md$/;
const TICKET_DOC_PATTERN = /\.crabshell\/ticket\/P\d{3}_T\d{3}[^/]*\.md$/;

// All known statuses across document types
const ALL_STATUSES = new Set([
  'todo', 'in-progress', 'done', 'verified', 'blocked', 'abandoned',  // tickets
  'draft', 'approved',                                                   // plans
  'open', 'concluded'                                                    // discussions/investigations
]);

// Terminal statuses that require substantive log entries
const TERMINAL_STATUSES = new Set(['done', 'verified', 'concluded']);

// Minimum body length for a log entry to count as substantive (Bypass 1 defense)
const MIN_ENTRY_BODY_LENGTH = 30;

// --- Helpers ---

/**
 * Check if a transition is exempt from log requirement.
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
 * Extract status from a pipe-delimited table row.
 * Status is always column 3 in INDEX.md tables:
 *   | ID | Title | Status | Created | ... |
 * cells[0]='' cells[1]=ID cells[2]=Title cells[3]=Status
 */
function extractStatusFromRow(row) {
  if (!row || typeof row !== 'string') return null;
  const trimmed = row.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.split('|').map(c => c.trim());
  if (cells.length < 4) return null;
  const candidate = cells[3].toLowerCase();
  if (ALL_STATUSES.has(candidate)) return candidate;
  return null;
}

/**
 * Extract document ID from a pipe-delimited table row.
 * ID is cells[1] after split by '|'.
 */
function extractIdFromRow(row) {
  if (!row || typeof row !== 'string') return null;
  const trimmed = row.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.split('|').map(c => c.trim());
  if (cells.length < 2) return null;
  const id = cells[1];
  if (/^[DPTIH]\d{3}(_T\d{3})?$/.test(id)) return id;
  return null;
}

/**
 * Detect ALL status changes between old_string and new_string (Edit).
 * Returns array of {docId, fromStatus, toStatus}.
 * Handles batch edits (multiple rows changed in one old→new).
 */
function detectStatusChanges(oldString, newString) {
  const changes = [];
  if (!oldString || !newString) return changes;

  const oldLines = oldString.split('\n').filter(l => l.trim().startsWith('|'));
  const newLines = newString.split('\n').filter(l => l.trim().startsWith('|'));

  // Build ID→status map from old lines
  const oldMap = new Map();
  for (const line of oldLines) {
    const id = extractIdFromRow(line);
    const status = extractStatusFromRow(line);
    if (id && status) oldMap.set(id, status);
  }

  // Compare new lines against old
  for (const line of newLines) {
    const id = extractIdFromRow(line);
    const status = extractStatusFromRow(line);
    if (!id || !status) continue;
    const oldStatus = oldMap.get(id);
    if (oldStatus && oldStatus !== status) {
      changes.push({ docId: id, fromStatus: oldStatus, toStatus: status });
    }
  }

  return changes;
}

/**
 * Detect ALL status changes in a Write (full file replacement).
 * Reads existing file content from disk, compares with new content.
 */
function detectStatusChangesWrite(filePath, newContent) {
  const changes = [];
  let oldContent;
  try {
    const osPath = filePath.replace(/\//g, path.sep);
    oldContent = fs.readFileSync(osPath, 'utf8');
  } catch {
    return changes; // File doesn't exist — creation, not update
  }

  const oldLines = oldContent.split('\n').filter(l => l.trim().startsWith('|'));
  const newLines = newContent.split('\n').filter(l => l.trim().startsWith('|'));

  const oldMap = new Map();
  for (const line of oldLines) {
    const id = extractIdFromRow(line);
    const status = extractStatusFromRow(line);
    if (id && status) oldMap.set(id, status);
  }

  for (const line of newLines) {
    const id = extractIdFromRow(line);
    const status = extractStatusFromRow(line);
    if (!id || !status) continue;
    const oldStatus = oldMap.get(id);
    if (oldStatus && oldStatus !== status) {
      changes.push({ docId: id, fromStatus: oldStatus, toStatus: status });
    }
  }

  return changes;
}

/**
 * Find the document file for a given document ID in a category directory.
 */
function findDocumentFile(projectDir, category, docId) {
  const docDir = path.join(projectDir, '.crabshell', category);
  try {
    if (!fs.existsSync(docDir)) return null;
    const files = fs.readdirSync(docDir);
    const match = files.find(f =>
      f.startsWith(docId) && f.endsWith('.md') && f !== 'INDEX.md'
    );
    return match ? path.join(docDir, match) : null;
  } catch {
    return null;
  }
}

/**
 * Parse log entries from a document's ## Log section.
 * Returns array of {type, timestamp, body, bodyLength}.
 *
 * Entry header: ### [YYYY-MM-DD HH:MM] EntryType
 * Body: text between header and next entry/section/EOF.
 */
function parseLogEntries(content) {
  const entries = [];
  if (!content) return entries;

  // Find ## Log or ## Discussion Log section
  const logMatch = content.match(/^##\s+(Log|Discussion Log)\s*$/m);
  if (!logMatch) return entries;

  const logStart = logMatch.index + logMatch[0].length;
  const rest = content.slice(logStart);
  // Section ends at next ## heading or EOF
  const nextHeading = rest.match(/\n## [^#]/);
  const logContent = nextHeading ? rest.slice(0, nextHeading.index) : rest;

  const entryRegex = /^###\s+\[([^\]]+)\]\s+(.+)/gm;
  let match;
  const headers = [];
  while ((match = entryRegex.exec(logContent)) !== null) {
    headers.push({
      index: match.index,
      endOfHeader: match.index + match[0].length,
      timestamp: match[1],
      type: match[2].trim(),
    });
  }

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const bodyStart = h.endOfHeader;
    const bodyEnd = i + 1 < headers.length ? headers[i + 1].index : logContent.length;
    const rawBody = logContent.slice(bodyStart, bodyEnd);
    // Strip blank lines and separator lines (---), then measure
    const body = rawBody
      .split('\n')
      .filter(l => l.trim() !== '' && l.trim() !== '---')
      .map(l => l.trim())
      .join('\n')
      .trim();

    entries.push({
      type: h.type,
      timestamp: h.timestamp,
      body,
      bodyLength: body.length,
    });
  }

  return entries;
}

/**
 * Check if a log entry is a "Created" entry.
 */
function isCreatedEntry(entry) {
  return /^Created$/i.test(entry.type);
}

/**
 * Check if a log entry is a "Status Change" entry.
 */
function isStatusChangeEntry(entry) {
  return /^Status Change:/i.test(entry.type);
}

/**
 * Validate that a document has substantive log entries for a terminal transition.
 * Returns {valid: boolean, reason: string}.
 *
 * Bypass 1 defense:
 *   - Must have >= 1 non-Created, non-StatusChange entry
 *   - Those entries must have body > MIN_ENTRY_BODY_LENGTH chars
 */
function validateLogForTerminal(entries, toStatus, docId) {
  if (entries.length === 0) {
    return {
      valid: false,
      reason: `${docId}: no log entries found. Add work log entries before transitioning to "${toStatus}".`,
    };
  }

  // Filter to work entries (not Created, not Status Change)
  const workEntries = entries.filter(e => !isCreatedEntry(e) && !isStatusChangeEntry(e));

  if (workEntries.length === 0) {
    return {
      valid: false,
      reason: `${docId}: only "Created"/"Status Change" entries found. Status "${toStatus}" requires at least one work log entry (Work Log, Verification Run, etc.) beyond initial creation.`,
    };
  }

  // Bypass 1 defense: check body length of work entries
  const substantive = workEntries.filter(e => e.bodyLength > MIN_ENTRY_BODY_LENGTH);
  if (substantive.length === 0) {
    return {
      valid: false,
      reason: `${docId}: found ${workEntries.length} work log entries, but none have substantive content (>${MIN_ENTRY_BODY_LENGTH} chars). Add meaningful descriptions before transitioning to "${toStatus}".`,
    };
  }

  return { valid: true, reason: '' };
}

/**
 * Check if a ticket document still has "(pending)" in result sections.
 * Only applies to ticket documents (P\d{3}_T\d{3}).
 * Returns {valid: boolean, reason: string}.
 *
 * Checks these sections:
 *   - ## Execution Results (Work Agent)
 *   - ## Verification Results (Review Agent)
 *   - ## Orchestrator Evaluation
 */
function validatePendingSections(content, docId) {
  if (!content) return { valid: true, reason: '' };

  // Only check tickets
  if (!/^P\d{3}_T\d{3}$/.test(docId)) return { valid: true, reason: '' };

  const pendingSections = [];

  const patterns = [
    { label: 'Execution Results (Work Agent)', regex: /^## Execution Results \(Work Agent\)\s*\n\(pending\)/m },
    { label: 'Verification Results (Review Agent)', regex: /^## Verification Results \(Review Agent\)\s*\n\(pending\)/m },
    { label: 'Orchestrator Evaluation', regex: /^## Orchestrator Evaluation\s*\n\(pending\)/m },
  ];

  for (const p of patterns) {
    if (p.regex.test(content)) {
      pendingSections.push(p.label);
    }
  }

  if (pendingSections.length > 0) {
    return {
      valid: false,
      reason: `${docId}: cannot transition to terminal status — the following sections still contain "(pending)": ${pendingSections.join(', ')}. Complete these sections before marking done.`,
    };
  }

  return { valid: true, reason: '' };
}

// --- Trigger 2: Bypass 5 defense ---

/**
 * Check if creating a new plan/ticket during regressing cycle > 1.
 * If so, verify previous cycle's tickets reached terminal status.
 * Returns {shouldBlock, reason} or null if N/A.
 */
function checkRegressingCycleGuard(filePath, projectDir) {
  const normalized = normalizePath(filePath);

  // Only triggers on plan/ticket documents (not INDEX.md)
  const isPlanDoc = PLAN_DOC_PATTERN.test(normalized) && !/INDEX\.md$/i.test(normalized);
  const isTicketDoc = TICKET_DOC_PATTERN.test(normalized) && !/INDEX\.md$/i.test(normalized);
  if (!isPlanDoc && !isTicketDoc) return null;

  // Check regressing state
  const { STORAGE_ROOT, REGRESSING_STATE_FILE } = require('./constants');
  const statePath = path.join(projectDir, STORAGE_ROOT, 'memory', REGRESSING_STATE_FILE);
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }

  if (!state || state.active !== true) return null;
  const cycle = state.cycle || 1;
  if (cycle <= 1) return null;

  // Need prevPlanId to find previous cycle's tickets
  const prevPlanId = state.prevPlanId;
  if (!prevPlanId) return null;

  // Read ticket INDEX.md
  const ticketIndexPath = path.join(projectDir, STORAGE_ROOT, 'ticket', 'INDEX.md');
  let ticketIndex;
  try {
    ticketIndex = fs.readFileSync(ticketIndexPath, 'utf8');
  } catch {
    return null; // Can't read — fail-open
  }

  const rows = ticketIndex.split('\n').filter(r => r.trim().startsWith('|'));
  const incomplete = [];

  for (const row of rows) {
    const id = extractIdFromRow(row);
    const status = extractStatusFromRow(row);
    if (!id || !status) continue;

    // Check Plan column (cells[5] after split by |)
    const cells = row.split('|').map(c => c.trim());
    const planCol = cells.length >= 6 ? cells[5] : '';

    if (planCol === prevPlanId && !['done', 'verified', 'concluded', 'abandoned'].includes(status)) {
      incomplete.push({ id, status });
    }
  }

  if (incomplete.length > 0) {
    const details = incomplete.map(t => `${t.id}(${t.status})`).join(', ');
    return {
      shouldBlock: true,
      reason: `Regressing cycle ${cycle}: previous plan ${prevPlanId} has incomplete tickets: ${details}. Update their status in INDEX.md before creating new cycle documents.`,
    };
  }

  return null;
}

// --- Main ---

async function main() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') { process.exit(0); return; }

  const input = hookData.tool_input;
  if (!input) { process.exit(0); return; }

  const filePath = normalizePath(input.file_path || input.path || '');
  if (!filePath) { process.exit(0); return; }

  const projectDir = getProjectDir();

  // === Trigger 1: Edit or Write on INDEX.md — status change to terminal ===
  const indexMatch = filePath.match(INDEX_PATTERN);
  if (indexMatch) {
    const category = indexMatch[1]; // discussion|plan|ticket|investigation

    let changes = [];
    if (toolName === 'Edit') {
      changes = detectStatusChanges(input.old_string || '', input.new_string || '');
    } else if (toolName === 'Write') {
      changes = detectStatusChangesWrite(filePath, input.content || '');
    }

    // Filter to non-exempt terminal transitions
    const terminalChanges = changes.filter(c =>
      TERMINAL_STATUSES.has(c.toStatus) && !isExemptTransition(c.fromStatus, c.toStatus)
    );

    for (const change of terminalChanges) {
      const docFile = findDocumentFile(projectDir, category, change.docId);

      if (!docFile) {
        // EC-7: Orphaned INDEX entry (document file missing) → fail-open with warning
        process.stderr.write(`[LOG_GUARD] Warning: document file not found for ${change.docId} in ${category}/ — fail-open\n`);
        continue;
      }

      let content;
      try {
        content = fs.readFileSync(docFile, 'utf8');
      } catch (e) {
        const output = {
          decision: 'block',
          reason: `[LOG_GUARD] Cannot read ${change.docId} document: ${e.message}.`,
        };
        process.stderr.write(`[LOG_GUARD] Blocked: cannot read ${docFile}\n`);
        console.log(JSON.stringify(output));
        process.exit(2);
        return;
      }

      const entries = parseLogEntries(content);
      const validation = validateLogForTerminal(entries, change.toStatus, change.docId);

      if (!validation.valid) {
        const output = {
          decision: 'block',
          reason: `[LOG_GUARD] ${validation.reason}`,
        };
        process.stderr.write(`[LOG_GUARD] Blocked: ${change.docId} ${change.fromStatus}→${change.toStatus}\n`);
        console.log(JSON.stringify(output));
        process.exit(2);
        return;
      }

      // Pending section check: tickets must not have "(pending)" in result sections
      const pendingValidation = validatePendingSections(content, change.docId);
      if (!pendingValidation.valid) {
        const output = {
          decision: 'block',
          reason: `[LOG_GUARD] ${pendingValidation.reason}`,
        };
        process.stderr.write(`[LOG_GUARD] Blocked: ${change.docId} has pending sections\n`);
        console.log(JSON.stringify(output));
        process.exit(2);
        return;
      }
    }

    // All terminal transitions validated
    if (terminalChanges.length > 0) {
      process.stderr.write(`[LOG_GUARD] Allowed ${terminalChanges.length} terminal transition(s)\n`);
    }
    process.exit(0);
    return;
  }

  // === Trigger 2: Bypass 5 — new plan/ticket in regressing cycle > 1 ===
  const cycleCheck = checkRegressingCycleGuard(filePath, projectDir);
  if (cycleCheck && cycleCheck.shouldBlock) {
    const output = {
      decision: 'block',
      reason: `[LOG_GUARD] ${cycleCheck.reason}`,
    };
    process.stderr.write(`[LOG_GUARD] Blocked new doc creation: ${cycleCheck.reason}\n`);
    console.log(JSON.stringify(output));
    process.exit(2);
    return;
  }

  // Neither trigger matched — allow
  process.exit(0);
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
  extractStatusFromRow,
  extractIdFromRow,
  detectStatusChanges,
  detectStatusChangesWrite,
  isExemptTransition,
  findDocumentFile,
  parseLogEntries,
  isCreatedEntry,
  isStatusChangeEntry,
  validateLogForTerminal,
  validatePendingSections,
  checkRegressingCycleGuard,
  ALL_STATUSES,
  TERMINAL_STATUSES,
  MIN_ENTRY_BODY_LENGTH,
  INDEX_PATTERN,
  PLAN_DOC_PATTERN,
  TICKET_DOC_PATTERN,
};
