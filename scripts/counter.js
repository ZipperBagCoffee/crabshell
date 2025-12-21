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

// Read hook data from stdin using async/await
function readStdin() {
  return new Promise((resolve) => {
    let data = '';

    // Set encoding
    process.stdin.setEncoding('utf8');

    // Handle data chunks
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });

    // Handle end of input
    process.stdin.on('end', () => {
      if (data.trim()) {
        try {
          resolve(JSON.parse(data.trim()));
        } catch (e) {
          // Log parse error
          const debugPath = path.join(getProjectDir(), 'stdin-parse-error.log');
          fs.appendFileSync(debugPath, `${new Date().toISOString()}: ${e.message}\nData: ${data.substring(0, 500)}\n`);
          resolve({});
        }
      } else {
        resolve({});
      }
    });

    // Handle error
    process.stdin.on('error', (e) => {
      const debugPath = path.join(getProjectDir(), 'stdin-error.log');
      fs.appendFileSync(debugPath, `${new Date().toISOString()}: ${e.message}\n`);
      resolve({});
    });

    // Resume stdin (important for piped input)
    process.stdin.resume();
  });
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

4. ADD FACTS (run for each fact found):
   \`\`\`bash
   node "${scriptPath}" add-decision "decision content" "reason"
   node "${scriptPath}" add-pattern "pattern content"
   node "${scriptPath}" add-issue "issue content" "open|resolved"
   \`\`\`

(Counter auto-resets after this message - no manual reset needed)

DO NOT SKIP STEPS 1-4. Execute them immediately before continuing.
═══════════════════════════════════════════════════════════════`;

    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: instructions
      }
    };
    console.log(JSON.stringify(output));

    // Auto-reset counter after trigger to prevent duplicate triggers
    setCounter(0);
  }
}

async function final() {
  const hookData = await readStdin();
  const projectDir = getProjectDir().replace(/\\/g, '/');
  const timestamp = getTimestamp();
  const sessionsDir = path.join(getProjectDir(), 'sessions');

  ensureDir(sessionsDir);

  // Debug: log what we received
  const debugPath = path.join(getProjectDir(), 'debug-hook.json');
  writeJson(debugPath, {
    hookData,
    timestamp,
    hasTranscript: !!hookData.transcript_path,
    transcriptPath: hookData.transcript_path || null,
    sessionId: hookData.session_id || null
  });

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
    // Try to find transcript using session_id if available
    if (hookData.session_id) {
      const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
      try {
        if (fs.existsSync(claudeProjectsDir)) {
          const projects = fs.readdirSync(claudeProjectsDir);
          for (const proj of projects) {
            const projPath = path.join(claudeProjectsDir, proj);
            const transcriptFile = path.join(projPath, `${hookData.session_id}.jsonl`);
            if (fs.existsSync(transcriptFile)) {
              const rawDest = path.join(sessionsDir, `${timestamp}.raw.jsonl`);
              fs.copyFileSync(transcriptFile, rawDest);
              rawSaved = rawDest.replace(/\\/g, '/');
              break;
            }
          }
        }
      } catch (e) {
        fs.appendFileSync(path.join(getProjectDir(), 'error.log'),
          `${timestamp}: Failed to find transcript by session_id: ${e.message}\n`);
      }
    }

    // Fallback: find by project name and most recent file
    if (!rawSaved) {
      const projectName = getProjectName();
      const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

      try {
        if (fs.existsSync(claudeProjectsDir)) {
          const projects = fs.readdirSync(claudeProjectsDir);
          for (const proj of projects) {
            if (proj.includes(projectName)) {
              const projPath = path.join(claudeProjectsDir, proj);
              const files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
              if (files.length > 0) {
                // Get most recent by modification time
                const fileStats = files.map(f => ({
                  name: f,
                  mtime: fs.statSync(path.join(projPath, f)).mtime
                }));
                fileStats.sort((a, b) => b.mtime - a.mtime);
                const srcPath = path.join(projPath, fileStats[0].name);
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

4. ADD ALL FACTS (run for each fact found):
   \`\`\`bash
   node "${scriptPath}" add-decision "decision content" "reason"
   node "${scriptPath}" add-pattern "pattern content"
   node "${scriptPath}" add-issue "issue content" "open|resolved"
   \`\`\`

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

// Add fact commands - Claude calls these instead of editing JSON
function addDecision(content, reason) {
  const facts = loadFacts();
  const date = new Date().toISOString().split('T')[0];
  const id = `d${String(facts.decisions.length + 1).padStart(3, '0')}`;
  facts.decisions.push({ id, date, content, reason: reason || '' });
  saveFacts(facts);
  console.log(`[MEMORY_KEEPER] Added decision: ${id}`);
}

function addPattern(content) {
  const facts = loadFacts();
  const date = new Date().toISOString().split('T')[0];
  const id = `p${String(facts.patterns.length + 1).padStart(3, '0')}`;
  facts.patterns.push({ id, date, content });
  saveFacts(facts);
  console.log(`[MEMORY_KEEPER] Added pattern: ${id}`);
}

function addIssue(content, status) {
  const facts = loadFacts();
  const date = new Date().toISOString().split('T')[0];
  const id = `i${String(facts.issues.length + 1).padStart(3, '0')}`;
  facts.issues.push({ id, date, content, status: status || 'open' });
  saveFacts(facts);
  console.log(`[MEMORY_KEEPER] Added issue: ${id}`);
}

// Search facts.json for keyword
function search(query) {
  if (!query) {
    // Show summary
    const facts = loadFacts();
    const projectDir = getProjectDir();
    const sessionsDir = path.join(projectDir, 'sessions');

    let sessionCount = 0;
    try {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.md'));
      sessionCount = files.length;
    } catch (e) {}

    console.log(`[MEMORY_KEEPER] Memory Summary:`);
    console.log(`  Decisions: ${facts.decisions.length}`);
    console.log(`  Patterns: ${facts.patterns.length}`);
    console.log(`  Issues: ${facts.issues.length}`);
    console.log(`  Sessions: ${sessionCount}`);
    return;
  }

  const facts = loadFacts();
  const queryLower = query.toLowerCase();
  let found = false;

  // Search decisions
  facts.decisions.forEach(d => {
    if (d.content.toLowerCase().includes(queryLower) ||
        (d.reason && d.reason.toLowerCase().includes(queryLower))) {
      console.log(`[DECISION ${d.id}] ${d.date}: ${d.content}`);
      if (d.reason) console.log(`  Reason: ${d.reason}`);
      found = true;
    }
  });

  // Search patterns
  facts.patterns.forEach(p => {
    if (p.content.toLowerCase().includes(queryLower)) {
      console.log(`[PATTERN ${p.id}] ${p.date}: ${p.content}`);
      found = true;
    }
  });

  // Search issues
  facts.issues.forEach(i => {
    if (i.content.toLowerCase().includes(queryLower)) {
      console.log(`[ISSUE ${i.id}] ${i.date}: ${i.content} (${i.status})`);
      found = true;
    }
  });

  if (!found) {
    console.log(`[MEMORY_KEEPER] No matches in facts.json for: ${query}`);
  }
}

// Clear facts arrays (keep _meta)
function clearFacts() {
  const facts = loadFacts();
  facts.decisions = [];
  facts.patterns = [];
  facts.issues = [];
  saveFacts(facts);
  console.log('[MEMORY_KEEPER] Facts cleared (kept _meta).');
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

// Main - handle async commands
const command = process.argv[2];

switch (command) {
  case 'check':
    check();
    break;
  case 'final':
    final().catch(e => {
      console.error(`[MEMORY_KEEPER] Final error: ${e.message}`);
      process.exit(1);
    });
    break;
  case 'reset':
    reset();
    break;
  case 'compress':
    compress();
    break;
  case 'add-decision':
    addDecision(process.argv[3], process.argv[4]);
    break;
  case 'add-pattern':
    addPattern(process.argv[3]);
    break;
  case 'add-issue':
    addIssue(process.argv[3], process.argv[4]);
    break;
  case 'search':
    search(process.argv[3]);
    break;
  case 'clear-facts':
    clearFacts();
    break;
  default:
    console.log('Usage: counter.js [check|final|reset|compress|add-decision|add-pattern|add-issue|search|clear-facts]');
}
