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
  // English
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

// Exemption: response contains verification evidence
const EVIDENCE_MARKERS = [
  // P/O/G tables
  /\|\s*Prediction.*\|\s*Observation/i,
  /\|\s*Item\s*\|\s*Prediction/i,
  // Substantial code blocks (50+ chars inside fenced block)
  /```[\s\S]{50,}?```/,
  // Line-numbered output (Read tool format)
  /^\s*\d+[→\|│]\s*.+$/m,
  // Shell command output
  /^\$\s+.+$/m,
  // Function/class/const definitions
  /^(function|class|const|let|var|def|export)\s+\w+/m,
  // Test/verification output (PASS/FAIL)
  /\b(PASS|FAIL|OK|ERROR)\b.*\d/,
  // Markdown table separators
  /\|[-:]+\|[-:]+\|/,
  // Diff output
  /^[+-]{3}\s+[ab]\//m,
  // Grep-style output
  /^\S+:\d+:/m,
  // Korean evidence markers
  /분석\s*결과/,
  /확인\s*결과/,
  /검증\s*결과/,
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
 * i.e., no evidence precedes it and it appears before substantial content.
 */
function isEarlyAgreement(response, matchIndex) {
  // Primary: check if evidence exists anywhere in response BEFORE the match
  const textBeforeMatch = response.substring(0, matchIndex);
  for (const marker of EVIDENCE_MARKERS) {
    if (marker.test(textBeforeMatch)) {
      return false; // evidence before agreement = not suspicious
    }
  }
  // Secondary: if substantial content (500+ chars) precedes, likely analysis was done
  if (textBeforeMatch.length > 500) {
    return false;
  }
  return true; // no evidence before agreement = suspicious
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

  // Evidence & position exemption: only allow if evidence precedes the agreement
  if (!isEarlyAgreement(response, matchIndex)) process.exit(0);

  // Sycophancy detected, no exemption → block
  const output = {
    decision: "block",
    reason: `Sycophancy pattern detected: '${matchedPattern}'. You agreed without independent verification. Before agreeing, you MUST: (1) State the specific claim you agreed with, (2) Show independent verification with tool output, (3) Then agree WITH evidence or disagree WITH evidence. Unverified agreement violates the Anti-Deception principle.`
  };

  process.stderr.write(`[SYCOPHANCY_GUARD] Blocked: pattern '${matchedPattern}' detected\n`);
  console.log(JSON.stringify(output));
  process.exit(2);
}

main().catch(() => process.exit(0)); // fail-open on any error
