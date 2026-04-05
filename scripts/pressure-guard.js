'use strict';

const path = require('path');
const fs = require('fs');
const { readStdin } = require('./transcript-utils');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  const BLOCKED_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'];
  if (!BLOCKED_TOOLS.includes(toolName)) { process.exit(0); return; }

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

  // Level 3: block all 6 tools except for .crabshell/.claude/ paths
  if (toolName === 'Bash') {
    // For Bash, check if the command references .crabshell/ or .claude/ (allow if it does)
    const cmd = (input.command || '');
    if (/\.crabshell\//.test(cmd) || /\.claude\//.test(cmd)) {
      process.exit(0);
      return;
    }
  } else {
    // For Read/Grep/Glob/Write/Edit, check file_path or path
    const filePath = (input.file_path || input.path || '').replace(/\\/g, '/');
    if (/\/\.crabshell\//.test(filePath) || /\/\.claude\//.test(filePath)) {
      process.exit(0);
      return;
    }
  }

  // Block at pressure level 3
  const output = {
    decision: "block",
    reason: '[PRESSURE L3] Tool use blocked — 3+ consecutive negative feedbacks detected. This situation benefits from expert-level re-analysis. Use TaskCreate to delegate the current task to a sub-agent with fresh perspective. TaskCreate resets pressure to Level 0 and unblocks all tools.'
  };
  console.log(JSON.stringify(output));
  process.exit(2);
}

main().catch(e => {
  console.error(`[PRESSURE GUARD ERROR] ${e.message}`);
  process.exit(0); // fail-open
});
