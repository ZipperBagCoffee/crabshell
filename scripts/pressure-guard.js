'use strict';

const path = require('path');
const fs = require('fs');
const { readStdin } = require('./transcript-utils');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

const BLOCKED_TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit'];

const L2_MESSAGE = '[PRESSURE L2] Tool use paused. Complete the problem analysis in your response first. Tip: "봉인해제" or "UNLEASH" to reset.';

const L3_MESSAGE = '[PRESSURE L3] All tools locked. Complete the structured self-diagnosis in your response first. Tip: "봉인해제" or "UNLEASH" to reset.';

function checkCrabshellException(toolName, input) {
  if (toolName === 'Bash') {
    const cmd = (input.command || '');
    return /\.crabshell\//.test(cmd) || /\.claude\//.test(cmd);
  } else {
    // Read, Grep, Glob, Write, Edit — check file_path or path
    const filePath = (input.file_path || input.path || '').replace(/\\/g, '/');
    return /\/\.crabshell\//.test(filePath) || /\/\.claude\//.test(filePath);
  }
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || !hookData.tool_name) { process.exit(0); return; }

  const toolName = hookData.tool_name;
  const input = hookData.tool_input || {};

  const projectDir = getProjectDir();
  const { STORAGE_ROOT } = require('./constants');
  const indexPath = path.join(projectDir, STORAGE_ROOT, 'memory', 'memory-index.json');

  // Step 1: Read index, get fp.level
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    process.exit(0); return; // No index file = fail-open
  }

  const fp = index.feedbackPressure;

  // Step 2: if level < 2, exit(0) — no blocking below L2
  if (!fp || fp.level < 2) { process.exit(0); return; }

  const level = fp.level;

  // Step 4: if level >= 3 (L3 FULL LOCKDOWN)
  if (level >= 3) {
    // Check .crabshell/.claude/ exception for file tools
    if (BLOCKED_TOOLS.includes(toolName) && checkCrabshellException(toolName, input)) {
      process.exit(0); return;
    }
    // Block ALL tools with L3 message
    const output = { decision: 'block', reason: L3_MESSAGE };
    console.log(JSON.stringify(output));
    process.exit(2);
    return;
  }

  // Step 5: if level === 2 (L2 PARTIAL BLOCK)
  if (level === 2) {
    // If tool NOT in BLOCKED_TOOLS → exit(0) allow
    if (!BLOCKED_TOOLS.includes(toolName)) { process.exit(0); return; }

    // Check .crabshell/.claude/ path exception
    if (checkCrabshellException(toolName, input)) {
      process.exit(0); return;
    }

    // Block with L2 message
    const output = { decision: 'block', reason: L2_MESSAGE };
    console.log(JSON.stringify(output));
    process.exit(2);
    return;
  }
}

main().catch(e => {
  console.error(`[PRESSURE GUARD ERROR] ${e.message}`);
  process.exit(0); // fail-open
});
