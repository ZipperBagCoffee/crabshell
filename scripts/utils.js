const fs = require('fs');
const path = require('path');
const os = require('os');

// Store in project-local .claude/memory/ instead of global ~/.claude/memory-keeper/
function getProjectName() {
  return path.basename(process.cwd());
}

function getProjectDir() {
  // Project-local storage: .claude/memory/
  return path.join(process.cwd(), '.claude', 'memory');
}

// Legacy: global storage path (for migration if needed)
const MEMORY_ROOT = path.join(os.homedir(), '.claude', 'memory-keeper', 'projects');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readFileOrDefault(filePath, defaultValue) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return defaultValue;
  }
}

function readJsonOrDefault(filePath, defaultValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, data) {
  writeFile(filePath, JSON.stringify(data, null, 2));
}

function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}_${hour}${min}`;
}

function getFactsPath() {
  return path.join(getProjectDir(), 'facts.json');
}

function loadFacts() {
  return readJsonOrDefault(getFactsPath(), {
    decisions: [],
    patterns: [],
    issues: []
  });
}

function saveFacts(facts) {
  writeJson(getFactsPath(), facts);
}

function appendFacts(newFacts) {
  const facts = loadFacts();
  const timestamp = getTimestamp();

  if (newFacts.decisions) {
    newFacts.decisions.forEach((d, i) => {
      facts.decisions.push({
        id: `d${String(facts.decisions.length + 1).padStart(3, '0')}`,
        date: timestamp.split('_')[0],
        content: d.content,
        reason: d.reason || '',
        session: timestamp
      });
    });
  }

  if (newFacts.patterns) {
    newFacts.patterns.forEach(p => {
      facts.patterns.push({
        id: `p${String(facts.patterns.length + 1).padStart(3, '0')}`,
        date: timestamp.split('_')[0],
        content: p.content
      });
    });
  }

  if (newFacts.issues) {
    newFacts.issues.forEach(i => {
      facts.issues.push({
        id: `i${String(facts.issues.length + 1).padStart(3, '0')}`,
        date: timestamp.split('_')[0],
        content: i.content,
        status: i.status || 'open',
        resolution: i.resolution || ''
      });
    });
  }

  saveFacts(facts);
}

module.exports = {
  MEMORY_ROOT,
  getProjectName,
  getProjectDir,
  ensureDir,
  readFileOrDefault,
  readJsonOrDefault,
  writeFile,
  writeJson,
  getTimestamp,
  getFactsPath,
  loadFacts,
  saveFacts,
  appendFacts
};
