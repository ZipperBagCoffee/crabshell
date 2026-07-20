'use strict';

const { COMPRESSED_CHECKLIST, readProjectConcept } = require('../shared-context');

const FIRST_TURN_RULES = `
## Crabshell Turn Contract

- Follow the latest user request and correction; do not resume older work unless the user asks.
- A question authorizes an answer and relevant read-only inspection, not edits, installs, commits, pushes, or prior-task continuation.
- Preserve every requested host, item, quantity, and named reference. Do not silently narrow Claude Code + Codex to one host.
- Open named references before changing code and trace source input to the observable result.
- Claim completion only from direct current execution evidence. A worker claim, file grep, test count, or installation state alone is not behavioral proof.
- The parent owns scope, destructive-action confirmation, final diff review, and the completion decision.
${COMPRESSED_CHECKLIST}`;

function getTimezoneOffset() {
  const offsetMinutes = new Date().getTimezoneOffset();
  const sign = offsetMinutes <= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `${sign}${hours}${minutes}`;
}

function buildFirstTurnContext(projectDir) {
  const nodePath = process.execPath.replace(/\\/g, '/');
  const projectConcept = readProjectConcept(projectDir);
  let context = FIRST_TURN_RULES;
  if (projectConcept) context += `\n## Project Concept\n${projectConcept}\n`;
  context += `\n## Node.js Path\nWhen running Node.js commands, use this runtime path when bare \`node\` is unavailable:\n\`${nodePath}\`\n`;
  context += `\n## Project Root Anchor\nProject root: \`${projectDir}\`\n`;
  context += `\n## Timezone\nTZ_OFFSET: ${getTimezoneOffset()}\n`;
  return context;
}

function createContextOutput(eventName, context) {
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: context,
    },
  };
}

function validateContextOutput(output, eventName = 'UserPromptSubmit') {
  const specific = output && output.hookSpecificOutput;
  if (!specific || specific.hookEventName !== eventName) {
    throw new Error(`Expected ${eventName} hook output.`);
  }
  if (typeof specific.additionalContext !== 'string' || !specific.additionalContext.includes('## Crabshell Turn Contract')) {
    throw new Error('Hook output is missing the shared Crabshell turn contract.');
  }
  return true;
}

module.exports = {
  FIRST_TURN_RULES,
  buildFirstTurnContext,
  createContextOutput,
  getTimezoneOffset,
  validateContextOutput,
};
