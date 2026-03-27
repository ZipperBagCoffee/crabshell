const path = require('path');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');
const { REGRESSING_STATE_FILE } = require('./constants');

/**
 * Reads .claude/memory/regressing-state.json and returns parsed state.
 * Returns null if file doesn't exist, active !== true, or required fields missing.
 */
function getRegressingState(projectDir) {
  const statePath = path.join(projectDir, '.claude', 'memory', REGRESSING_STATE_FILE);
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
      message = `\n## REGRESSING ACTIVE — Phase: Discussion Setup (Cycle ${cycle} (cap: ${totalCycles}))\n\nCreate/confirm the Discussion document using Skill tool: skill="memory-keeper:discussing"\n`;
      break;

    case 'planning':
      message = `\n## REGRESSING ACTIVE — Phase: Planning (Cycle ${cycle} (cap: ${totalCycles}), ${discussion})\n\n` +
        `\u26A0 MANDATORY SKILL TOOL CALL REQUIRED.\n` +
        `You MUST invoke the Skill tool with skill="memory-keeper:planning" to create this cycle's plan.\n` +
        `- DO NOT write plan documents directly. DO NOT formulate plans inline.\n` +
        `- The ONLY acceptable action is: Skill tool \u2192 skill="memory-keeper:planning"\n` +
        `- Phase will not advance until /planning is invoked via Skill tool.\n`;
      break;

    case 'ticketing':
      message = `\n## REGRESSING ACTIVE — Phase: Ticketing (Cycle ${cycle} (cap: ${totalCycles}), ${discussion}, Plan: ${planId})\n\n` +
        `\u26A0 MANDATORY SKILL TOOL CALL REQUIRED.\n` +
        `You MUST invoke the Skill tool with skill="memory-keeper:ticketing" to create this cycle's ticket from ${planId}.\n` +
        `- DO NOT write ticket documents directly. DO NOT execute work without a ticket.\n` +
        `- The ONLY acceptable action is: Skill tool \u2192 skill="memory-keeper:ticketing"\n` +
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
  if (lastUpdatedAt) {
    const updatedTime = new Date(lastUpdatedAt).getTime();
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    if (!isNaN(updatedTime) && (now - updatedTime) > twentyFourHours) {
      message += `\n\u26A0 WARNING: Regressing state may be stale (last updated: ${lastUpdatedAt}). Verify with user before continuing.\n`;
    }
  }

  return message;
}

/**
 * Detect if a PostToolUse hookData represents a regressing-relevant Skill call.
 * @param {object} hookData - PostToolUse hook data
 * @returns {string|null} - normalized skill name ('planning', 'ticketing', 'discussing') or null
 */
function detectRegressingSkillCall(hookData) {
  if (!hookData || hookData.tool_name !== 'Skill') return null;
  const input = hookData.tool_input;
  if (!input || typeof input !== 'object') return null;
  const skill = input.skill;
  if (typeof skill !== 'string') return null;
  // Handle both "planning" and "memory-keeper:planning"
  const skillName = skill.includes(':') ? skill.split(':').pop() : skill;
  if (['planning', 'ticketing', 'discussing'].includes(skillName)) return skillName;
  return null;
}

/**
 * Auto-advance regressing phase based on detected skill call.
 * Only advances if detectedSkill matches current phase.
 * @param {string} detectedSkill - 'planning', 'ticketing', or 'discussing'
 * @param {string} projectDir
 * @returns {string|null} - new phase if advanced, null otherwise
 */
function advancePhase(detectedSkill, projectDir) {
  const statePath = path.join(projectDir, '.claude', 'memory', REGRESSING_STATE_FILE);
  const state = readJsonOrDefault(statePath, null);
  if (!state || state.active !== true) return null;

  // Transitions: discussing->planning, planning->ticketing, ticketing->execution
  const transitions = {
    discussing: 'planning',
    planning: 'ticketing',
    ticketing: 'execution'
  };

  // Only advance if detectedSkill matches current phase
  if (state.phase !== detectedSkill) return null;

  const newPhase = transitions[detectedSkill];
  if (!newPhase) return null;

  state.phase = newPhase;
  state.lastUpdatedAt = new Date().toISOString();
  writeJson(statePath, state);
  return newPhase;
}

module.exports = { getRegressingState, buildRegressingReminder, detectRegressingSkillCall, advancePhase };
