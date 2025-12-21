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

**EXECUTE THESE STEPS NOW:**

1. SAVE to memory.md:
   \`\`\`bash
   echo -e "\\n## ${timestamp}\\n[1-2 sentence summary]" >> "${projectDir}/memory.md"
   \`\`\`

2. SAVE session file (USE THIS EXACT FORMAT):
   \`\`\`bash
   cat > "${projectDir}/sessions/${timestamp}.md" << 'ENDSESSION'
# Session ${timestamp}

## Summary
[What was accomplished in 2-3 sentences]

## Decisions
- [architecture|technology|approach] Decision content: Reason why
- [architecture] Another decision: Its reason

## Patterns
- [convention|best-practice] Pattern description
- [convention] Another pattern

## Issues
- [bugfix|performance|security] Issue description: open|resolved
- [bugfix] Fixed something: resolved

ENDSESSION
   \`\`\`

   NOTE: <private>sensitive data</private> tags will be stripped from facts.json

3. EXTRACT facts from session file:
   \`\`\`bash
   node "${scriptPath}" extract-facts ${timestamp}
   \`\`\`

(Counter auto-resets after this message)

Execute steps 1-3 immediately.
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

**EXECUTE THESE STEPS NOW:**

1. SAVE to memory.md:
   \`\`\`bash
   echo -e "\\n## ${timestamp} (Session End)\\n[Complete session summary]" >> "${projectDir}/memory.md"
   \`\`\`

2. SAVE session file (USE THIS EXACT FORMAT):
   \`\`\`bash
   cat > "${projectDir}/sessions/${timestamp}.md" << 'ENDSESSION'
# Session ${timestamp}

## Summary
[Everything accomplished in this session - be thorough]

## Decisions
- [architecture|technology|approach] Decision content: Reason why
- [architecture] Another decision: Its reason

## Patterns
- [convention|best-practice] Pattern description
- [convention] Another pattern

## Issues
- [bugfix|performance|security] Issue description: open|resolved
- [bugfix] Fixed something: resolved

ENDSESSION
   \`\`\`

   NOTE: <private>sensitive data</private> tags will be stripped from facts.json

3. EXTRACT facts from session file:
   \`\`\`bash
   node "${scriptPath}" extract-facts ${timestamp}
   \`\`\`

4. RUN compression:
   \`\`\`bash
   node "${scriptPath}" compress
   \`\`\`

FINAL SAVE - Be thorough. Execute steps 1-4 now.
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

// Strip <private>...</private> content for privacy
function stripPrivate(text) {
  return text.replace(/<private>[\s\S]*?<\/private>/gi, '[PRIVATE]');
}

// Valid types for each category
const VALID_TYPES = {
  decisions: ['architecture', 'technology', 'approach', 'other'],
  patterns: ['convention', 'best-practice', 'anti-pattern', 'other'],
  issues: ['bugfix', 'performance', 'security', 'feature', 'other']
};

// Add fact commands - Claude calls these instead of editing JSON
function addDecision(content, reason, type) {
  const facts = loadFacts();
  const date = new Date().toISOString().split('T')[0];
  const id = `d${String(facts.decisions.length + 1).padStart(3, '0')}`;
  const factType = VALID_TYPES.decisions.includes(type) ? type : 'other';
  const cleanContent = stripPrivate(content);
  const cleanReason = stripPrivate(reason || '');
  facts.decisions.push({ id, type: factType, date, content: cleanContent, reason: cleanReason });
  saveFacts(facts);
  console.log(`[MEMORY_KEEPER] Added decision: ${id} (${factType})`);
}

function addPattern(content, type) {
  const facts = loadFacts();
  const date = new Date().toISOString().split('T')[0];
  const id = `p${String(facts.patterns.length + 1).padStart(3, '0')}`;
  const factType = VALID_TYPES.patterns.includes(type) ? type : 'other';
  const cleanContent = stripPrivate(content);
  facts.patterns.push({ id, type: factType, date, content: cleanContent });
  saveFacts(facts);
  console.log(`[MEMORY_KEEPER] Added pattern: ${id} (${factType})`);
}

function addIssue(content, status, type) {
  const facts = loadFacts();
  const date = new Date().toISOString().split('T')[0];
  const id = `i${String(facts.issues.length + 1).padStart(3, '0')}`;
  const factType = VALID_TYPES.issues.includes(type) ? type : 'other';
  const cleanContent = stripPrivate(content);
  facts.issues.push({ id, type: factType, date, content: cleanContent, status: status || 'open' });
  saveFacts(facts);
  console.log(`[MEMORY_KEEPER] Added issue: ${id} (${factType})`);
}

// Search facts.json for keyword with optional type filter
function search(query, typeFilter) {
  const facts = loadFacts();

  if (!query && !typeFilter) {
    // Show summary
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

    // Show type breakdown
    const decTypes = {};
    facts.decisions.forEach(d => { decTypes[d.type || 'other'] = (decTypes[d.type || 'other'] || 0) + 1; });
    if (Object.keys(decTypes).length > 0) {
      console.log(`  Decision types: ${Object.entries(decTypes).map(([k,v]) => `${k}(${v})`).join(', ')}`);
    }
    return;
  }

  const queryLower = query ? query.toLowerCase() : '';
  const typeLower = typeFilter ? typeFilter.toLowerCase() : null;
  let found = false;

  // Search decisions
  facts.decisions.forEach(d => {
    const typeMatch = !typeLower || (d.type || 'other') === typeLower;
    const textMatch = !query || d.content.toLowerCase().includes(queryLower) ||
        (d.reason && d.reason.toLowerCase().includes(queryLower));
    if (typeMatch && textMatch) {
      console.log(`[DECISION ${d.id}] [${d.type || 'other'}] ${d.date}: ${d.content}`);
      if (d.reason) console.log(`  Reason: ${d.reason}`);
      found = true;
    }
  });

  // Search patterns
  facts.patterns.forEach(p => {
    const typeMatch = !typeLower || (p.type || 'other') === typeLower;
    const textMatch = !query || p.content.toLowerCase().includes(queryLower);
    if (typeMatch && textMatch) {
      console.log(`[PATTERN ${p.id}] [${p.type || 'other'}] ${p.date}: ${p.content}`);
      found = true;
    }
  });

  // Search issues
  facts.issues.forEach(i => {
    const typeMatch = !typeLower || (i.type || 'other') === typeLower;
    const textMatch = !query || i.content.toLowerCase().includes(queryLower);
    if (typeMatch && textMatch) {
      console.log(`[ISSUE ${i.id}] [${i.type || 'other'}] ${i.date}: ${i.content} (${i.status})`);
      found = true;
    }
  });

  if (!found) {
    const filterMsg = typeLower ? ` with type=${typeLower}` : '';
    const queryMsg = query ? ` for: ${query}` : '';
    console.log(`[MEMORY_KEEPER] No matches${filterMsg}${queryMsg}`);
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

// Extract facts from a session file
function extractFacts(sessionFile) {
  const projectDir = getProjectDir();
  const sessionsDir = path.join(projectDir, 'sessions');

  let filePath;
  if (sessionFile) {
    // Specific file provided
    filePath = sessionFile.endsWith('.md')
      ? path.join(sessionsDir, sessionFile)
      : path.join(sessionsDir, `${sessionFile}.md`);
  } else {
    // Find most recent session file
    try {
      const files = fs.readdirSync(sessionsDir)
        .filter(f => f.endsWith('.md') && !f.includes('.raw.'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(sessionsDir, f)).mtime }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) {
        console.log('[MEMORY_KEEPER] No session files found.');
        return;
      }
      filePath = path.join(sessionsDir, files[0].name);
    } catch (e) {
      console.log(`[MEMORY_KEEPER] Error finding session files: ${e.message}`);
      return;
    }
  }

  if (!fs.existsSync(filePath)) {
    console.log(`[MEMORY_KEEPER] Session file not found: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  let extracted = { decisions: 0, patterns: 0, issues: 0 };

  // Parse ## Decisions section
  // Format: - [type] Content: Reason  OR  - Content: Reason (type defaults to 'other')
  const decisionsMatch = content.match(/## Decisions\s*([\s\S]*?)(?=##|$)/i);
  if (decisionsMatch) {
    const lines = decisionsMatch[1].trim().split('\n');
    lines.forEach(line => {
      // Try typed format first: - [architecture] Use hooks: Better state
      const typedMatch = line.match(/^-\s*\[(\w+(?:-\w+)?)\]\s*(.+?):\s*(.+)$/);
      if (typedMatch) {
        addDecision(typedMatch[2].trim(), typedMatch[3].trim(), typedMatch[1].toLowerCase());
        extracted.decisions++;
        return;
      }
      // Fallback to untyped: - Use hooks: Better state
      const match = line.match(/^-\s*(.+?):\s*(.+)$/);
      if (match && !match[1].startsWith('[')) {
        addDecision(match[1].trim(), match[2].trim(), 'other');
        extracted.decisions++;
      }
    });
  }

  // Parse ## Patterns section
  // Format: - [type] Pattern  OR  - Pattern (type defaults to 'other')
  const patternsMatch = content.match(/## Patterns\s*([\s\S]*?)(?=##|$)/i);
  if (patternsMatch) {
    const lines = patternsMatch[1].trim().split('\n');
    lines.forEach(line => {
      // Try typed format: - [convention] Always test first
      const typedMatch = line.match(/^-\s*\[(\w+(?:-\w+)?)\]\s*(.+)$/);
      if (typedMatch) {
        addPattern(typedMatch[2].trim(), typedMatch[1].toLowerCase());
        extracted.patterns++;
        return;
      }
      // Fallback to untyped
      const match = line.match(/^-\s*(.+)$/);
      if (match && !match[1].startsWith('[')) {
        addPattern(match[1].trim(), 'other');
        extracted.patterns++;
      }
    });
  }

  // Parse ## Issues section
  // Format: - [type] Issue: status  OR  - Issue: status (type defaults to 'other')
  const issuesMatch = content.match(/## Issues\s*([\s\S]*?)(?=##|$)/i);
  if (issuesMatch) {
    const lines = issuesMatch[1].trim().split('\n');
    lines.forEach(line => {
      // Try typed format: - [bugfix] Memory leak: resolved
      const typedMatch = line.match(/^-\s*\[(\w+(?:-\w+)?)\]\s*(.+?):\s*(open|resolved)$/i);
      if (typedMatch) {
        addIssue(typedMatch[2].trim(), typedMatch[3].toLowerCase(), typedMatch[1].toLowerCase());
        extracted.issues++;
        return;
      }
      // Fallback to untyped
      const match = line.match(/^-\s*(.+?):\s*(open|resolved)$/i);
      if (match && !match[1].startsWith('[')) {
        addIssue(match[1].trim(), match[2].toLowerCase(), 'other');
        extracted.issues++;
      }
    });
  }

  console.log(`[MEMORY_KEEPER] Extracted from ${path.basename(filePath)}:`);
  console.log(`  Decisions: ${extracted.decisions}, Patterns: ${extracted.patterns}, Issues: ${extracted.issues}`);
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

// Parse --type=value from arguments
function parseTypeArg(args) {
  for (const arg of args) {
    if (arg.startsWith('--type=')) {
      return arg.substring(7);
    }
  }
  return null;
}

// Main - handle async commands
const command = process.argv[2];
const args = process.argv.slice(3);

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
    // add-decision "content" "reason" [type]
    addDecision(args[0], args[1], args[2]);
    break;
  case 'add-pattern':
    // add-pattern "content" [type]
    addPattern(args[0], args[1]);
    break;
  case 'add-issue':
    // add-issue "content" "status" [type]
    addIssue(args[0], args[1], args[2]);
    break;
  case 'search':
    // search [query] [--type=value]
    {
      const typeFilter = parseTypeArg(args);
      const query = args.find(a => !a.startsWith('--')) || null;
      search(query, typeFilter);
    }
    break;
  case 'clear-facts':
    clearFacts();
    break;
  case 'extract-facts':
    extractFacts(args[0]);
    break;
  default:
    console.log(`Usage: counter.js <command>

Commands:
  check                  Increment counter, trigger save at interval
  final                  Session end handler (reads stdin for hook data)
  reset                  Reset counter to 0
  compress               Archive old session files (30+ days)

  add-decision <content> <reason> [type]
                         Add decision (types: architecture, technology, approach, other)
  add-pattern <content> [type]
                         Add pattern (types: convention, best-practice, anti-pattern, other)
  add-issue <content> <status> [type]
                         Add issue (types: bugfix, performance, security, feature, other)

  search [query] [--type=TYPE]
                         Search facts or show summary (no args)
  clear-facts            Clear all facts (keeps _meta)
  extract-facts [session]
                         Extract facts from session file
`);
}
