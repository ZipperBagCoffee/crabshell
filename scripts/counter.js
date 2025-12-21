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
    const projectDir = getProjectDir().replace(/\\/g, '/');
    const memoryPath = `${projectDir}/memory.md`;
    const scriptPath = process.argv[1].replace(/\\/g, '/');

    // JSON output required for Claude to see hook output
    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `[MEMORY_KEEPER_SAVE] ${counter} tool uses. Save memory now.\n\nUse Bash to save (NOT Write tool):\necho "# Session Summary\\n\\n$(date): [your 200 char summary here]" >> "${memoryPath}"\n\nThen reset counter:\nnode "${scriptPath}" reset`
      }
    };
    console.log(JSON.stringify(output));
  }
}

function final() {
  const projectName = getProjectName();
  const projectDir = getProjectDir().replace(/\\/g, '/');
  const memoryPath = `${projectDir}/memory.md`;
  const timestamp = new Date().toISOString();

  const output = {
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: `[MEMORY_KEEPER_FINAL] Session end. Save memory using Bash:\n\necho "# ${projectName}\\n\\nUpdated: ${timestamp}\\n\\n## Summary\\n[300 char summary]\\n\\n## Status\\n[current status]" > "${memoryPath}"`
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
