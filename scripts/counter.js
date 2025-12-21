const path = require('path');
const { getProjectDir, getProjectName, readFileOrDefault, writeFile, readJsonOrDefault, ensureDir } = require('./utils');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'memory-keeper', 'config.json');
const DEFAULT_INTERVAL = 5;

function getConfig() {
  return readJsonOrDefault(CONFIG_PATH, { saveInterval: DEFAULT_INTERVAL });
}

function getCounterPath() {
  return path.join(getProjectDir(), 'counter.txt');
}

function getCounter() {
  const counterPath = getCounterPath();
  const value = readFileOrDefault(counterPath, '0');
  return parseInt(value, 10) || 0;
}

function setCounter(value) {
  const counterPath = getCounterPath();
  ensureDir(path.dirname(counterPath));
  writeFile(counterPath, String(value));
}

function check() {
  const config = getConfig();
  const interval = config.saveInterval || DEFAULT_INTERVAL;

  let counter = getCounter();
  counter++;
  setCounter(counter);

  if (counter >= interval) {
    const projectDir = getProjectDir();
    const scriptPath = process.argv[1].replace(/\\/g, '/');

    // JSON output required for Claude to see hook output
    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `[MEMORY_KEEPER_SAVE] ${counter} tool uses reached. Memory save required.\n\nDo the following:\n1. Summarize this session's work in under 200 chars\n2. Save to ${projectDir.replace(/\\/g, '/')}/memory.md (Write tool)\n3. After saving, run: node "${scriptPath}" reset`
      }
    };
    console.log(JSON.stringify(output));
  }
}

function final() {
  const projectName = getProjectName();
  const projectDir = getProjectDir().replace(/\\/g, '/');
  const timestamp = new Date().toISOString();

  const output = {
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: `[MEMORY_KEEPER_FINAL] Session ending. Final memory save.\n\nDo the following:\n1. Summarize entire session in under 300 chars\n2. Save to ${projectDir}/memory.md\n\nFormat:\n# Project Memory: ${projectName}\n\n## Current State\n- Last updated: ${timestamp}\n- Status: [current status]\n\n## Recent Context\n[recent work summary]\n\n## Known Issues\n[known issues]`
    }
  };
  console.log(JSON.stringify(output));

  setCounter(0);
}

function reset() {
  setCounter(0);
  console.log('[MEMORY_KEEPER] Counter reset.');
}

// Main
const command = process.argv[2];

switch (command) {
  case 'check':
    check();
    break;
  case 'final':
    final();
    break;
  case 'reset':
    reset();
    break;
  default:
    console.log('Usage: counter.js [check|final|reset]');
}
