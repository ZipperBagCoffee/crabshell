'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

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

// Encode project path to Claude Code's ~/.claude/projects/ directory name format
function encodeProjectPath(projectDir) {
  return projectDir.replace(/\\/g, '/').replace(/\//g, '-').replace(':', '-');
}

// Find current session transcript by exact project path match
function findTranscriptPath() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd();
  const encoded = encodeProjectPath(projectDir);
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    if (!fs.existsSync(claudeProjectsDir)) return null;
    const projects = fs.readdirSync(claudeProjectsDir);
    // Exact match first (case-insensitive for Windows)
    const match = projects.find(p => p.toLowerCase() === encoded.toLowerCase());
    if (match) {
      const projPath = path.join(claudeProjectsDir, match);
      const files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
      if (files.length > 0) {
        const sorted = files.map(f => ({
          path: path.join(projPath, f),
          mtime: fs.statSync(path.join(projPath, f)).mtime
        })).sort((a, b) => b.mtime - a.mtime);
        return sorted[0].path;
      }
    }
  } catch (e) { return null; }
  return null;
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
 * Returns { pattern, structuralNote } if sycophancy detected, or null if clean.
 */
function checkSycophancy(text) {
  if (!text) return null;

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

  // Check behavioral evidence first — if present, agreement is justified
  for (const marker of BEHAVIORAL_EVIDENCE) {
    if (marker.test(textBeforeMatch)) {
      return null; // behavioral evidence found → clean
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

  const structuralNote = hasStructuralOnly
    ? ' Structural evidence (grep/read) found but behavioral evidence (execution/test output) is required.'
    : '';

  return { pattern: matchedPattern, structuralNote };
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

  // Run sycophancy check
  const result = checkSycophancy(midTurnText);
  if (!result) process.exit(0); // clean

  // Sycophancy detected mid-turn → block the tool call
  const output = {
    decision: "block",
    reason: `Sycophancy pattern detected mid-turn: '${result.pattern}'.${result.structuralNote} You are about to ${toolName} a file after agreeing without verification. Before making changes, you MUST: (1) State the specific claim you agreed with, (2) Show independent verification with tool output, (3) Then proceed WITH evidence. Unverified agreement followed by file changes violates the Anti-Deception principle.`
  };

  process.stderr.write(`[SYCOPHANCY_GUARD] PreToolUse blocked: pattern '${result.pattern}' before ${toolName}\n`);
  console.log(JSON.stringify(output));
  process.exit(2);
}

/**
 * Handle Stop hook: check final response for sycophancy (existing logic).
 */
function handleStop(hookData) {
  // Prevent infinite loop: exit if this is a continuation from a previous stop hook block
  if (hookData.stop_hook_active) process.exit(0);

  const response = hookData.stop_response || hookData.last_assistant_message || '';

  if (!response) process.exit(0);

  // Run sycophancy check
  const result = checkSycophancy(response);
  if (!result) process.exit(0); // clean

  // Sycophancy detected, no exemption → block
  const output = {
    decision: "block",
    reason: `Sycophancy pattern detected: '${result.pattern}'.${result.structuralNote} You agreed without independent verification. Before agreeing, you MUST: (1) State the specific claim you agreed with, (2) Show independent verification with tool output, (3) Then agree WITH evidence or disagree WITH evidence. Unverified agreement violates the Anti-Deception principle.`
  };

  process.stderr.write(`[SYCOPHANCY_GUARD] Blocked: pattern '${result.pattern}' detected\n`);
  console.log(JSON.stringify(output));
  process.exit(2);
}

async function main() {
  const hookData = await readStdin();
  if (!hookData) process.exit(0); // fail-open: no data

  // Dual dispatch: detect mode from hookData
  const isPreToolUse = !!hookData.tool_name;

  if (isPreToolUse) {
    handlePreToolUse(hookData);
  } else {
    handleStop(hookData);
  }
}

main().catch(() => process.exit(0)); // fail-open on any error
