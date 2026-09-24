'use strict';

const { readStdin } = require('./transcript-utils');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

const { getProjectDir } = require('./utils');
const { detectDocsSkillCall, setSkillActive } = require('./core/skill-flag');

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
