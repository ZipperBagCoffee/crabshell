'use strict';

// Moves a regressing workflow to its next phase when its document skill is called.

const path = require('path');
const { getStorageRoot, readJsonOrDefault, writeJson } = require('../utils');
const { REGRESSING_STATE_FILE } = require('../constants');

/**
 * Detect if a PostToolUse hookData represents a regressing-relevant Skill call.
 * @param {object} hookData - PostToolUse hook data
 * @returns {string|null} - normalized skill name of a document type flagged
 *   `regressing` in core/doc-types DOC_TYPES, or null
 */
function detectRegressingSkillCall(hookData) {
  return require('./skill-flag').detectRegressingSkillCall(hookData);
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

module.exports = { detectRegressingSkillCall, advancePhase };
