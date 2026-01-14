const fs = require('fs');
const path = require('path');
const { MEMORY_DIR, SESSIONS_DIR, LOGS_DIR, INDEX_FILE, MEMORY_FILE } = require('./constants');

function ensureMemoryStructure(projectDir) {
  const dirs = [MEMORY_DIR, SESSIONS_DIR, LOGS_DIR];

  for (const dir of dirs) {
    const fullPath = path.join(projectDir, '.claude', dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  const indexPath = path.join(projectDir, '.claude', MEMORY_DIR, INDEX_FILE);
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(indexPath, JSON.stringify({
      version: 1,
      current: MEMORY_FILE,
      rotatedFiles: [],
      stats: { totalRotations: 0, lastRotation: null }
    }, null, 2));
  }
}

module.exports = { ensureMemoryStructure };
