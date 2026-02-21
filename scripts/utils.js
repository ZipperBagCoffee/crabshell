const fs = require('fs');
const path = require('path');
const os = require('os');
const { INDEX_FILE, MEMORY_FILE, LOCK_FILE, LOCK_STALE_MS } = require('./constants');

function getProjectName() { return path.basename(process.cwd()); }

function getProjectDir() {
  if (process.env.PROJECT_DIR) return process.env.PROJECT_DIR;
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.claude'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function getMemoryDir() { return path.join(getProjectDir(), '.claude', 'memory'); }

const MEMORY_ROOT = path.join(os.homedir(), '.claude', 'memory-keeper', 'projects');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readFileOrDefault(filePath, defaultValue) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return defaultValue; }
}

function readJsonOrDefault(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return defaultValue; }
}

// Default memory-index.json structure - prevents field loss on parse errors
function getDefaultIndex() {
  return {
    version: 1,
    current: MEMORY_FILE,
    rotatedFiles: [],
    stats: { totalRotations: 0, lastRotation: null },
    counter: 0,
    lastMemoryUpdateTs: null
  };
}

// Safe index reader - ALWAYS returns complete structure, preserving existing values
// Uses spread to auto-preserve new optional fields (deltaReady, pendingLastProcessedTs, etc.)
function readIndexSafe(indexPath) {
  const defaults = getDefaultIndex();
  try {
    if (!fs.existsSync(indexPath)) return defaults;
    const existing = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return {
      ...defaults,
      ...existing,
      // Array/object fields need safe validation
      rotatedFiles: Array.isArray(existing.rotatedFiles) ? existing.rotatedFiles : defaults.rotatedFiles,
      stats: existing.stats ?? defaults.stats,
    };
  } catch {
    return defaults;
  }
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function getTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return now.getUTCFullYear() + '-' + pad(now.getUTCMonth()+1) + '-' + pad(now.getUTCDate()) + '_' + pad(now.getUTCHours()) + pad(now.getUTCMinutes());
}

function estimateTokens(text) { return Math.ceil(Buffer.byteLength(text, 'utf8') / 4); }
function estimateTokensFromFile(filePath) { return Math.ceil(fs.statSync(filePath).size / 4); }

function extractTailByTokens(content, targetTokens) {
  const lines = content.split('\n');
  let tokens = 0, startIndex = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    const lineTokens = estimateTokens(lines[i] + '\n');
    if (tokens + lineTokens > targetTokens) break;
    tokens += lineTokens; startIndex = i;
  }
  return lines.slice(startIndex).join('\n');
}

function updateIndex(archivePath, tokens, memoryDir, dateRange) {
  const indexPath = path.join(memoryDir, INDEX_FILE);
  const index = readIndexSafe(indexPath);  // Use safe reader to preserve all fields
  const entry = { file: path.basename(archivePath), rotatedAt: new Date().toISOString(), tokens, bytes: fs.statSync(archivePath).size, summary: path.basename(archivePath).replace('.md', '.summary.json'), summaryGenerated: false };
  if (dateRange) entry.dateRange = dateRange;
  index.rotatedFiles.push(entry);
  index.stats.totalRotations++;
  index.stats.lastRotation = new Date().toISOString();
  const tempPath = indexPath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(index, null, 2));
  fs.renameSync(tempPath, indexPath);
}

function acquireLock(memoryDir) {
  const lockPath = path.join(memoryDir, LOCK_FILE);
  try { fs.writeFileSync(lockPath, process.pid.toString(), { flag: 'wx' }); return true; }
  catch (e) { try { if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lockPath); return acquireLock(memoryDir); } } catch {} return false; }
}

function releaseLock(memoryDir) { try { fs.unlinkSync(path.join(memoryDir, LOCK_FILE)); } catch {} }

module.exports = { MEMORY_ROOT, getProjectName, getProjectDir, getMemoryDir, ensureDir, readFileOrDefault, readJsonOrDefault, getDefaultIndex, readIndexSafe, writeFile, writeJson, getTimestamp, estimateTokens, estimateTokensFromFile, extractTailByTokens, updateIndex, acquireLock, releaseLock };
