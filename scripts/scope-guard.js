'use strict';

const { readStdin, findTranscriptPath, getLastUserMessage } = require('./transcript-utils');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

// Temporal units to EXCLUDE from quantity detection (prevents "3개월" = "3 months" false positive)
const TEMPORAL_UNITS = /^(월|년|일|시간|분|초|주|달|months?|years?|days?|hours?|minutes?|seconds?|weeks?)$/i;

// Quantity patterns in user message
const EXPLICIT_NUMBER_RE = /(\d+)\s*(개|건|항목|items?|files?|파일|종목|가지|번|개씩)/i;
const ALL_KEYWORDS_RE = /(?:\b(all|every|each)\b|(전부|전체|모두|모든))/i;
const BOTH_KEYWORDS_RE = /(?:\b(both)\b|(둘\s*다|둘다))/i;

// Scope reduction language in response
const REDUCTION_PATTERNS = [
  /나머지는/,
  /일부만/,
  /시간\s*(관계상|부족|이\s*오래)/,
  /too many/i,
  /takes?\s+too\s+long/i,
  /제외하고/,
  /생략/,
  /instead\s+of\s+all/i,
  /narrowed?\s+to/i,
  /only\s+(doing|including|processing)/i,
  /줄여서/,
  /축소/,
  /먼저\s+.{0,20}만/,
];

/**
 * Extract quantity indicator from user message.
 * Returns { type: 'number', value: N } | { type: 'all' } | { type: 'both' } | null
 */
function extractUserQuantity(text) {
  if (!text) return null;

  // Check "both" first (more specific)
  if (BOTH_KEYWORDS_RE.test(text)) return { type: 'both' };

  // Check "all/every/전부"
  if (ALL_KEYWORDS_RE.test(text)) return { type: 'all' };

  // Check explicit number + unit
  const numMatch = text.match(EXPLICIT_NUMBER_RE);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    // Check if the unit following the number is a temporal unit (false positive guard)
    const afterNumber = text.slice(numMatch.index + numMatch[0].length).trim();
    const nextWord = afterNumber.split(/[\s,.)]/)[0];
    if (nextWord && TEMPORAL_UNITS.test(nextWord)) return null;
    if (num > 0 && num <= 1000) return { type: 'number', value: num };
  }

  return null;
}

/**
 * Count numbered list items in response text.
 * Matches patterns like "1. ", "2. ", etc.
 */
function countNumberedItems(text) {
  const matches = text.match(/^\d+\.\s/gm);
  return matches ? matches.length : 0;
}

/**
 * Check if response contains scope-reduction language.
 * Returns the matched pattern string or null.
 */
function hasReductionLanguage(text) {
  for (const pattern of REDUCTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/**
 * Output JSON to stdout (for Claude Code hook protocol).
 */
function output(obj) {
  console.log(JSON.stringify(obj));
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || Object.keys(hookData).length === 0) process.exit(0);

  // Prevent infinite loop
  if (hookData.stop_hook_active) process.exit(0);

  const response = hookData.stop_response || hookData.last_assistant_message || '';

  // Skip very short responses (acknowledgments, single-word replies)
  if (!response || response.length < 50) process.exit(0);

  // Get transcript path
  const tPath = hookData.transcript_path || findTranscriptPath();
  if (!tPath) process.exit(0); // fail-open: no transcript

  // Extract last user message
  const userMsg = getLastUserMessage(tPath);
  if (!userMsg) process.exit(0); // fail-open: can't read user message

  // Extract quantity from user message
  const userQty = extractUserQuantity(userMsg);
  if (!userQty) process.exit(0); // no quantity indicator → nothing to check

  if (userQty.type === 'number') {
    // Count items in response
    const responseCount = countNumberedItems(response);
    if (responseCount > 0 && responseCount < userQty.value) {
      output({
        decision: 'block',
        reason: `Scope reduction detected: user requested ${userQty.value} items, response contains only ${responseCount}. Complete ALL requested items before finishing, or explicitly ask user to confirm the reduced scope.`
      });
      process.stderr.write(`[SCOPE_GUARD] Blocked: user=${userQty.value}, response=${responseCount}\n`);
      process.exit(2);
    }

    // Also check for reduction language even if count matches
    const reduction = hasReductionLanguage(response);
    if (reduction) {
      output({
        decision: 'block',
        reason: `Scope reduction language detected ("${reduction}") while user requested ${userQty.value} items. Complete ALL requested items or ask user to confirm reduced scope.`
      });
      process.stderr.write(`[SCOPE_GUARD] Blocked: reduction language "${reduction}" with explicit count ${userQty.value}\n`);
      process.exit(2);
    }
  } else if (userQty.type === 'all' || userQty.type === 'both') {
    const reduction = hasReductionLanguage(response);
    if (reduction) {
      const label = userQty.type === 'both' ? 'both/둘 다' : 'all/전부';
      output({
        decision: 'block',
        reason: `Scope reduction detected: user requested "${label}", but response contains scope reduction ("${reduction}"). Complete ALL requested items or ask user to confirm reduced scope.`
      });
      process.stderr.write(`[SCOPE_GUARD] Blocked: "${label}" + reduction "${reduction}"\n`);
      process.exit(2);
    }
  }

  // All checks passed
  process.exit(0);
}

// Only run main() when executed directly (not when require'd by tests)
if (require.main === module) {
  main().catch(() => process.exit(0)); // fail-open on any error
}

// Exports for testing
module.exports = {
  extractUserQuantity,
  countNumberedItems,
  hasReductionLanguage,
};
