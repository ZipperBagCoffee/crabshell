const fs = require('fs');
const path = require('path');
const { estimateTokensFromFile, extractTailByTokens, updateIndex, acquireLock, releaseLock, getProjectDir } = require('./utils');
const { ROTATION_THRESHOLD_TOKENS, CARRYOVER_TOKENS, getTimestamp, MEMORY_DIR } = require('./constants');

const SAFETY_MARGIN = 0.95;

function checkAndRotate(memoryPath, config) {
  if (!fs.existsSync(memoryPath)) return null;
  
  const tokens = estimateTokensFromFile(memoryPath);
  const rawThreshold = config.memoryRotation?.thresholdTokens;
  const threshold = rawThreshold ? Math.floor(rawThreshold * SAFETY_MARGIN) : ROTATION_THRESHOLD_TOKENS;

  if (tokens < threshold) return null;

  const projectDir = getProjectDir();
  const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);

  if (!acquireLock(memoryDir)) {
    console.log('[MEMORY_KEEPER] Another rotation in progress, skipping');
    return null;
  }

  try {
    const timestamp = getTimestamp();
    const archiveName = 'memory_' + timestamp.replace(/-/g, '').replace('_', '_') + '.md';
    const archivePath = path.join(memoryDir, archiveName);

    fs.copyFileSync(memoryPath, archivePath);

    const rawCarryover = config.memoryRotation?.carryoverTokens;
    const carryoverTokens = rawCarryover ? Math.floor(rawCarryover * SAFETY_MARGIN) : CARRYOVER_TOKENS;
    const memoryContent = fs.readFileSync(memoryPath, 'utf8');
    const carryoverContent = extractTailByTokens(memoryContent, carryoverTokens);

    const tempPath = memoryPath + '.tmp';
    fs.writeFileSync(tempPath, carryoverContent);
    fs.renameSync(tempPath, memoryPath);

    updateIndex(archivePath, tokens, memoryDir);

    return {
      rotated: true,
      archiveFile: archiveName,
      tokens: tokens,
      hookOutput: '[MEMORY_KEEPER_ROTATE] file=' + archiveName
    };
  } finally {
    releaseLock(memoryDir);
  }
}

module.exports = { checkAndRotate };
