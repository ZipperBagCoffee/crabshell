'use strict';
const fs = require('fs');
const path = require('path');

// Read stdin with timeout (same pattern as regressing-guard.js)
function readStdin(timeoutMs = 500) {
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

// Exemption: response contains P/O/G verification evidence
const EVIDENCE_MARKERS = [
  /\|\s*Prediction.*\|\s*Observation/i,
  /\|\s*Item\s*\|\s*Prediction/i,
];

async function main() {
  const hookData = await readStdin();
  if (!hookData) process.exit(0); // fail-open: no data

  const response = hookData.stop_response || hookData.last_assistant_message || '';

  // Short response exemption: < 100 chars is likely brief acknowledgment
  if (!response || response.length < 100) process.exit(0);

  // Check for sycophancy patterns
  let matchedPattern = null;
  for (const pattern of SYCOPHANCY_PATTERNS) {
    const match = response.match(pattern);
    if (match) {
      matchedPattern = match[0];
      break;
    }
  }

  // No pattern found → allow
  if (!matchedPattern) process.exit(0);

  // Evidence exemption: if response contains P/O/G table, agreement is evidence-backed
  for (const marker of EVIDENCE_MARKERS) {
    if (marker.test(response)) process.exit(0);
  }

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
