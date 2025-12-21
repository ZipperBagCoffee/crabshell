const path = require('path');
const fs = require('fs');
const { getProjectDir, getProjectName, readFileOrDefault, writeFile, readJsonOrDefault, ensureDir, getTimestamp } = require('./utils');
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
    const scriptPath = process.argv[1].replace(/\\/g, '/');
    const timestamp = getTimestamp();

    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `[MEMORY_KEEPER_SAVE] ${counter} tool uses reached. Execute memory save:

1. Spawn background agent:
   Task tool with subagent_type: "general-purpose", run_in_background: false
   Prompt: "Analyze this session and return JSON only (no markdown):
   {
     \\"summary\\": \\"200 char session summary\\",
     \\"decisions\\": [{\\"content\\": \\"decision\\", \\"reason\\": \\"why\\"}],
     \\"patterns\\": [{\\"content\\": \\"pattern found\\"}],
     \\"issues\\": [{\\"content\\": \\"issue\\", \\"status\\": \\"open\\"}]
   }"

2. After agent returns, save files using Bash:
   - Append summary to ${projectDir}/memory.md
   - Update ${projectDir}/facts.json with decisions/patterns/issues
   - Save summary to ${projectDir}/sessions/${timestamp}.md
   - Save raw conversation to ${projectDir}/sessions/${timestamp}.raw.md

3. Reset counter: node "${scriptPath}" reset`
      }
    };
    console.log(JSON.stringify(output));
  }
}

function final() {
  const projectName = getProjectName();
  const projectDir = getProjectDir().replace(/\\/g, '/');
  const timestamp = getTimestamp();

  const output = {
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: `[MEMORY_KEEPER_FINAL] Session ending. Execute final save:

1. Spawn background agent for final summary:
   Task tool with subagent_type: "general-purpose"
   Prompt: "Create final session summary. Return JSON only:
   {
     \\"summary\\": \\"300 char complete session summary\\",
     \\"decisions\\": [{\\"content\\": \\"decision\\", \\"reason\\": \\"why\\"}],
     \\"patterns\\": [{\\"content\\": \\"pattern found\\"}],
     \\"issues\\": [{\\"content\\": \\"issue\\", \\"status\\": \\"open|resolved\\"}]
   }"

2. Save all files to ${projectDir}/

3. Run tier compression: node "${process.argv[1].replace(/\\/g, '/')}" compress`
    }
  };
  console.log(JSON.stringify(output));

  setCounter(0);
}

function reset() {
  setCounter(0);
  console.log('[MEMORY_KEEPER] Counter reset.');
}

function compress() {
  const projectDir = getProjectDir();
  const sessionsDir = path.join(projectDir, 'sessions');

  // Ensure sessions directory exists
  ensureDir(sessionsDir);

  const now = new Date();
  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.md') && !f.includes('week-') && !f.startsWith('archive'));

  // Group files by age
  files.forEach(file => {
    const match = file.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return;

    const fileDate = new Date(match[1], match[2] - 1, match[3]);
    const daysOld = Math.floor((now - fileDate) / (1000 * 60 * 60 * 24));

    if (daysOld > 30) {
      // Move to archive
      const archiveDir = path.join(sessionsDir, 'archive');
      ensureDir(archiveDir);
      const archiveFile = path.join(archiveDir, `${match[1]}-${match[2]}.md`);
      const content = readFileOrDefault(path.join(sessionsDir, file), '');
      fs.appendFileSync(archiveFile, `\n\n---\n\n${content}`);
      fs.unlinkSync(path.join(sessionsDir, file));
      console.log(`[MEMORY_KEEPER] Archived: ${file}`);
    }
  });

  console.log('[MEMORY_KEEPER] Compression complete.');
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
  case 'compress':
    compress();
    break;
  default:
    console.log('Usage: counter.js [check|final|reset|compress]');
}
