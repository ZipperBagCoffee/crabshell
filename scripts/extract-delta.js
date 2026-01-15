// scripts/extract-delta.js
const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, readIndexSafe, writeJson, estimateTokens, extractTailByTokens } = require('./utils');
const { SESSIONS_DIR, MEMORY_DIR, INDEX_FILE, DELTA_TEMP_FILE, HAIKU_SAFE_TOKENS, FIRST_RUN_MAX_ENTRIES, DELTA_OUTPUT_TRUNCATE } = require('./constants');

function extractDelta() {
  try {
    const projectDir = getProjectDir();
    const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
    const sessionsDir = path.join(projectDir, '.claude', SESSIONS_DIR);
    const indexPath = path.join(memoryDir, INDEX_FILE);

    // Get last update timestamp
    const index = readIndexSafe(indexPath);  // Use safe reader to preserve all fields
    const lastUpdateTs = index.lastMemoryUpdateTs || null;

    // Get most recent L1 file
    if (!fs.existsSync(sessionsDir)) {
      return { success: false, reason: 'No sessions dir' };
    }

    const l1Files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.l1.jsonl'))
      .sort()
      .reverse();

    if (l1Files.length === 0) {
      return { success: false, reason: 'No L1 files' };
    }

    const l1Path = path.join(sessionsDir, l1Files[0]);
    const content = fs.readFileSync(l1Path, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    // Filter entries after lastUpdateTs
    const delta = [];
    let skippedCount = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Skip if before last update
        if (lastUpdateTs && entry.ts && entry.ts <= lastUpdateTs) {
          skippedCount++;
          continue;
        }

        // Format entry based on role
        // L1 format from refine-raw.js:
        // - assistant: { ts, role: 'assistant', text }
        // - user: { ts, role: 'user', text }
        // - tool: { ts, role: 'tool', name, cmd?(Bash), target?(Read/Edit/Write), pattern?(Grep/Glob), ... }
        // - tool_result: { ts, role: 'tool_result', tool_use_id, result, output }

        if (entry.role === 'assistant' && entry.text) {
          delta.push(`[Assistant]: ${entry.text}`);
        } else if (entry.role === 'user' && entry.text) {
          delta.push(`[User]: ${entry.text}`);
        } else if (entry.role === 'tool' && entry.name) {
          // Format tool entry based on tool type
          let toolInfo = '';
          if (entry.cmd) {
            // Bash
            toolInfo = entry.cmd;
          } else if (entry.target) {
            // Read, Edit, Write
            toolInfo = entry.target;
            if (entry.diff) toolInfo += ` (edited)`;
            if (entry.size) toolInfo += ` (${entry.size} bytes)`;
          } else if (entry.pattern) {
            // Grep, Glob
            toolInfo = entry.pattern;
            if (entry.path) toolInfo += ` in ${entry.path}`;
          } else if (entry.params) {
            // Other tools
            toolInfo = entry.params;
          }
          delta.push(`[Tool: ${entry.name}] ${toolInfo}`);
        } else if (entry.role === 'tool_result') {
          // Tool result with output
          let resultEntry = `[Result: ${entry.result || 'ok'}]`;
          if (entry.output) {
            const outputPreview = entry.output.substring(0, DELTA_OUTPUT_TRUNCATE);
            resultEntry += ` ${outputPreview}${entry.output.length > DELTA_OUTPUT_TRUNCATE ? '...' : ''}`;
          }
          delta.push(resultEntry);
        }
      } catch (e) {}
    }

    // First run handling: limit to recent entries
    if (!lastUpdateTs && delta.length > FIRST_RUN_MAX_ENTRIES) {
      delta.splice(0, delta.length - FIRST_RUN_MAX_ENTRIES);
    }

    if (delta.length === 0) {
      return { success: false, reason: 'No new content' };
    }

    // Join delta content
    let deltaContent = delta.join('\n\n');

    // Handle Haiku context limit
    const tokens = estimateTokens(deltaContent);
    if (tokens > HAIKU_SAFE_TOKENS) {
      deltaContent = extractTailByTokens(deltaContent, HAIKU_SAFE_TOKENS);
    }

    // Write delta to temp file
    const deltaPath = path.join(memoryDir, DELTA_TEMP_FILE);
    fs.writeFileSync(deltaPath, deltaContent);

    return {
      success: true,
      deltaFile: DELTA_TEMP_FILE,
      entryCount: delta.length,
      tokens: estimateTokens(deltaContent)
    };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// Update timestamp after memory.md is updated
function markMemoryUpdated() {
  try {
    const projectDir = getProjectDir();
    const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
    const indexPath = path.join(memoryDir, INDEX_FILE);

    const index = readIndexSafe(indexPath);  // Use safe reader to preserve all fields
    index.lastMemoryUpdateTs = new Date().toISOString();
    writeJson(indexPath, index);

    console.log('[MEMORY_KEEPER] Timestamp updated:', index.lastMemoryUpdateTs);
    return true;
  } catch (e) {
    console.error('[MEMORY_KEEPER] Failed to update timestamp:', e.message);
    return false;
  }
}

// Delete temp file
function cleanupDeltaTemp() {
  try {
    const projectDir = getProjectDir();
    const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
    const deltaPath = path.join(memoryDir, DELTA_TEMP_FILE);

    if (fs.existsSync(deltaPath)) {
      fs.unlinkSync(deltaPath);
      console.log('[MEMORY_KEEPER] Delta temp file cleaned up');
    }
    return true;
  } catch (e) {
    console.error('[MEMORY_KEEPER] Failed to cleanup delta temp:', e.message);
    return false;
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];

  switch (command) {
    case 'extract':
      const result = extractDelta();
      console.log(JSON.stringify(result));
      break;
    case 'mark-updated':
      markMemoryUpdated();
      break;
    case 'cleanup':
      cleanupDeltaTemp();
      break;
    default:
      console.log('Usage: extract-delta.js <extract|mark-updated|cleanup>');
  }
}

module.exports = { extractDelta, markMemoryUpdated, cleanupDeltaTemp };
