'use strict';

const { readStdin } = require('./transcript-utils');

// Skip processing during background memory summarization
// F1 mitigation: keep inline env check for fail-open invariant — D106 IA-10 RA2
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

/**
 * Trailing deferral question patterns.
 * These detect when the assistant ends a substantive response with a deferral
 * question — asking the user whether to proceed rather than proceeding.
 *
 * NOTE: "would you like me to" as a standalone clarification (short response, no analysis body)
 * is intentionally NOT blocked — it is standard politeness. The hasAnalysisBody check
 * prevents false positives by only flagging when preceded by substantive content.
 */
const DEFERRAL_QUESTIONS = [
  // Korean trailing deferral questions
  /(?:다음|이후|나중에|나중)\s+(?:진행|계속|해|할까|할까요|하면\s*될까)[\s\S]{0,50}$/i,
  /(?:계속\s+)?진행할까요\s*[\?？]?\s*$/,
  /이렇게\s+(?:진행|계속)해\s*(?:도\s*)?될까요\s*[\?？]?\s*$/,
  /(?:어떻게|어떤|무엇을)\s+(?:할|진행|계속)할까요\s*[\?？]?\s*$/,
  // English trailing deferral questions
  /shall\s+(?:I|we)\s+(?:proceed|continue)\s*[\?]?\s*$/i,
  /would\s+you\s+like\s+(?:me\s+to\s+)?(?:proceed|continue|move on)\s*[\?]?\s*$/i,
  /(?:should|shall)\s+(?:I|we)\s+(?:do|start|begin)\s+.{0,60}\s*[\?]?\s*$/i,
  /do\s+you\s+want\s+(?:me\s+to\s+)?.{0,60}\s*[\?]?\s*$/i,
];

/**
 * Returns true if the response has substantive analysis content.
 * Threshold: ≥5 non-empty lines OR ≥400 characters.
 * Raised threshold (RA amendment) to reduce false positives on short responses with questions.
 */
function hasAnalysisBody(response) {
  if (!response) return false;
  const lines = response.split(/\r?\n/).filter(l => l.trim().length > 0);
  return lines.length >= 5 || response.length >= 400;
}

/**
 * Check if the response ends with a trailing deferral question.
 */
function hasTrailingDeferralQuestion(response) {
  const tail = response.slice(-300); // check last 300 chars only
  return DEFERRAL_QUESTIONS.some(pattern => pattern.test(tail));
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || Object.keys(hookData).length === 0) process.exit(0);

  // Exempt: stop_hook_active to prevent infinite loops
  if (hookData.stop_hook_active) process.exit(0);

  const response = hookData.stop_response || '';

  // Exempt: short responses (≤4 non-empty lines) — likely just clarification questions
  const nonEmptyLines = response.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (nonEmptyLines.length <= 4) process.exit(0);

  // Warn if analysis body present AND trailing deferral question detected
  if (hasAnalysisBody(response) && hasTrailingDeferralQuestion(response)) {
    process.stderr.write('[BEHAVIOR-WARN] Trailing deferral question detected (PROHIBITED #7). (warn-only — sub-agent verifier §3.logic Trailing-deferral sub-clause will retroactively correct in next turn)\n');
  }

  // Warn-only: always exit 0, never block
  process.exit(0);
}

if (require.main === module) {
  main().catch(() => process.exit(0)); // fail-open on any error
} else {
  module.exports = { hasAnalysisBody, DEFERRAL_QUESTIONS };
}
