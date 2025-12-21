const fs = require('fs');
const path = require('path');
const os = require('os');

const MEMORY_ROOT = path.join(os.homedir(), '.claude', 'memory-keeper', 'projects');

function getProjectName() {
  return path.basename(process.cwd());
}

function getProjectDir() {
  const projectName = getProjectName();
  return path.join(MEMORY_ROOT, projectName);
}

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

module.exports = {
  MEMORY_ROOT,
  getProjectName,
  getProjectDir,
  ensureDir,
  readFileOrDefault,
  readJsonOrDefault,
  writeFile,
  writeJson,
  getTimestamp
};
