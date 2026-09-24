'use strict';

const path = require('path');
const fs = require('fs');
const { SKILL_ACTIVE_FILE } = require('./constants');
const { readStdin } = require('./transcript-utils');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir } = require('./utils');

// Skills that legitimately create/modify .crabshell/ D/P/T/I/H files
const DOCS_SKILLS = [
  'discussing', 'planning', 'ticketing', 'investigating',
  'regressing', 'verifying', 'hotfix'
];


/**
 * Detect if hookData represents a docs-relevant Skill call.
 * Handles both "planning" and "crabshell:planning" formats.
 * Returns normalized skill name or null.
 */
function detectDocsSkillCall(hookData) {
  if (!hookData || hookData.tool_name !== 'Skill') return null;
  const input = hookData.tool_input;
  if (!input || typeof input !== 'object') return null;
  const skill = input.skill;
  if (typeof skill !== 'string') return null;

  // Handle both "planning" and "crabshell:planning"
  const skillName = skill.includes(':') ? skill.split(':').pop() : skill;
  if (DOCS_SKILLS.includes(skillName)) return skillName;
  return null;
}

/**
 * Set the skill-active flag. With a session id it is that session's own flag
 * (session-state/<sid8>/skill-active.json), valid until the session compacts or
 * ends; without one, the legacy project-wide flag file.
 */
function setSkillActive(projectDir, skillName, sessionId) {
  const data = { skill: skillName, activatedAt: new Date().toISOString() };
  const { writeSessionState } = require('./core/session-state');
  if (writeSessionState(projectDir, sessionId, 'skill-active', data)) return;
  const { STORAGE_ROOT } = require('./constants');
  const memoryDir = path.join(projectDir, STORAGE_ROOT, 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  fs.writeFileSync(path.join(memoryDir, SKILL_ACTIVE_FILE), JSON.stringify({ ...data, ttl: 15 * 60 * 1000 }, null, 2));
}

// PostToolUse on Skill: mark a document skill active. Returns a diagnostic or null.
function trackSkill(hookData, projectDir) {
  const detectedSkill = detectDocsSkillCall(hookData);
  if (!detectedSkill) return null;
  setSkillActive(projectDir, detectedSkill, hookData.session_id);
  return `[SKILL_TRACKER] Activated: ${detectedSkill}`;
}

async function main() {
  const hookData = await readStdin();
  const log = hookData ? trackSkill(hookData, getProjectDir()) : null;
  if (log) process.stderr.write(log + '\n');
  process.exit(0);
}

if (require.main === module) {
  main().catch(e => {
    console.error(`[SKILL TRACKER ERROR] ${e.message}`);
    process.exit(0); // fail-open
  });
}

module.exports = { trackSkill, detectDocsSkillCall };
