'use strict';
const fs = require('fs');
const path = require('path');
const { readStdin, findTranscriptPath, encodeProjectPath, getRecentBashCommands } = require('./transcript-utils');
const { STORAGE_ROOT } = require('./constants');

// Skip processing during background memory summarization
if (process.env.CRABSHELL_BACKGROUND === '1') { process.exit(0); }

function getProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
}

function getPressureLevel() {
  try {
    const indexPath = path.join(getProjectDir(), STORAGE_ROOT, 'memory', 'memory-index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return (index && index.feedbackPressure && typeof index.feedbackPressure.level === 'number')
      ? index.feedbackPressure.level : 0;
  } catch { return 0; }
}

const SYCOPHANCY_PATTERNS = [
  // Korean
  /맞습니다/i,
  /맞는\s*지적/i,
  /동의합니다/i,
  /좋은\s*지적/i,
  /말씀하신\s*대로/i,
  /지적하신\s*것처럼/i,
  /좋은\s*의견/i,
  /말씀이\s*맞/i,
  /그\s*점은\s*인정/i,
  /맞다\./,
  /맞음\./,
  /잘못\./,
  // English
  /^Correct\./m,
  /^Right\./m,
  /you'?re right/i,
  /you are right/i,
  /that'?s correct/i,
  /that is correct/i,
  /\bi agree\b/i,
  /good point/i,
  /great point/i,
  /absolutely right/i,
  /exactly right/i,
  /as you pointed out/i,
  /as you mentioned/i,
  /as you said/i,
  /that makes sense/i,
  /fair point/i,
  /good observation/i,
  /you make a good point/i,
  /i stand corrected/i
];

// Exemption: response contains verification evidence (two tiers)
const BEHAVIORAL_EVIDENCE = [
  // P/O/G tables (implies predict-execute-compare cycle)
  /\|\s*Prediction.*\|\s*Observation/i,
  /\|\s*Item\s*\|\s*Prediction/i,
  // Shell command output (implies Bash tool execution)
  /^\$\s+.+$/m,
  // Test/verification output (PASS/FAIL implies execution)
  /\b(PASS|FAIL|OK|ERROR)\b.*\d/,
  // Korean verification result
  /검증\s*결과/,
];

const STRUCTURAL_EVIDENCE = [
  // Code blocks (reading code, not executing)
  /```[\s\S]{50,}?```/,
  // Line-numbered output (Read tool format)
  /^\s*\d+[→\|│]\s*.+$/m,
  // Function/class/const definitions
  /^(function|class|const|let|var|def|export)\s+\w+/m,
  // Markdown table separators
  /\|[-:]+\|[-:]+\|/,
  // Diff output
  /^[+-]{3}\s+[ab]\//m,
  // Grep-style output
  /^\S+:\d+:/m,
  // Korean analysis/confirmation markers
  /분석\s*결과/,
  /확인\s*결과/,
];

/**
 * Strip protected zones where sycophancy patterns should be ignored:
 * code blocks, inline code, blockquotes.
 */
function stripProtectedZones(text) {
  let stripped = text;
  stripped = stripped.replace(/```[\s\S]*?```/g, ' ');     // fenced code blocks
  stripped = stripped.replace(/^(?:    |\t).+$/gm, ' ');   // indented code
  stripped = stripped.replace(/`[^`]+`/g, ' ');             // inline code
  stripped = stripped.replace(/^>\s*.+$/gm, ' ');           // blockquotes
  stripped = stripped.replace(/"[^"\n]{1,80}"/g, ' ');      // double-quoted strings (short)
  stripped = stripped.replace(/'[^'\n]{1,80}'/g, ' ');      // single-quoted strings (short)
  stripped = stripped.replace(/\u300C[^\u300D\n]{1,80}\u300D/g, ' '); // 「」 quoted
  return stripped;
}

/**
 * Extract mid-turn assistant text from transcript JSONL.
 * Reads the last 8KB, finds the latest assistant tool_use line,
 * and collects preceding assistant text blocks.
 */
function extractMidTurnText(transcriptPath) {
  try {
    const stat = fs.statSync(transcriptPath);
    const readSize = Math.min(8192, stat.size);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    const text = buf.toString('utf8');
    const lines = text.split('\n').filter(l => l.trim());

    // Parse lines backward to find latest assistant tool_use, then collect preceding text
    let foundToolUse = false;
    const textParts = [];

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        if (!foundToolUse) {
          // Looking for assistant message with tool_use content
          if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
            const hasToolUse = obj.message.content.some(c => c.type === 'tool_use');
            if (hasToolUse) {
              foundToolUse = true;
              // Also extract any text blocks from this same message
              for (const block of obj.message.content) {
                if (block.type === 'text' && block.text) {
                  textParts.unshift(block.text);
                }
              }
            }
          }
        } else {
          // Collecting preceding assistant text blocks
          if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
            for (const block of obj.message.content) {
              if (block.type === 'text' && block.text) {
                textParts.unshift(block.text);
              }
            }
          } else {
            // Hit non-assistant line → stop collecting
            break;
          }
        }
      } catch { continue; }
    }

    return textParts.join('\n');
  } catch { return ''; }
}

/**
 * Shared sycophancy check: run pattern matching + isEarlyAgreement on text.
 * pressureLevel: 0-3 (0 = default, 3 = maximum strictness).
 * Returns { pattern, structuralNote } if sycophancy detected, or null if clean.
 */
function checkSycophancy(text, pressureLevel) {
  if (!text) return null;
  const level = (typeof pressureLevel === 'number') ? pressureLevel : 0;

  // Strip protected zones (code blocks, inline code, blockquotes) for pattern matching
  const strippedText = stripProtectedZones(text);

  // Check for sycophancy patterns in stripped text
  let matchedPattern = null;
  let matchIndex = -1;
  for (const pattern of SYCOPHANCY_PATTERNS) {
    const match = strippedText.match(pattern);
    if (match) {
      matchedPattern = match[0];
      // Find the match position in the ORIGINAL text for position-based checks
      const originalMatch = text.match(pattern);
      matchIndex = originalMatch ? originalMatch.index : 0;
      break;
    }
  }

  // No pattern found → clean
  if (!matchedPattern) return null;

  // Evidence & position check
  const textBeforeMatch = text.substring(0, matchIndex);

  // Check behavioral evidence — skip exemption at L3 (maximum pressure)
  if (level < 3) {
    for (const marker of BEHAVIORAL_EVIDENCE) {
      if (marker.test(textBeforeMatch)) {
        return null; // behavioral evidence found → clean
      }
    }
  }

  // Check structural evidence (for distinct messaging)
  let hasStructuralOnly = false;
  for (const marker of STRUCTURAL_EVIDENCE) {
    if (marker.test(textBeforeMatch)) {
      hasStructuralOnly = true;
      break;
    }
  }

  let structuralNote;
  if (level >= 2) {
    structuralNote = ' [L2+ PRESSURE] Structural evidence not considered at this pressure level.';
  } else {
    structuralNote = hasStructuralOnly
      ? ' Structural evidence (grep/read) found but behavioral evidence (execution/test output) is required.'
      : '';
  }

  return { pattern: matchedPattern, structuralNote };
}

// ====================================================================
// Verification Claim Detection
// ====================================================================

const VERIFICATION_CLAIM_PATTERNS = [
  // English (13)
  /\bverified\b/i,
  /\ball tests pass\b/i,
  /\bconfirmed working\b/i,
  /\btests passing\b/i,
  /\bverified working\b/i,
  /\bsuccessfully tested\b/i,
  /\bverification complete\b/i,
  /\ball checks pass\b/i,
  /\bconfirmed correct\b/i,
  /\btests are green\b/i,
  /\bbuild succeeds\b/i,
  /\bno errors found\b/i,
  /\bimplementation verified\b/i,
  // Korean (12)
  /검증완료/,
  /테스트\s*통과/,
  /확인완료/,
  /정상\s*동작/,
  /검증\s*결과\s*통과/,
  /모든\s*테스트\s*통과/,
  /빌드\s*성공/,
  /오류\s*없음/,
  /구현\s*검증/,
  /검증됨/,
  /확인됨/,
  /테스트\s*성공/,
];

// Negation prefixes: if found within 60 chars before the claim, it's not a claim
const NEGATION_PREFIXES = [
  /\bnot\s+(?:yet\s+)?$/i,
  /\bhaven'?t\s+$/i,
  /\bhasn'?t\s+$/i,
  /\bwasn'?t\s+$/i,
  /\bisn'?t\s+$/i,
  /\bdon'?t\s+$/i,
  /\bdoesn'?t\s+$/i,
  /\bnever\s+$/i,
  /\bwithout\s+$/i,
  /\bshould\s+$/i,
  /\bneed\s+to\s+$/i,
  /\bmust\s+$/i,
  // Korean
  /안\s*$/,
  /못\s*$/,
  /아직\s*$/,
];

// Test execution patterns (inlined from verification-sequence.js to avoid circular dependency)
const TEST_EXECUTION_PATTERNS = [
  /\bnpm\s+test\b/,
  /\bnpm\s+run\s+(test|check|verify|lint|build)\b/,
  /\bnpx\s+(jest|mocha|vitest)\b/,
  /\bpytest\b/,
  /\bcargo\s+test\b/,
  /\bgo\s+test\b/,
  /\bmake\s+test\b/,
  /\bnode(?:\.exe)?["']?\s+\S*\.test\.\S+/,
  /\bnode(?:\.exe)?["']?\s+\S*_test[_-]\S+/,
  /\btsc\b/,
  /\beslint\b/,
  /\bjest\b/,
  /\bmocha\b/,
  /\bvitest\b/,
];

// Structural-only command patterns (grep, read, cat — not execution)
const STRUCTURAL_CMD_PATTERNS = [
  /^\s*grep\b/,
  /^\s*rg\b/,
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*wc\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*(echo|printf)\b/,
];

/**
 * Check if text before match position contains a negation prefix (60-char lookback).
 */
function hasNegationPrefix(text, matchIndex) {
  if (matchIndex <= 0) return false;
  const lookback = text.substring(Math.max(0, matchIndex - 60), matchIndex);
  for (const prefix of NEGATION_PREFIXES) {
    if (prefix.test(lookback)) return true;
  }
  return false;
}

/**
 * Check if a command is a test execution (behavioral evidence).
 */
function isTestCommand(command) {
  if (!command || typeof command !== 'string') return false;
  const cmd = command.trim();
  // Reject trivial fake tests (echo pass, etc.)
  if (cmd.length < 15 && !/\b(test|jest|mocha|vitest|pytest|tsc|eslint|lint|build|check|verify)\b/i.test(cmd)) {
    return false;
  }
  if (/^\s*(echo|printf)\s+/i.test(cmd) && /\b(pass|ok|success|true)\b/i.test(cmd)) {
    return false;
  }
  for (const pattern of TEST_EXECUTION_PATTERNS) {
    if (pattern.test(cmd)) return true;
  }
  return false;
}

/**
 * Check if a command is structural-only (grep/read/cat — not execution).
 */
function isStructuralCommand(command) {
  if (!command || typeof command !== 'string') return false;
  const cmd = command.trim();
  for (const pattern of STRUCTURAL_CMD_PATTERNS) {
    if (pattern.test(cmd)) return true;
  }
  return false;
}

/**
 * Check verification claims in the stop response.
 *
 * 4-tier classification:
 *   BEHAVIORAL (test found in bash history)  → ALLOW
 *   PARTIAL    (non-test bash found)          → ALLOW (L0-L1) / BLOCK (L2+)
 *   STRUCTURAL_ONLY (only grep/read commands) → BLOCK
 *   NONE       (no bash commands at all)      → BLOCK
 *
 * pressureLevel: 0-3. At L2+, PARTIAL tier is also blocked.
 * Returns null if no claim found or fail-open conditions met.
 */
function checkVerificationClaims(response, transcriptPath, pressureLevel) {
  if (!response) return null;

  // Short response exemption: ≤15 chars too short for a verification claim
  // (Korean is more information-dense per character than English)
  if (response.length <= 15) return null;

  // Strip protected zones
  const stripped = stripProtectedZones(response);

  // Check for verification claim patterns
  let matchedClaim = null;
  let matchIndex = -1;
  for (const pattern of VERIFICATION_CLAIM_PATTERNS) {
    const match = stripped.match(pattern);
    if (match) {
      // Check negation prefix in stripped text
      if (hasNegationPrefix(stripped, match.index)) continue;
      matchedClaim = match[0];
      matchIndex = match.index;
      break;
    }
  }

  if (!matchedClaim) return null;

  // Check behavioral evidence in the response text itself (P/O/G tables, test output)
  const textBeforeClaim = response.substring(0, Math.max(0, matchIndex));
  for (const marker of BEHAVIORAL_EVIDENCE) {
    if (marker.test(textBeforeClaim) || marker.test(response)) {
      return { claim: matchedClaim, tier: 'BEHAVIORAL', blocked: false };
    }
  }

  // Claim found — check bash history for evidence
  const tPath = transcriptPath || findTranscriptPath();
  const bashCommands = getRecentBashCommands(tPath);

  // null = transcript unavailable → fail-open
  if (bashCommands === null) return null;

  if (bashCommands.length === 0) {
    return { claim: matchedClaim, tier: 'NONE', blocked: true };
  }

  // Classify bash commands
  let hasTest = false;
  let hasNonStructural = false;
  let allStructural = true;

  for (const { command } of bashCommands) {
    if (isTestCommand(command)) {
      hasTest = true;
      allStructural = false;
      break;
    }
    if (!isStructuralCommand(command)) {
      allStructural = false;
      hasNonStructural = true;
    }
  }

  const pLevel = (typeof pressureLevel === 'number') ? pressureLevel : 0;

  if (hasTest) {
    return { claim: matchedClaim, tier: 'BEHAVIORAL', blocked: false };
  }
  if (!allStructural && hasNonStructural) {
    // At L2+ pressure, PARTIAL is no longer sufficient — require BEHAVIORAL
    const blocked = pLevel >= 2;
    return { claim: matchedClaim, tier: 'PARTIAL', blocked };
  }
  return { claim: matchedClaim, tier: 'STRUCTURAL_ONLY', blocked: true };
}

/**
 * Handle PreToolUse hook: check mid-turn text before Write|Edit tool calls.
 */
function handlePreToolUse(hookData) {
  const toolName = hookData.tool_name || '';
  // Only check Write|Edit tools
  if (toolName !== 'Write' && toolName !== 'Edit') process.exit(0);

  // Get transcript path
  const transcriptPath = (hookData.transcript_path && hookData.transcript_path !== '')
    ? hookData.transcript_path
    : findTranscriptPath();

  if (!transcriptPath) process.exit(0); // fail-open: no transcript

  // Extract mid-turn text
  const midTurnText = extractMidTurnText(transcriptPath);
  if (!midTurnText) process.exit(0); // fail-open: no text found

  // Read pressure level
  const pLevel = getPressureLevel();

  // Run sycophancy check
  const result = checkSycophancy(midTurnText, pLevel);
  if (!result) process.exit(0); // clean

  // Sycophancy detected mid-turn → block the tool call
  const output = {
    decision: "block",
    reason: `Sycophancy pattern detected mid-turn: '${result.pattern}'.${result.structuralNote} You are about to ${toolName} a file after agreeing without verification. Before making changes, you MUST: (1) State the specific claim you agreed with, (2) Show independent verification with tool output, (3) Then proceed WITH evidence. Unverified agreement followed by file changes violates the Anti-Deception principle.${pressureHint(pLevel)}`
  };

  process.stderr.write(`[SYCOPHANCY_GUARD] PreToolUse blocked: pattern '${result.pattern}' before ${toolName} pressure=${pLevel}\n`);
  console.log(JSON.stringify(output));
  process.exit(2);
}

/**
 * Build a pressure-aware hint suffix for sycophancy block messages.
 */
function pressureHint(level) {
  if (level >= 3) return ' [L3] ALL agreement blocked — behavioral evidence required for any agreement. Do not swing to over-refusal; present evidence and let user judge.';
  if (level >= 2) return ' [L2] Behavioral evidence required — grep/read is insufficient. Show execution output.';
  if (level >= 1) return ' [L1] Rethink before agreeing — state the claim being accepted and verify with tool output.';
  return '';
}

/**
 * Handle Stop hook: check final response for verification claims and sycophancy.
 */
function handleStop(hookData) {
  // Prevent infinite loop: exit if this is a continuation from a previous stop hook block
  if (hookData.stop_hook_active) process.exit(0);

  const response = hookData.stop_response || hookData.last_assistant_message || '';

  if (!response) process.exit(0);

  // Read pressure level once
  const pLevel = getPressureLevel();

  // Step 1: Check verification claims BEFORE sycophancy check
  const claimResult = checkVerificationClaims(response, hookData.transcript_path, pLevel);
  if (claimResult && claimResult.blocked) {
    let tierMsg;
    if (claimResult.tier === 'NONE') {
      tierMsg = 'No Bash commands found in session history.';
    } else if (claimResult.tier === 'PARTIAL') {
      tierMsg = 'Only non-test Bash commands found — test execution required at this pressure level.';
    } else {
      tierMsg = 'Only structural commands (grep/read) found — no test execution.';
    }
    const output = {
      decision: "block",
      reason: `Verification claim detected: '${claimResult.claim}' [tier: ${claimResult.tier}]. ${tierMsg} Before claiming verification, you MUST: (1) Run actual tests or execute the code, (2) Show the test output, (3) Then state verification results WITH evidence. Claiming "verified" without execution violates the VERIFICATION-FIRST principle.${pressureHint(pLevel)}`
    };
    process.stderr.write(`[SYCOPHANCY_GUARD] Blocked verification claim: '${claimResult.claim}' tier=${claimResult.tier} pressure=${pLevel}\n`);
    console.log(JSON.stringify(output));
    process.exit(2);
  }

  // Step 2: Run sycophancy check
  const result = checkSycophancy(response, pLevel);
  if (!result) process.exit(0); // clean

  // Sycophancy detected, no exemption → block
  const output = {
    decision: "block",
    reason: `Sycophancy pattern detected: '${result.pattern}'.${result.structuralNote} You agreed without independent verification. Before agreeing, you MUST: (1) State the specific claim you agreed with, (2) Show independent verification with tool output, (3) Then agree WITH evidence or disagree WITH evidence. Unverified agreement violates the Anti-Deception principle.${pressureHint(pLevel)}`
  };

  process.stderr.write(`[SYCOPHANCY_GUARD] Blocked: pattern '${result.pattern}' detected pressure=${pLevel}\n`);
  console.log(JSON.stringify(output));
  process.exit(2);
}

async function main() {
  const hookData = await readStdin();
  if (!hookData || Object.keys(hookData).length === 0) process.exit(0); // fail-open: no data

  // Dual dispatch: detect mode from hookData
  const isPreToolUse = !!hookData.tool_name;

  if (isPreToolUse) {
    handlePreToolUse(hookData);
  } else {
    handleStop(hookData);
  }
}

main().catch(() => process.exit(0)); // fail-open on any error

// Export for unit testing
if (require.main !== module) {
  module.exports = { checkSycophancy, checkVerificationClaims, getPressureLevel, pressureHint };
}
