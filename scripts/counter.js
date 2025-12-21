const path = require('path');
const fs = require('fs');
const { getProjectDir, getProjectName, readFileOrDefault, writeFile, readJsonOrDefault, writeJson, ensureDir, getTimestamp } = require('./utils');
const os = require('os');

const CONFIG_PATH = path.join(process.cwd(), '.claude', 'memory', 'config.json');
const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.claude', 'memory-keeper', 'config.json');
const DEFAULT_INTERVAL = 5;

function getConfig() {
  let config = readJsonOrDefault(CONFIG_PATH, null);
  if (!config) {
    config = readJsonOrDefault(GLOBAL_CONFIG_PATH, { saveInterval: DEFAULT_INTERVAL });
  }
  return config;
}

// Read hook data from stdin
function readStdin() {
  try {
    // Try reading from stdin synchronously
    const chunks = [];
    const BUFSIZE = 256;
    let buf = Buffer.alloc(BUFSIZE);
    let bytesRead;

    const fd = fs.openSync(0, 'r');
    while ((bytesRead = fs.readSync(fd, buf, 0, BUFSIZE)) > 0) {
      chunks.push(buf.slice(0, bytesRead));
    }
    fs.closeSync(fd);

    const data = Buffer.concat(chunks).toString('utf8').trim();
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    // Fallback: check environment variable
    if (process.env.CLAUDE_HOOK_DATA) {
      try {
        return JSON.parse(process.env.CLAUDE_HOOK_DATA);
      } catch {}
    }
  }
  return {};
}

// Get facts.json path and ensure it exists
function getFactsPath() {
  return path.join(getProjectDir(), 'facts.json');
}

function loadFacts() {
  const factsPath = getFactsPath();
  ensureDir(path.dirname(factsPath));

  const defaultFacts = {
    _meta: { counter: 0, lastSave: null },
    decisions: [],
    patterns: [],
    issues: []
  };

  let facts = readJsonOrDefault(factsPath, null);
  if (!facts) {
    // Create facts.json if doesn't exist
    writeJson(factsPath, defaultFacts);
    return defaultFacts;
  }

  // Ensure _meta exists
  if (!facts._meta) {
    facts._meta = { counter: 0, lastSave: null };
  }

  return facts;
}

function saveFacts(facts) {
  writeJson(getFactsPath(), facts);
}

// Counter stored in facts.json._meta.counter
function getCounter() {
  const facts = loadFacts();
  return facts._meta.counter || 0;
}

function setCounter(value) {
  const facts = loadFacts();
  facts._meta.counter = value;
  saveFacts(facts);
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

    const instructions = `
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER] AUTO-SAVE TRIGGERED - ${counter} tool uses reached
═══════════════════════════════════════════════════════════════

**YOU MUST EXECUTE THESE STEPS NOW:**

1. ANALYZE this session - identify:
   - What was accomplished (2-3 sentences)
   - Key decisions made (if any)
   - Patterns discovered (if any)
   - Issues found (if any)

2. SAVE to memory.md:
   \`\`\`bash
   echo -e "\\n## ${timestamp}\\n[Your summary here]" >> "${projectDir}/memory.md"
   \`\`\`

3. SAVE session file:
   \`\`\`bash
   echo "[Full session summary]" > "${projectDir}/sessions/${timestamp}.md"
   \`\`\`

4. UPDATE facts.json (if decisions/patterns/issues found):
   - Read: ${projectDir}/facts.json
   - Append new items to appropriate arrays
   - Write back

5. RESET counter:
   \`\`\`bash
   node "${scriptPath}" reset
   \`\`\`

DO NOT SKIP THESE STEPS. Execute them immediately before continuing.
═══════════════════════════════════════════════════════════════`;

    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: instructions
      }
    };
    console.log(JSON.stringify(output));
  }
}

function final() {
  const hookData = readStdin();
  const projectDir = getProjectDir().replace(/\\/g, '/');
  const timestamp = getTimestamp();
  const sessionsDir = path.join(getProjectDir(), 'sessions');

  ensureDir(sessionsDir);

  // Debug: log what we received
  const debugPath = path.join(getProjectDir(), 'debug-hook.json');
  writeJson(debugPath, { hookData, timestamp, hasTranscript: !!hookData.transcript_path });

  // Copy raw transcript if available
  let rawSaved = '';
  if (hookData.transcript_path && hookData.transcript_path !== '') {
    try {
      const rawDest = path.join(sessionsDir, `${timestamp}.raw.jsonl`);
      fs.copyFileSync(hookData.transcript_path, rawDest);
      rawSaved = rawDest.replace(/\\/g, '/');
    } catch (e) {
      // Log error
      fs.appendFileSync(path.join(getProjectDir(), 'error.log'),
        `${timestamp}: Failed to copy transcript: ${e.message}\n`);
    }
  } else {
    // Try to find transcript in default location
    const projectName = getProjectName();
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

    try {
      // Look for session files
      if (fs.existsSync(claudeProjectsDir)) {
        const projects = fs.readdirSync(claudeProjectsDir);
        for (const proj of projects) {
          if (proj.includes(projectName)) {
            const projPath = path.join(claudeProjectsDir, proj);
            const files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
            if (files.length > 0) {
              // Get most recent
              const sorted = files.sort().reverse();
              const srcPath = path.join(projPath, sorted[0]);
              const rawDest = path.join(sessionsDir, `${timestamp}.raw.jsonl`);
              fs.copyFileSync(srcPath, rawDest);
              rawSaved = rawDest.replace(/\\/g, '/');
              break;
            }
          }
        }
      }
    } catch (e) {
      fs.appendFileSync(path.join(getProjectDir(), 'error.log'),
        `${timestamp}: Failed to find transcript: ${e.message}\n`);
    }
  }

  const scriptPath = process.argv[1].replace(/\\/g, '/');

  const instructions = `
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER] SESSION ENDING - Final Save Required
═══════════════════════════════════════════════════════════════
${rawSaved ? `✓ Raw transcript saved: ${rawSaved}` : '⚠ Raw transcript not saved (check debug-hook.json)'}

**YOU MUST EXECUTE THESE STEPS NOW:**

1. ANALYZE the COMPLETE session - identify:
   - Everything accomplished in this session
   - All key decisions made and why
   - All patterns/conventions discovered
   - All issues found (resolved or open)

2. SAVE comprehensive summary to memory.md:
   \`\`\`bash
   echo -e "\\n## ${timestamp} (Session End)\\n[Complete session summary]" >> "${projectDir}/memory.md"
   \`\`\`

3. SAVE detailed session file:
   \`\`\`bash
   echo "[Detailed session summary with all context]" > "${projectDir}/sessions/${timestamp}.md"
   \`\`\`

4. UPDATE facts.json with ALL session learnings:
   - Read: ${projectDir}/facts.json
   - Add all decisions to decisions array
   - Add all patterns to patterns array
   - Add all issues to issues array
   - Write back

5. RUN compression (archives old files):
   \`\`\`bash
   node "${scriptPath}" compress
   \`\`\`

This is the FINAL save. Be thorough and complete.
═══════════════════════════════════════════════════════════════`;

  const output = {
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: instructions
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

  ensureDir(sessionsDir);

  const now = new Date();

  try {
    const files = fs.readdirSync(sessionsDir).filter(f =>
      f.endsWith('.md') && !f.includes('week-') && !f.startsWith('archive')
    );

    files.forEach(file => {
      const match = file.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!match) return;

      const fileDate = new Date(match[1], match[2] - 1, match[3]);
      const daysOld = Math.floor((now - fileDate) / (1000 * 60 * 60 * 24));

      if (daysOld > 30) {
        const archiveDir = path.join(sessionsDir, 'archive');
        ensureDir(archiveDir);
        const archiveFile = path.join(archiveDir, `${match[1]}-${match[2]}.md`);
        const content = readFileOrDefault(path.join(sessionsDir, file), '');
        fs.appendFileSync(archiveFile, `\n\n---\n\n${content}`);
        fs.unlinkSync(path.join(sessionsDir, file));
        console.log(`[MEMORY_KEEPER] Archived: ${file}`);
      }
    });
  } catch (e) {
    console.log(`[MEMORY_KEEPER] Compress error: ${e.message}`);
  }

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
