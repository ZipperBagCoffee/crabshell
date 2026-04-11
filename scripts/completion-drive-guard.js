'use strict';

const fs = require('fs');
const path = require('path');
const { readStdin } = require('./transcript-utils');
const { STORAGE_ROOT } = require('./constants');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

/**
 * Check if regressing workflow is currently active.
 * Returns true if regressing-state.json exists and has active: true.
 * Fail-open: returns false on any error.
 */
function isRegressingActive() {
  try {
    const statePath = path.join(getProjectDir(), STORAGE_ROOT, 'memory', 'regressing-state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return state && state.active === true;
  } catch {
    return false; // No state file or parse error = not active
  }
}

/**
 * Strip protected zones where completion-drive patterns should be ignored:
 * code blocks, indented code blocks, inline code, blockquotes.
 */
function stripProtectedZones(text) {
  let stripped = text;
  stripped = stripped.replace(/```[\s\S]*?```/g, ' ');     // fenced code blocks
  stripped = stripped.replace(/^(?:    |\t).+$/gm, ' ');   // indented code
  stripped = stripped.replace(/`[^`]+`/g, ' ');             // inline code
  stripped = stripped.replace(/^>\s*.+$/gm, ' ');           // blockquotes
  stripped = stripped.replace(/"[^"\n]{1,80}"/g, ' ');      // double-quoted strings (short)
  stripped = stripped.replace(/'[^'\n]{1,80}'/g, ' ');      // single-quoted strings (short)
  return stripped;
}

// Completion-drive patterns: autonomous forward motion without user instruction
const COMPLETION_DRIVE_PATTERNS = [
  // Korean
  /진행합니다/,
  /시작합니다/,
  /시작하겠습니다/,
  /진행하겠습니다/,
  /계속\s*진행하겠습니다/,
  /계속\s*진행합니다/,
  /바로\s*시작하겠습니다/,
  /바로\s*진행하겠습니다/,
  /먼저\s*진행하겠습니다/,
  /이제\s*진행하겠습니다/,
  /이제\s*시작하겠습니다/,
  /작업을?\s*시작하겠습니다/,
  /작업을?\s*진행하겠습니다/,
  // English
  /\bI will proceed\b/i,
  /\bproceeding with\b/i,
  /\bI'?ll start\b/i,
  /\bI'?ll proceed\b/i,
  /\blet me proceed\b/i,
  /\bI will now\b/i,
  /\bI'?ll now\b/i,
  /\bmoving forward\b/i,
  /\bgoing ahead\b/i,
];

// Exemption: response references a user instruction
const USER_INSTRUCTION_PATTERNS = [
  /user\s+(asked|requested|said|told|wants)/i,
  /사용자(가|께서|님이)\s*(요청|지시|말씀)/,
];

/**
 * Check if text contains a reference to a user instruction.
 * Returns true if any exemption pattern matches.
 */
function hasUserInstructionReference(text) {
  for (const pattern of USER_INSTRUCTION_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  // Blockquote presence (direct user quote)
  if (/^>\s+/m.test(text)) return true;
  return false;
}

/**
 * Check response for completion-drive patterns.
 * Returns the matched pattern string, or null if clean.
 */
function checkCompletionDrive(response) {
  if (!response) return null;

  // Short response exemption: ≤30 chars is too brief for meaningful completion-drive
  if (response.length <= 30) return null;

  // Strip protected zones before pattern matching
  const stripped = stripProtectedZones(response);

  // Check user instruction exemption first
  if (hasUserInstructionReference(stripped)) return null;

  // Match against completion-drive patterns
  for (const pattern of COMPLETION_DRIVE_PATTERNS) {
    const match = stripped.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || Object.keys(hookData).length === 0) process.exit(0); // fail-open: no data

  // Prevent infinite loop: exit if this is a continuation from a previous stop hook block
  if (hookData.stop_hook_active) process.exit(0);

  // Block if regressing workflow is active: force autonomous continuation
  if (isRegressingActive()) {
    const output = {
      decision: 'block',
      reason: 'Regressing active — do not stop. Save any questions to the active T document\'s Open Questions section, make a reasonable assumption, and continue autonomous execution. Do not wait for user input.'
    };
    process.stderr.write('[COMPLETION_DRIVE_GUARD] Blocked: regressing active — forcing continuation\n');
    console.log(JSON.stringify(output));
    process.exit(2);
  }

  const response = hookData.stop_response || hookData.last_assistant_message || '';
  if (!response) process.exit(0);

  const matchedPattern = checkCompletionDrive(response);
  if (!matchedPattern) process.exit(0); // clean

  // Completion drive detected → block and prompt self-check
  const output = {
    decision: 'block',
    reason: `Completion drive detected: '${matchedPattern}'.\nSelf-check required:\n(1) Was this action explicitly requested by the user, or is this model-initiated forward motion?\n(2) If user-requested: cite the specific user instruction.\n(3) If model-initiated: stop, state what you were about to do and why it aligns with user intent.`
  };

  process.stderr.write(`[COMPLETION_DRIVE_GUARD] Blocked: pattern '${matchedPattern}'\n`);
  console.log(JSON.stringify(output));
  process.exit(2);
}

if (require.main === module) {
  main().catch(() => process.exit(0)); // fail-open on any error
} else {
  // Export for unit testing
  module.exports = { checkCompletionDrive, isRegressingActive, stripProtectedZones, hasUserInstructionReference };
}
