'use strict';

// The prompt reminder for an active regressing workflow: what its current phase asks for.

const { getRegressingState, isRegressingStale } = require('../regressing-state');

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

module.exports = { buildRegressingReminder };
