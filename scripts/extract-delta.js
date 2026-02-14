// scripts/extract-delta.js
const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, readIndexSafe, writeJson, estimateTokens, extractTailByTokens } = require('./utils');
const { SESSIONS_DIR, MEMORY_DIR, MEMORY_FILE, INDEX_FILE, DELTA_TEMP_FILE, HAIKU_SAFE_TOKENS, FIRST_RUN_MAX_ENTRIES, DELTA_OUTPUT_TRUNCATE } = require('./constants');

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

    // Filter entries after lastUpdateTs, track max processed timestamp
    const delta = [];
    let skippedCount = 0;
    let maxProcessedTs = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Skip if before last update
        if (lastUpdateTs && entry.ts && entry.ts <= lastUpdateTs) {
          skippedCount++;
          continue;
        }

        // Track max timestamp of processed entries (for L1-based lastMemoryUpdateTs)
        if (entry.ts && (!maxProcessedTs || entry.ts > maxProcessedTs)) {
          maxProcessedTs = entry.ts;
        }

        // Format entry based on role
        if (entry.role === 'assistant' && entry.text) {
          delta.push(`◆ Claude: ${entry.text}`);
        } else if (entry.role === 'user' && entry.text) {
          delta.push(`◆ User: ${entry.text}`);
        } else if (entry.role === 'tool' && entry.name) {
          let toolInfo = '';
          if (entry.cmd) {
            toolInfo = entry.cmd;
          } else if (entry.target) {
            toolInfo = entry.target;
            if (entry.diff) toolInfo += ` (edited)`;
            if (entry.size) toolInfo += ` (${entry.size} bytes)`;
          } else if (entry.pattern) {
            toolInfo = entry.pattern;
            if (entry.path) toolInfo += ` in ${entry.path}`;
          } else if (entry.params) {
            toolInfo = entry.params;
          }
          delta.push(`◆ Tool(${entry.name}): ${toolInfo}`);
        }
        // Skip tool_result entirely - causes confusion when Claude sees "[Result: ok]" in logs
      } catch (e) {}
    }

    // First run handling: limit to recent entries
    if (!lastUpdateTs && delta.length > FIRST_RUN_MAX_ENTRIES) {
      delta.splice(0, delta.length - FIRST_RUN_MAX_ENTRIES);
    }

    if (delta.length === 0) {
      return { success: false, reason: 'No new content' };
    }

    // Join delta content with UTC timestamp header
    const extractTime = new Date().toISOString();
    let deltaContent = `\n--- [${extractTime}] ---\n` + delta.join('\n\n');

    // Append to delta temp file (don't overwrite!)
    const deltaPath = path.join(memoryDir, DELTA_TEMP_FILE);
    fs.appendFileSync(deltaPath, deltaContent);

    // Handle Haiku context limit (truncate if total exceeds limit)
    const totalContent = fs.readFileSync(deltaPath, 'utf8');
    const tokens = estimateTokens(totalContent);
    if (tokens > HAIKU_SAFE_TOKENS) {
      const truncated = extractTailByTokens(totalContent, HAIKU_SAFE_TOKENS);
      fs.writeFileSync(deltaPath, truncated);
    }

    // Record memory.md mtime + pendingLastProcessedTs for L1-based timestamp
    const memoryPath = path.join(memoryDir, MEMORY_FILE);
    {
      const idx = readIndexSafe(indexPath);
      if (fs.existsSync(memoryPath)) {
        idx.deltaCreatedAtMemoryMtime = fs.statSync(memoryPath).mtimeMs;
      }
      if (maxProcessedTs) {
        idx.pendingLastProcessedTs = maxProcessedTs;
      }
      writeJson(indexPath, idx);
    }

    return {
      success: true,
      deltaFile: DELTA_TEMP_FILE,
      entryCount: delta.length,
      tokens: estimateTokens(fs.readFileSync(deltaPath, 'utf8')),
      lastProcessedTs: maxProcessedTs
    };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// Update timestamp after memory.md is updated
// Uses L1 entry timestamp (pendingLastProcessedTs) instead of wall clock time
// This prevents gaps where entries created between processing and marking get skipped
function markMemoryUpdated() {
  try {
    const projectDir = getProjectDir();
    const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
    const indexPath = path.join(memoryDir, INDEX_FILE);

    const index = readIndexSafe(indexPath);

    if (index.pendingLastProcessedTs) {
      index.lastMemoryUpdateTs = index.pendingLastProcessedTs;
      delete index.pendingLastProcessedTs;
    } else {
      // Fallback: wall clock time (backward compatibility)
      index.lastMemoryUpdateTs = new Date().toISOString();
    }

    writeJson(indexPath, index);

    console.log('[MEMORY_KEEPER] Timestamp updated:', index.lastMemoryUpdateTs);
    return true;
  } catch (e) {
    console.error('[MEMORY_KEEPER] Failed to update timestamp:', e.message);
    return false;
  }
}

// Delete temp file (only if memory.md was physically updated since delta creation)
function cleanupDeltaTemp() {
  try {
    const projectDir = getProjectDir();
    const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
    const indexPath = path.join(memoryDir, INDEX_FILE);
    const deltaPath = path.join(memoryDir, DELTA_TEMP_FILE);
    const memoryPath = path.join(memoryDir, MEMORY_FILE);

    if (!fs.existsSync(deltaPath)) {
      console.log('[MEMORY_KEEPER] No delta temp file to clean');
      return true;
    }

    // Verify memory.md was physically updated since delta was created
    const index = readIndexSafe(indexPath);
    const deltaCreatedMtime = index.deltaCreatedAtMemoryMtime || 0;
    const currentMemoryMtime = fs.existsSync(memoryPath) ? fs.statSync(memoryPath).mtimeMs : 0;

    if (currentMemoryMtime <= deltaCreatedMtime) {
      console.error('[MEMORY_KEEPER] BLOCKED: memory.md not updated since delta creation. Write to memory.md first!');
      return false;
    }

    fs.unlinkSync(deltaPath);

    // Clear deltaReady flag so inject-rules.js stops triggering
    index.deltaReady = false;
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

    console.log('[MEMORY_KEEPER] Delta temp file cleaned up');
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
