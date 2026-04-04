'use strict';

/**
 * delta-background.js — Async PostToolUse hook for background delta summarization.
 *
 * Runs with async: true so it does not block Claude Code.
 * Checks deltaReady flag; if set, reads delta_temp.txt, summarizes via Haiku API
 * (or truncates as raw fallback), appends to logbook.md, then cleans up.
 *
 * Exit 0 always (fail-open). Never breaks the user workflow.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
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

// Call Anthropic Haiku API to summarize delta content.
// Returns a Promise resolving to the summary string, or null on failure.
function callHaikuApi(deltaContent) {
  return new Promise((resolve) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      resolve(null);
      return;
    }

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: 'Summarize (1 sentence per ~200 words):\n\n' + deltaContent
        }
      ]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content && parsed.content[0] && parsed.content[0].text;
          if (text) {
            resolve(text);
          } else {
            console.error('[CRABSHELL] delta-background: Haiku response missing content[0].text');
            resolve(null);
          }
        } catch (e) {
          console.error('[CRABSHELL] delta-background: Failed to parse Haiku response:', e.message);
          resolve(null);
        }
      });
    });

    req.on('error', (e) => {
      console.error('[CRABSHELL] delta-background: Haiku API request error:', e.message);
      resolve(null);
    });

    // Set a 30-second timeout for the API call
    req.setTimeout(30000, () => {
      console.error('[CRABSHELL] delta-background: Haiku API request timed out');
      req.destroy();
      resolve(null);
    });

    req.write(body);
    req.end();
  });
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

    // Summarize: Option A = Haiku API, Option B = truncate fallback
    let summary;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (apiKey) {
      console.error('[CRABSHELL] delta-background: calling Haiku API for summarization');
      const apiSummary = await callHaikuApi(deltaContent);
      if (apiSummary) {
        summary = apiSummary;
        console.error('[CRABSHELL] delta-background: Haiku summarization complete');
      } else {
        // API call failed — fall back to truncation
        console.error('[CRABSHELL] delta-background: Haiku API failed, falling back to raw truncation');
        summary = deltaContent.slice(0, 2000);
      }
    } else {
      // No API key — use raw truncation fallback
      console.error('[CRABSHELL] delta-background: no ANTHROPIC_API_KEY, using raw truncation fallback');
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
