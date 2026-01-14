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

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, data) { writeFile(filePath, JSON.stringify(data, null, 2)); }

function getTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes());
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
  const index = readJsonOrDefault(indexPath, { version: 1, current: MEMORY_FILE, rotatedFiles: [], stats: { totalRotations: 0, lastRotation: null } });
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

function getFactsPath() { return path.join(getMemoryDir(), 'facts.json'); }
function loadFacts() { return readJsonOrDefault(getFactsPath(), { decisions: [], patterns: [], issues: [] }); }
function saveFacts(facts) { writeJson(getFactsPath(), facts); }

function appendFacts(newFacts) {
  const facts = loadFacts(); const timestamp = getTimestamp();
  if (newFacts.decisions) newFacts.decisions.forEach(d => { facts.decisions.push({ id: 'd' + String(facts.decisions.length + 1).padStart(3, '0'), date: timestamp.split('_')[0], content: d.content, reason: d.reason || '', session: timestamp }); });
  if (newFacts.patterns) newFacts.patterns.forEach(p => { facts.patterns.push({ id: 'p' + String(facts.patterns.length + 1).padStart(3, '0'), date: timestamp.split('_')[0], content: p.content }); });
  if (newFacts.issues) newFacts.issues.forEach(i => { facts.issues.push({ id: 'i' + String(facts.issues.length + 1).padStart(3, '0'), date: timestamp.split('_')[0], content: i.content, status: i.status || 'open', resolution: i.resolution || '' }); });
  saveFacts(facts);
}

module.exports = { MEMORY_ROOT, getProjectName, getProjectDir, getMemoryDir, ensureDir, readFileOrDefault, readJsonOrDefault, writeFile, writeJson, getTimestamp, estimateTokens, estimateTokensFromFile, extractTailByTokens, updateIndex, acquireLock, releaseLock, getFactsPath, loadFacts, saveFacts, appendFacts };
