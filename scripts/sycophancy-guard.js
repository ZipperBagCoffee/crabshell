'use strict';
const fs = require('fs');
const path = require('path');

// Read stdin with timeout (same pattern as regressing-guard.js)
function readStdin(timeoutMs = 500) {
  // hook-runner.js v2 stores parsed stdin in HOOK_DATA env var
  if (process.env.HOOK_DATA) {
    try { return Promise.resolve(JSON.parse(process.env.HOOK_DATA)); }
    catch { return Promise.resolve(null); }
  }
  return new Promise((resolve) => {
    let data = '';
    let resolved = false;
    const done = (result) => { if (!resolved) { resolved = true; resolve(result); } };
    const timer = setTimeout(() => {
      done(data.trim() ? (() => { try { return JSON.parse(data.trim()); } catch { return null; } })() : null);
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      if (data.trim()) { try { done(JSON.parse(data.trim())); } catch { done(null); } }
      else { done(null); }
    });
    process.stdin.on('error', () => { clearTimeout(timer); done(null); });
    process.stdin.resume();
  });
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
  return stripped;
}

/**
 * Check if a sycophancy match at matchIndex is "early agreement" —
 * i.e., no behavioral evidence precedes it and it appears before substantial content.
 * Returns { blocked: true, structuralOnly: boolean } or { dominated: false }.
 */
function isEarlyAgreement(response, matchIndex) {
  const textBeforeMatch = response.substring(0, matchIndex);

  // Check behavioral evidence first — if present, agreement is justified
  for (const marker of BEHAVIORAL_EVIDENCE) {
    if (marker.test(textBeforeMatch)) {
      return { dominated: false };
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

  return { blocked: true, structuralOnly: hasStructuralOnly };
}

async function main() {
  const hookData = await readStdin();
  if (!hookData) process.exit(0); // fail-open: no data

  // Prevent infinite loop: exit if this is a continuation from a previous stop hook block
  if (hookData.stop_hook_active) process.exit(0);

  const response = hookData.stop_response || hookData.last_assistant_message || '';

  // Short response exemption: < 100 chars is likely brief acknowledgment
  if (!response || response.length < 100) process.exit(0);

  // Strip protected zones (code blocks, inline code, blockquotes) for pattern matching
  const strippedResponse = stripProtectedZones(response);

  // Check for sycophancy patterns in stripped response (ignoring protected zones)
  let matchedPattern = null;
  let matchIndex = -1;
  for (const pattern of SYCOPHANCY_PATTERNS) {
    const match = strippedResponse.match(pattern);
    if (match) {
      matchedPattern = match[0];
      // Find the match position in the ORIGINAL response for position-based checks
      const originalMatch = response.match(pattern);
      matchIndex = originalMatch ? originalMatch.index : 0;
      break;
    }
  }

  // No pattern found → allow
  if (!matchedPattern) process.exit(0);

  // Evidence & position exemption: only allow if behavioral evidence precedes the agreement
  const earlyResult = isEarlyAgreement(response, matchIndex);
  if (earlyResult.blocked !== true) process.exit(0);

  // Distinct reason for structural-only vs no-evidence
  const structuralNote = earlyResult.structuralOnly
    ? ' Structural evidence (grep/read) found but behavioral evidence (execution/test output) is required.'
    : '';

  // Sycophancy detected, no exemption → block
  const output = {
    decision: "block",
    reason: `Sycophancy pattern detected: '${matchedPattern}'.${structuralNote} You agreed without independent verification. Before agreeing, you MUST: (1) State the specific claim you agreed with, (2) Show independent verification with tool output, (3) Then agree WITH evidence or disagree WITH evidence. Unverified agreement violates the Anti-Deception principle.`
  };

  process.stderr.write(`[SYCOPHANCY_GUARD] Blocked: pattern '${matchedPattern}' detected\n`);
  console.log(JSON.stringify(output));
  process.exit(2);
}

main().catch(() => process.exit(0)); // fail-open on any error
