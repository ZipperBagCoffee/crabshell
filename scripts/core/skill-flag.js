'use strict';
// The document-skill flag: which document skill a session has loaded. The skill
// tracker sets it, the docs guard reads it, and it is cleared when the full skill
// instructions may no longer be in context: at session end, and at compaction
// (Claude Code re-attaches only the first 5,000 tokens of each invoked skill, and
// older skills can be dropped). This module has no load-time side effects, so any
// hook can require it.
const fs = require('fs');
const path = require('path');
const { STORAGE_ROOT, MEMORY_DIR, SESSION_STATE_DIR, SKILL_ACTIVE_FILE, SKILL_ACTIVE_TTL_MS, DOC_SKILLS, DOC_TYPES } = require('../constants');
const { writeJson } = require('../utils');
const { readSessionState, writeSessionState, removeSessionState, sessionKey } = require('./session-state');

const STATE_NAME = path.basename(SKILL_ACTIVE_FILE, '.json');
const REGRESSING_SKILLS = DOC_TYPES.filter(type => type.regressing).map(type => type.skill);
const legacyFlagPath = projectDir => path.join(projectDir, STORAGE_ROOT, MEMORY_DIR, SKILL_ACTIVE_FILE);

// The skill a Skill tool call invokes, without its plugin prefix
// ("crabshell:planning" -> "planning"), or null for any other call.
function skillCallName(hookData) {
  if (!hookData || hookData.tool_name !== 'Skill') return null;
  const skill = hookData.tool_input && typeof hookData.tool_input === 'object' ? hookData.tool_input.skill : null;
  if (typeof skill !== 'string') return null;
  return skill.includes(':') ? skill.split(':').pop() : skill;
}

// A document skill call (constants DOC_SKILLS), or null.
function detectDocsSkillCall(hookData) {
  const name = skillCallName(hookData);
  return name && DOC_SKILLS.includes(name) ? name : null;
}

// A skill call that advances the regressing phase, or null.
function detectRegressingSkillCall(hookData) {
  const name = skillCallName(hookData);
  return name && REGRESSING_SKILLS.includes(name) ? name : null;
}

/**
 * Set the flag. With a session id it is that session's own flag
 * (session-state/<sid8>/skill-active.json), valid until the session compacts or
 * ends; without one, the legacy project-wide flag file with a time limit.
 */
function setSkillActive(projectDir, skill, sessionId) {
  const data = { skill, activatedAt: new Date().toISOString() };
  if (writeSessionState(projectDir, sessionId, STATE_NAME, data)) return;
  writeJson(legacyFlagPath(projectDir), { ...data, ttl: SKILL_ACTIVE_TTL_MS });
}

/**
 * The active document skill for this session, or null. Another session's flag
 * never counts. Payloads without a session id use the legacy flag, which is
 * removed once its time limit has passed.
 */
function getActiveSkill(projectDir, sessionId) {
  if (sessionKey(sessionId)) {
    const data = readSessionState(projectDir, sessionId, STATE_NAME, null);
    return data && DOC_SKILLS.includes(data.skill) ? data.skill : null;
  }
  const flagPath = legacyFlagPath(projectDir);
  try {
    if (!fs.existsSync(flagPath)) return null;
    const data = JSON.parse(fs.readFileSync(flagPath, 'utf8'));
    if (!data || !data.skill || !data.activatedAt) return null;
    const elapsed = Date.now() - new Date(data.activatedAt).getTime();
    if (elapsed > (data.ttl || SKILL_ACTIVE_TTL_MS)) {
      try { fs.unlinkSync(flagPath); } catch {}
      return null;
    }
    return DOC_SKILLS.includes(data.skill) ? data.skill : null;
  } catch {
    return null;
  }
}

// Drop this session's flag (its skill instructions left the context).
function clearSkillActive(projectDir, sessionId) {
  return removeSessionState(projectDir, sessionId, STATE_NAME);
}

// Remove the legacy project-wide flag; true when a file was removed. Errors
// propagate so the caller can report them.
function clearLegacySkillFlag(projectDir) {
  const flagPath = legacyFlagPath(projectDir);
  if (!fs.existsSync(flagPath)) return false;
  fs.unlinkSync(flagPath);
  return true;
}

// True for either flag file (forward-slash path): hooks own them, so a direct
// Write/Edit is refused.
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SESSION_FLAG_PATTERN = new RegExp(`${escape(MEMORY_DIR)}\\/${escape(SESSION_STATE_DIR)}\\/[^/]+\\/${escape(SKILL_ACTIVE_FILE)}$`);
function isSkillFlagPath(filePath) {
  return filePath.endsWith(`${MEMORY_DIR}/${SKILL_ACTIVE_FILE}`) || SESSION_FLAG_PATTERN.test(filePath);
}

module.exports = {
  skillCallName,
  detectDocsSkillCall,
  detectRegressingSkillCall,
  setSkillActive,
  getActiveSkill,
  clearSkillActive,
  clearLegacySkillFlag,
  isSkillFlagPath,
};
