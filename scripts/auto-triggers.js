const fs = require('fs');
const path = require('path');

// Patterns that indicate user wants something remembered
const USER_EXPLICIT_PATTERNS = [
  /remember (this|that)/i,
  /always do/i,
  /never do/i,
  /from now on/i,
  /기억해/,
  /항상/,
  /앞으로는/
];

// Detect user explicit request
function detectUserExplicit(text) {
  for (const pattern of USER_EXPLICIT_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

// Detect if this is a repeated issue (needs history)
function detectRepeatedSolution(issueText, history) {
  // Count similar issues in history
  const similar = history.filter(h =>
    h.type === 'issue' &&
    calculateSimilarity(h.content, issueText) > 0.6
  );
  return similar.length >= 10;
}

// Simple word-based similarity
function calculateSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = [...words1].filter(w => words2.has(w));
  return intersection.length / Math.max(words1.size, words2.size);
}

// Detect breakthrough (multiple failures then success)
function detectBreakthrough(attempts, success) {
  return attempts >= 3 && success;
}

// Detect core logic change
const CORE_LOGIC_PATTERNS = [
  /architecture/i,
  /core (function|feature|system)/i,
  /main (logic|flow)/i,
  /구조 변경/,
  /핵심 기능/
];

function detectCoreLogic(text, files) {
  // Check text patterns
  for (const pattern of CORE_LOGIC_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  // Check if modifying core files (heuristic: state, core, main in name)
  const coreFilePatterns = [/state/i, /core/i, /main/i, /index/i];
  for (const file of files || []) {
    for (const pattern of coreFilePatterns) {
      if (pattern.test(file)) {
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  detectUserExplicit,
  detectRepeatedSolution,
  detectBreakthrough,
  detectCoreLogic,
  calculateSimilarity
};
