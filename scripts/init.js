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

  // Create new or migrate old index structure
  let index = { version: 1, current: MEMORY_FILE, rotatedFiles: [], stats: { totalRotations: 0, lastRotation: null }, counter: 0 };

  if (fs.existsSync(indexPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      // Migrate: preserve counter, add missing fields
      index.counter = existing.counter || 0;
      index.rotatedFiles = Array.isArray(existing.rotatedFiles) ? existing.rotatedFiles : [];
      index.stats = existing.stats || { totalRotations: 0, lastRotation: null };
      index.current = existing.current || MEMORY_FILE;
      index.version = existing.version || 1;
    } catch (e) {
      // Parse error - use defaults
    }
  }

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

module.exports = { ensureMemoryStructure };
