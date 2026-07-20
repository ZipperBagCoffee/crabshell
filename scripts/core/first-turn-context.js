'use strict';

const { COMPRESSED_CHECKLIST, readProjectConcept } = require('../shared-context');

const RESPONSE_FIELDS = Object.freeze(['[의도]:', '[이해]:', '[설명]:']);

const RESPONSE_CONTRACT = `
## Mandatory Response Ending

End every user-facing response, including a short answer, with the exact three-field block below after the main answer body. Keep the fields in this order and use one short line per field. Summarize only; do not expose private chain-of-thought.

[의도]: Restate the user's request in one short line using the user's words.

[이해]: State your interpretation and any remaining gap in one short line; if none, write \`gap 없음\`.

[설명]: Give the answer in one short, concrete, easy-to-understand line using the user's words; do not default to analogy or caveman-style fragments.
`;

const FIRST_TURN_RULES = `
## Crabshell Turn Contract

- Follow the latest user request and correction; do not resume older work unless the user asks.
- A question authorizes an answer and relevant read-only inspection, not edits, installs, commits, pushes, or prior-task continuation.
- Preserve every requested host, item, quantity, and named reference. Do not silently narrow Claude Code + Codex to one host.
- Open named references before changing code and trace source input to the observable result.
- Claim completion only from direct current execution evidence. A worker claim, file grep, test count, or installation state alone is not behavioral proof.
- The parent owns scope, destructive-action confirmation, final diff review, and the completion decision.
${COMPRESSED_CHECKLIST}${RESPONSE_CONTRACT}`;

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
  validateResponseContract(specific.additionalContext);
  return true;
}

function validateResponseContract(context) {
  const heading = context.indexOf('## Mandatory Response Ending');
  if (heading === -1) throw new Error('Hook output is missing the mandatory response ending.');
  const contract = context.slice(heading);
  if (!/End every user-facing response, including a short answer/i.test(contract)) {
    throw new Error('Response contract is missing the every-response end-placement requirement.');
  }
  if (!/easy-to-understand line using the user's words/i.test(contract)) {
    throw new Error('Response contract is missing the easy-language requirement.');
  }
  if (!/do not default to analogy or caveman-style fragments/i.test(contract)) {
    throw new Error('Response contract is missing the no-caveman/no-default-analogy boundary.');
  }
  let prior = heading;
  for (const field of RESPONSE_FIELDS) {
    const index = context.indexOf(field, prior + 1);
    if (index === -1) throw new Error(`Response contract is missing ${field}`);
    if (index <= prior) throw new Error(`Response contract field order is invalid at ${field}`);
    prior = index;
  }
  return true;
}

module.exports = {
  FIRST_TURN_RULES,
  RESPONSE_CONTRACT,
  RESPONSE_FIELDS,
  buildFirstTurnContext,
  createContextOutput,
  getTimezoneOffset,
  validateContextOutput,
  validateResponseContract,
};
