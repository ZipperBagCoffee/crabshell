'use strict';

const { COMPRESSED_CHECKLIST, readProjectConcept } = require('../shared-context');

const FIRST_TURN_RULES = `
## Crabshell Turn Contract

- Follow the latest user request and correction; a question authorizes an answer and read-only inspection, not edits or resuming older work.
- Open named references before changing code; preserve every requested item, quantity, host, and named reference.
- The parent owns scope, the final diff, and the completion decision — a worker's done/PASS claim is not completion evidence.
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
