'use strict';

/**
 * delta-background.js — Async PostToolUse hook for background delta summarization.
 *
 * Runs with asyncRewake: true so it does not block Claude Code.
 * Checks deltaReady flag; if set, reads delta_temp.txt, summarizes via
 * `claude -p --model haiku` subprocess (or truncates as raw fallback),
 * appends to logbook.md, then cleans up.
 *
 * Exit 0 always (fail-open). Never breaks the user workflow.
 * Sets CRABSHELL_BACKGROUND=1 when spawning claude subprocess to prevent
 * recursive hook invocation.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getProjectDir, getStorageRoot, readIndexSafe, writeJson } = require('./utils');
const { readStdin: readStdinShared } = require('./transcript-utils');
const { markMemoryAppended, markMemoryUpdated, cleanupDeltaTemp } = require('./extract-delta');
const { MEMORY_DIR, MEMORY_FILE, INDEX_FILE, DELTA_TEMP_FILE } = require('./constants');

// Use shared readStdin with 1000ms timeout for PostToolUse hook
function readStdin() {
  return readStdinShared(1000);
}

// Build dual-format timestamp header matching append-memory.js format
// Returns "## YYYY-MM-DD_HHMM (local MM-DD_HHMM)"
function buildTimestampHeader() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const utc = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  const local = `${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  return `## ${utc} (local ${local})`;
}

/**
 * Parse stream-json output from `claude -p --output-format stream-json`.
 * Looks for lines with "type":"assistant" containing content[].text.
 * Returns concatenated text or null if nothing found.
 */
function parseStreamJson(output) {
  if (!output || !output.trim()) return null;
  const lines = output.split('\n');
  const textParts = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.type === 'assistant' && Array.isArray(parsed.message && parsed.message.content)) {
        for (const block of parsed.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            textParts.push(block.text);
          }
        }
      }
    } catch (e) {
      // Non-JSON line — skip
    }
  }
  const result = textParts.join('').trim();
  return result || null;
}

/**
 * Invoke `claude -p --model haiku` subprocess to summarize delta content.
 * Passes delta via stdin. Sets CRABSHELL_BACKGROUND=1 to prevent recursive hooks.
 * Returns summary string, or null on failure (caller falls back to truncation).
 */
function callHaikuCli(deltaContent) {
  try {
    const prompt = 'Summarize (1 sentence per ~200 words):\n\n' + deltaContent;
    const cmd = [
      'claude', '-p',
      '--model', 'haiku',
      '--verbose',
      '--output-format', 'stream-json',
      '--append-system-prompt', 'Output ONLY the summary, nothing else.',
      '--disallowed-tools', 'Bash,Read,Write,Edit,Glob,Grep,Skill,ToolSearch,Agent'
    ].join(' ');

    const output = execSync(cmd, {
      input: prompt,
      timeout: 120000,
      encoding: 'utf8',
      env: { ...process.env, CRABSHELL_BACKGROUND: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const summary = parseStreamJson(output);
    if (summary) {
      return summary;
    }
    console.error('[CRABSHELL] delta-background: stream-json parse yielded no text, falling back');
    return null;
  } catch (e) {
    console.error('[CRABSHELL] delta-background: claude -p subprocess failed:', e.message);
    return null;
  }
}

async function main() {
  try {
    // Read stdin (hook data) — required by PostToolUse hook contract
    await readStdin();

    const projectDir = getProjectDir();
    const memoryDir = path.join(getStorageRoot(projectDir), MEMORY_DIR);
    const indexPath = path.join(memoryDir, INDEX_FILE);

    // Check deltaReady flag — most invocations exit here silently
    let index;
    try {
      index = readIndexSafe(indexPath);
    } catch (e) {
      // No index file at all — nothing to do
      process.exit(0);
    }

    if (!index.deltaReady) {
      // Normal case: no pending delta, exit silently
      process.exit(0);
    }

    console.error('[CRABSHELL] delta-background: deltaReady detected, processing delta');

    // Read delta_temp.txt
    const deltaPath = path.join(memoryDir, DELTA_TEMP_FILE);
    if (!fs.existsSync(deltaPath)) {
      console.error('[CRABSHELL] delta-background: deltaReady=true but delta_temp.txt not found, clearing flag');
      index.deltaReady = false;
      writeJson(indexPath, index);
      process.exit(0);
    }

    const deltaContent = fs.readFileSync(deltaPath, 'utf8').trim();
    if (!deltaContent) {
      console.error('[CRABSHELL] delta-background: delta_temp.txt is empty, clearing flag');
      index.deltaReady = false;
      writeJson(indexPath, index);
      process.exit(0);
    }

    // Summarize: Option A = claude -p haiku subprocess, Option B = truncate fallback
    let summary;
    console.error('[CRABSHELL] delta-background: invoking claude -p haiku for summarization');
    const cliSummary = callHaikuCli(deltaContent);
    if (cliSummary) {
      summary = cliSummary;
      console.error('[CRABSHELL] delta-background: Haiku summarization complete');
    } else {
      // Subprocess failed or returned no text — fall back to raw truncation
      console.error('[CRABSHELL] delta-background: Haiku CLI failed, falling back to raw truncation');
      summary = deltaContent.slice(0, 2000);
    }

    // Build logbook entry with dual timestamp header
    const header = buildTimestampHeader();
    const entry = `\n${header}\n${summary}\n`;

    // Append to logbook.md
    const logbookPath = path.join(memoryDir, MEMORY_FILE);
    fs.appendFileSync(logbookPath, entry, 'utf8');
    console.error('[CRABSHELL] delta-background: appended to logbook.md');

    // Mark memory appended (sets memoryAppendedInThisRun flag)
    markMemoryAppended();

    // Mark memory updated (promotes pendingLastProcessedTs to lastMemoryUpdateTs)
    markMemoryUpdated();

    // Cleanup delta temp file (verifies logbook.md was updated, deletes delta_temp.txt,
    // clears deltaReady + memoryAppendedInThisRun flags)
    const cleaned = cleanupDeltaTemp();
    if (cleaned) {
      console.error('[CRABSHELL] delta-background: cleanup complete');
    } else {
      // cleanupDeltaTemp() logs its own error — clear deltaReady manually as fallback
      console.error('[CRABSHELL] delta-background: cleanup failed, clearing deltaReady manually');
      try {
        const idx = readIndexSafe(indexPath);
        idx.deltaReady = false;
        writeJson(indexPath, idx);
      } catch (e) {
        console.error('[CRABSHELL] delta-background: failed to clear deltaReady:', e.message);
      }
    }

  } catch (e) {
    // Fail-open: log error but always exit 0
    console.error('[CRABSHELL] delta-background: unexpected error:', e.message);
  }

  process.exit(0);
}

main();
