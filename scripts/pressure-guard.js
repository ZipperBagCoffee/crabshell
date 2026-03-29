'use strict';

const path = require('path');
const fs = require('fs');
const { readStdin } = require('./transcript-utils');

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') { process.exit(0); return; }

  const input = hookData.tool_input;
  if (!input) { process.exit(0); return; }

  const projectDir = getProjectDir();
  const { STORAGE_ROOT } = require('./constants');
  const indexPath = path.join(projectDir, STORAGE_ROOT, 'memory', 'memory-index.json');

  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    process.exit(0); return; // No index file = no pressure tracking
  }

  const fp = index.feedbackPressure;
  if (!fp || fp.level < 3) { process.exit(0); return; }

  // Level 3: block Write/Edit except for .crabshell/.claude/ paths
  const filePath = (input.file_path || input.path || '').replace(/\\/g, '/');

  // Allow .crabshell/.claude/ paths (internal plugin/document operations, D/P/T/I now under .crabshell/)
  if (/\/\.crabshell\//.test(filePath) || /\/\.claude\//.test(filePath)) {
    process.exit(0);
    return;
  }

  // Block all other Write/Edit at pressure level 3
  const output = {
    decision: "block",
    reason: '[PRESSURE L3] Write/Edit blocked — 3+ consecutive negative feedbacks detected. You MUST delegate work via TaskCreate first. This resets pressure to Level 0 and unblocks Write/Edit. See "CRITICAL: Task Delegation Required" in your context.'
  };
  console.log(JSON.stringify(output));
  process.exit(2);
}

main().catch(e => {
  console.error(`[PRESSURE GUARD ERROR] ${e.message}`);
  process.exit(0); // fail-open
});
