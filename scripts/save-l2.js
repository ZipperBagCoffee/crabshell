const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, writeJson, readFileOrDefault, writeFile, ensureDir } = require('./utils');

// Format L2 data for memory.md
function formatL2ForMemory(l2Data, sessionId) {
  const lines = [`## ${sessionId}`];

  for (const ex of l2Data.exchanges || []) {
    lines.push(`- ${ex.summary || 'No summary'}`);
    if (ex.keywords?.length > 0) {
      lines.push(`  - Keywords: ${ex.keywords.join(', ')}`);
    }
    if (ex.files?.length > 0) {
      lines.push(`  - Files: ${ex.files.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// Update memory.md with L2 summary
function updateMemoryMd(l2Data, sessionId) {
  const memoryPath = path.join(getProjectDir(), 'memory.md');
  ensureDir(path.dirname(memoryPath));

  const existing = readFileOrDefault(memoryPath, '');
  const newEntry = formatL2ForMemory(l2Data, sessionId);

  // Append new entry
  const updated = existing.trim() + '\n\n' + newEntry + '\n';
  writeFile(memoryPath, updated);
}

// Save L2 summaries to file
function saveL2(sessionId, summaries) {
  const sessionsDir = path.join(getProjectDir(), 'sessions');
  ensureDir(sessionsDir);
  const l2Path = path.join(sessionsDir, `${sessionId}.l2.json`);

  // Validate summaries structure
  if (!Array.isArray(summaries)) {
    throw new Error('Summaries must be an array');
  }

  // Add metadata
  const l2Data = {
    sessionId,
    generated: new Date().toISOString(),
    exchanges: summaries
  };

  writeJson(l2Path, l2Data);

  // Also update memory.md (v9.0.0)
  try {
    updateMemoryMd(l2Data, sessionId);
  } catch (e) {
    // Don't fail if memory.md update fails
    console.error(`[MEMORY_KEEPER] Warning: Could not update memory.md: ${e.message}`);
  }

  // Auto-update concepts (v9.0.0 - L3)
  try {
    const { updateConcepts } = require('./update-concepts');
    updateConcepts(l2Data);
  } catch (e) {
    console.error(`[MEMORY_KEEPER] Warning: Could not update concepts: ${e.message}`);
  }

  // Auto-index keywords (v9.0.0 - L4)
  try {
    const { indexKeywords } = require('./keyword-index');
    for (const ex of l2Data.exchanges || []) {
      if (ex.keywords?.length > 0) {
        indexKeywords(ex.keywords, [sessionId, ex.id]);
      }
    }
  } catch (e) {
    console.error(`[MEMORY_KEEPER] Warning: Could not index keywords: ${e.message}`);
  }

  return l2Path;
}

// CLI: node save-l2.js <session-id> <json-string>
// Or: echo '<json>' | node save-l2.js <session-id>
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node save-l2.js <session-id> [json-string]');
    console.log('Or: echo \'<json>\' | node save-l2.js <session-id>');
    process.exit(1);
  }

  const sessionId = args[0];
  let jsonStr = args[1];

  // Read from stdin if no JSON provided
  if (!jsonStr) {
    jsonStr = fs.readFileSync(0, 'utf8');
  }

  try {
    const summaries = JSON.parse(jsonStr);
    const savedPath = saveL2(sessionId, summaries);
    console.log(`[MEMORY_KEEPER] L2 saved: ${savedPath}`);
    console.log(`[MEMORY_KEEPER] ${summaries.length} exchanges summarized`);
  } catch (e) {
    console.error(`[MEMORY_KEEPER] Error saving L2: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { saveL2 };
