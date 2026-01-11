const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');

// Save L2 summaries to file
function saveL2(sessionId, summaries) {
  const sessionsDir = path.join(getProjectDir(), 'sessions');
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
