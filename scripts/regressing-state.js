const path = require('path');
const { getProjectDir, getStorageRoot, readJsonOrDefault, writeJson } = require('./utils');
const { REGRESSING_STATE_FILE, REGRESSING_STALE_MS } = require('./constants');

// True when a regressing state last updated at lastUpdatedAt is older than
// REGRESSING_STALE_MS. A missing or unreadable time returns `unknown`: each caller
// keeps its own answer for that case.
function isRegressingStale(lastUpdatedAt, { now = Date.now(), unknown = false } = {}) {
  const updated = lastUpdatedAt ? new Date(lastUpdatedAt).getTime() : NaN;
  if (!Number.isFinite(updated)) return unknown;
  return now - updated > REGRESSING_STALE_MS;
}

/**
 * Reads .crabshell/memory/regressing-state.json and returns parsed state.
 * Returns null if file doesn't exist, active !== true, or required fields missing.
 */
function getRegressingState(projectDir) {
  const statePath = path.join(getStorageRoot(projectDir), 'memory', REGRESSING_STATE_FILE);
  const state = readJsonOrDefault(statePath, null);
  if (!state) return null;
  if (state.active !== true) return null;
  // Validate required fields
  if (!state.phase || !state.cycle || !state.totalCycles) return null;
  return state;
}

/**
 * Builds a phase-specific reminder message for active regressing sessions.
 * Returns '' if no active session.
 */
function buildRegressingReminder(projectDir) {
  const state = getRegressingState(projectDir);
  if (!state) return '';

  // Backward compat: convert old singular ticketId to ticketIds array
  if (state.ticketId && !state.ticketIds) {
    state.ticketIds = [state.ticketId];
  }
  const { phase, cycle, totalCycles, discussion, planId, ticketIds, lastUpdatedAt } = state;
  let message = '';

  switch (phase) {
    case 'discussing':
      message = `\n## REGRESSING ACTIVE — Phase: Discussion Setup (Cycle ${cycle} (cap: ${totalCycles}))\n\nCreate/confirm the Discussion document using Skill tool: skill="crabshell:discussing"\n`;
      break;

    case 'planning':
      message = `\n## REGRESSING ACTIVE — Phase: Planning (Cycle ${cycle} (cap: ${totalCycles}), ${discussion})\n\n` +
        `\u26A0 MANDATORY SKILL TOOL CALL REQUIRED.\n` +
        `Write this cycle's plan as a "Cycle ${cycle} plan" entry in ${discussion}: Skill tool \u2192 skill="crabshell:discussing" with args "${discussion}".\n` +
        `- The entry needs Intent, Context, Scope, Steps, Analysis and Intent Check.\n` +
        `- Sessions that still use a plan document invoke skill="crabshell:planning" instead.\n` +
        `- Phase advances to ticketing when that skill call is made.\n`;
      break;

    case 'ticketing':
      message = `\n## REGRESSING ACTIVE — Phase: Ticketing (Cycle ${cycle} (cap: ${totalCycles}), ${discussion}${planId ? `, Plan: ${planId}` : ''})\n\n` +
        `\u26A0 MANDATORY SKILL TOOL CALL REQUIRED.\n` +
        `You MUST invoke the Skill tool with skill="crabshell:ticketing" to create this cycle's tickets under ${planId || discussion}.\n` +
        `- DO NOT write ticket documents directly. DO NOT execute work without a ticket.\n` +
        `- The ONLY acceptable action is: Skill tool \u2192 skill="crabshell:ticketing"\n` +
        `- Phase will not advance until /ticketing is invoked via Skill tool.\n`;
      break;

    case 'execution': {
      const ticketList = (ticketIds && ticketIds.length > 0) ? ticketIds.join(', ') : '(none assigned)';
      message = `\n## REGRESSING ACTIVE — Phase: Execution (Cycle ${cycle} (cap: ${totalCycles}), ${discussion}, Tickets: ${ticketList})\n\n` +
        `Executing tickets: ${ticketList}. Follow each ticket's agent structure (Work Agent \u2192 Review Agent \u2192 Orchestrator).\n`;
      break;
    }

    case 'feedback': {
      const ticketListFb = (ticketIds && ticketIds.length > 0) ? ticketIds.join(', ') : '(none)';
      message = `\n## REGRESSING ACTIVE — Phase: Feedback Transfer (Cycle ${cycle} (cap: ${totalCycles}), ${discussion})\n\n` +
        `Synthesize Final Verification > Next Direction from all tickets (${ticketListFb}) and transfer to next cycle's planning context.\n`;
      break;
    }

    default:
      return '';
  }

  // Staleness warning if lastUpdatedAt > 24 hours old
  if (isRegressingStale(lastUpdatedAt)) {
    message += `\n\u26A0 WARNING: Regressing state may be stale (last updated: ${lastUpdatedAt}). Verify with user before continuing.\n`;
  }

  return message;
}

/**
 * Detect if a PostToolUse hookData represents a regressing-relevant Skill call.
 * @param {object} hookData - PostToolUse hook data
 * @returns {string|null} - normalized skill name of a document type flagged
 *   `regressing` in constants DOC_TYPES, or null
 */
function detectRegressingSkillCall(hookData) {
  return require('./core/skill-flag').detectRegressingSkillCall(hookData);
}

/**
 * Auto-advance regressing phase based on detected skill call.
 * Only advances if detectedSkill matches current phase.
 * @param {string} detectedSkill - 'planning', 'ticketing', or 'discussing'
 * @param {string} projectDir
 * @returns {string|null} - new phase if advanced, null otherwise
 */
function advancePhase(detectedSkill, projectDir, sessionId, skillArgs) {
  const statePath = path.join(getStorageRoot(projectDir), 'memory', REGRESSING_STATE_FILE);
  const state = readJsonOrDefault(statePath, null);
  if (!state || state.active !== true) return null;

  // Another session may be using a document skill for unrelated work (a one-pass
  // record, another discussion's ticket): only a call whose arguments name this
  // workflow's discussion or plan counts, for ownership and phase. D001_T001 names
  // D001; D0012 does not. (The initial discussing phase runs before the discussion
  // has an ID.)
  const workflowIds = [state.discussion, state.planId].filter(Boolean);
  if (state.phase !== 'discussing' && workflowIds.length
      && !new RegExp(`\\b(?:${workflowIds.join('|')})(?!\\d)`).test(String(skillArgs || ''))) return null;

  // The session that runs the workflow's skills owns it (it moves after /clear or
  // a relaunch as soon as the continuing session invokes the next skill).
  if (sessionId && state.sessionId !== sessionId) {
    state.sessionId = sessionId;
    state.lastUpdatedAt = new Date().toISOString();
    writeJson(statePath, state);
  }

  // Transitions: discussing->planning, planning->ticketing, ticketing->execution.
  // A discussion-based cycle writes its plan into the discussion (/discussing), so
  // /discussing ends the planning phase too; /planning still does for plan documents.
  const next = { discussing: 'planning', planning: 'ticketing', ticketing: 'execution' };
  const endsPhase = detectedSkill === state.phase || (state.phase === 'planning' && detectedSkill === 'discussing');
  if (!endsPhase) return null;

  const newPhase = next[state.phase];

  state.phase = newPhase;
  state.lastUpdatedAt = new Date().toISOString();
  writeJson(statePath, state);
  return newPhase;
}

module.exports = { getRegressingState, buildRegressingReminder, detectRegressingSkillCall, advancePhase, isRegressingStale };
