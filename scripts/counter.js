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
    issues: [],
    concepts: {}
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

  // Ensure concepts index exists (v6.5.0+)
  if (!facts.concepts) {
    facts.concepts = {};
  }

  return facts;
}

// Update concepts index with fact ID
function updateConceptsIndex(facts, factId, conceptsList) {
  if (!conceptsList || conceptsList.length === 0) return;

  conceptsList.forEach(concept => {
    const c = concept.trim().toLowerCase();
    if (!c) return;
    if (!facts.concepts[c]) {
      facts.concepts[c] = [];
    }
    if (!facts.concepts[c].includes(factId)) {
      facts.concepts[c].push(factId);
    }
  });
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

**YOU MUST EXECUTE THESE COMMANDS NOW:**

1. APPEND to memory.md:
   \`\`\`bash
   echo -e "\\n## ${timestamp}\\n[1-2 sentence summary of work so far]" >> "${projectDir}/memory.md"
   \`\`\`

2. RECORD any decisions made (run for EACH decision):
   \`\`\`bash
   node "${scriptPath}" add-decision "what was decided" "why" "architecture|technology|approach"
   \`\`\`
   With file refs: add "file1.ts,file2.ts" "concept1,concept2" at end

3. RECORD any patterns established (run for EACH pattern):
   \`\`\`bash
   node "${scriptPath}" add-pattern "pattern description" "convention|best-practice|anti-pattern"
   \`\`\`

4. RECORD any issues found/fixed (run for EACH issue):
   \`\`\`bash
   node "${scriptPath}" add-issue "issue description" "open|resolved" "bugfix|performance|security|feature"
   \`\`\`

IMPORTANT:
- Run Step 1 ALWAYS
- Run Steps 2-4 for ALL relevant items from this session
- If no decisions/patterns/issues exist, skip those steps
- Files and concepts are OPTIONAL (omit if not applicable)

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
${rawSaved ? `✓ Raw transcript saved: ${rawSaved}` : '⚠ Raw transcript not saved'}

**YOU MUST EXECUTE THESE COMMANDS NOW:**

1. APPEND complete summary to memory.md:
   \`\`\`bash
   echo -e "\\n## ${timestamp} (Session End)\\n[Complete session summary - be thorough]" >> "${projectDir}/memory.md"
   \`\`\`

2. RECORD ALL decisions from this session:
   \`\`\`bash
   node "${scriptPath}" add-decision "what was decided" "why" "architecture|technology|approach"
   \`\`\`
   With file refs: add "file1.ts,file2.ts" "concept1,concept2" at end

3. RECORD ALL patterns from this session:
   \`\`\`bash
   node "${scriptPath}" add-pattern "pattern description" "convention|best-practice|anti-pattern"
   \`\`\`

4. RECORD ALL issues from this session:
   \`\`\`bash
   node "${scriptPath}" add-issue "issue description" "open|resolved" "bugfix|performance|security|feature"
   \`\`\`

5. RUN compression:
   \`\`\`bash
   node "${scriptPath}" compress
   \`\`\`

IMPORTANT:
- This is your FINAL chance to save context
- Review ENTIRE session for decisions/patterns/issues
- Be thorough - next session starts fresh
- Files and concepts are OPTIONAL

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

// Parse comma-separated list into array
function parseList(str) {
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

// Add fact commands - Claude calls these instead of editing JSON
function addDecision(content, reason, type, filesStr, conceptsStr) {
  const facts = loadFacts();
  const date = new Date().toISOString().split('T')[0];
  const id = `d${String(facts.decisions.length + 1).padStart(3, '0')}`;
  const factType = VALID_TYPES.decisions.includes(type) ? type : 'other';
  const cleanContent = stripPrivate(content);
  const cleanReason = stripPrivate(reason || '');
  const files = parseList(filesStr);
  const concepts = parseList(conceptsStr);

  const fact = { id, type: factType, date, content: cleanContent, reason: cleanReason };
  if (files.length > 0) fact.files = files;
  if (concepts.length > 0) fact.concepts = concepts;

  facts.decisions.push(fact);
  updateConceptsIndex(facts, id, concepts);
  saveFacts(facts);

  const extras = [];
  if (files.length > 0) extras.push(`${files.length} files`);
  if (concepts.length > 0) extras.push(`${concepts.length} concepts`);
  const extrasStr = extras.length > 0 ? ` [${extras.join(', ')}]` : '';
  console.log(`[MEMORY_KEEPER] Added decision: ${id} (${factType})${extrasStr}`);
}

function addPattern(content, type, filesStr, conceptsStr) {
  const facts = loadFacts();
  const date = new Date().toISOString().split('T')[0];
  const id = `p${String(facts.patterns.length + 1).padStart(3, '0')}`;
  const factType = VALID_TYPES.patterns.includes(type) ? type : 'other';
  const cleanContent = stripPrivate(content);
  const files = parseList(filesStr);
  const concepts = parseList(conceptsStr);

  const fact = { id, type: factType, date, content: cleanContent };
  if (files.length > 0) fact.files = files;
  if (concepts.length > 0) fact.concepts = concepts;

  facts.patterns.push(fact);
  updateConceptsIndex(facts, id, concepts);
  saveFacts(facts);

  const extras = [];
  if (files.length > 0) extras.push(`${files.length} files`);
  if (concepts.length > 0) extras.push(`${concepts.length} concepts`);
  const extrasStr = extras.length > 0 ? ` [${extras.join(', ')}]` : '';
  console.log(`[MEMORY_KEEPER] Added pattern: ${id} (${factType})${extrasStr}`);
}

function addIssue(content, status, type, filesStr, conceptsStr) {
  const facts = loadFacts();
  const date = new Date().toISOString().split('T')[0];
  const id = `i${String(facts.issues.length + 1).padStart(3, '0')}`;
  const factType = VALID_TYPES.issues.includes(type) ? type : 'other';
  const cleanContent = stripPrivate(content);
  const files = parseList(filesStr);
  const concepts = parseList(conceptsStr);

  const fact = { id, type: factType, date, content: cleanContent, status: status || 'open' };
  if (files.length > 0) fact.files = files;
  if (concepts.length > 0) fact.concepts = concepts;

  facts.issues.push(fact);
  updateConceptsIndex(facts, id, concepts);
  saveFacts(facts);

  const extras = [];
  if (files.length > 0) extras.push(`${files.length} files`);
  if (concepts.length > 0) extras.push(`${concepts.length} concepts`);
  const extrasStr = extras.length > 0 ? ` [${extras.join(', ')}]` : '';
  console.log(`[MEMORY_KEEPER] Added issue: ${id} (${factType})${extrasStr}`);
}

// Search facts.json for keyword with optional filters
function search(query, typeFilter, conceptFilter, fileFilter) {
  const facts = loadFacts();

  if (!query && !typeFilter && !conceptFilter && !fileFilter) {
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

    // Show concepts
    const conceptKeys = Object.keys(facts.concepts || {});
    if (conceptKeys.length > 0) {
      console.log(`  Concepts: ${conceptKeys.slice(0, 10).join(', ')}${conceptKeys.length > 10 ? '...' : ''}`);
    }
    return;
  }

  const queryLower = query ? query.toLowerCase() : '';
  const typeLower = typeFilter ? typeFilter.toLowerCase() : null;
  const conceptLower = conceptFilter ? conceptFilter.toLowerCase() : null;
  const fileLower = fileFilter ? fileFilter.toLowerCase() : null;
  let found = false;

  // Helper: check if fact matches file filter
  function matchesFile(fact) {
    if (!fileLower) return true;
    if (!fact.files || fact.files.length === 0) return false;
    return fact.files.some(f => f.toLowerCase().includes(fileLower));
  }

  // Helper: check if fact matches concept filter
  function matchesConcept(fact) {
    if (!conceptLower) return true;
    if (!fact.concepts || fact.concepts.length === 0) return false;
    return fact.concepts.some(c => c.toLowerCase() === conceptLower);
  }

  // Helper: format extras
  function formatExtras(fact) {
    const parts = [];
    if (fact.files && fact.files.length > 0) parts.push(`files: ${fact.files.join(', ')}`);
    if (fact.concepts && fact.concepts.length > 0) parts.push(`concepts: ${fact.concepts.join(', ')}`);
    return parts.length > 0 ? `\n  ${parts.join(' | ')}` : '';
  }

  // Search decisions
  facts.decisions.forEach(d => {
    const typeMatch = !typeLower || (d.type || 'other') === typeLower;
    const textMatch = !query || d.content.toLowerCase().includes(queryLower) ||
        (d.reason && d.reason.toLowerCase().includes(queryLower));
    if (typeMatch && textMatch && matchesFile(d) && matchesConcept(d)) {
      console.log(`[DECISION ${d.id}] [${d.type || 'other'}] ${d.date}: ${d.content}`);
      if (d.reason) console.log(`  Reason: ${d.reason}`);
      console.log(formatExtras(d));
      found = true;
    }
  });

  // Search patterns
  facts.patterns.forEach(p => {
    const typeMatch = !typeLower || (p.type || 'other') === typeLower;
    const textMatch = !query || p.content.toLowerCase().includes(queryLower);
    if (typeMatch && textMatch && matchesFile(p) && matchesConcept(p)) {
      console.log(`[PATTERN ${p.id}] [${p.type || 'other'}] ${p.date}: ${p.content}`);
      console.log(formatExtras(p));
      found = true;
    }
  });

  // Search issues
  facts.issues.forEach(i => {
    const typeMatch = !typeLower || (i.type || 'other') === typeLower;
    const textMatch = !query || i.content.toLowerCase().includes(queryLower);
    if (typeMatch && textMatch && matchesFile(i) && matchesConcept(i)) {
      console.log(`[ISSUE ${i.id}] [${i.type || 'other'}] ${i.date}: ${i.content} (${i.status})`);
      console.log(formatExtras(i));
      found = true;
    }
  });

  if (!found) {
    const filters = [];
    if (typeLower) filters.push(`type=${typeLower}`);
    if (conceptLower) filters.push(`concept=${conceptLower}`);
    if (fileLower) filters.push(`file=${fileLower}`);
    const filterMsg = filters.length > 0 ? ` with ${filters.join(', ')}` : '';
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
  facts.concepts = {};  // v7.0.1: Also clear concepts index
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

  // Helper: parse sub-items (files, concepts) following a main item
  function parseSubItems(lines, startIdx) {
    let files = '';
    let concepts = '';
    for (let i = startIdx + 1; i < lines.length; i++) {
      const subLine = lines[i];
      // Sub-items are indented (start with spaces and -)
      if (/^\s+-\s*(files|concepts):/i.test(subLine)) {
        const filesMatch = subLine.match(/^\s+-\s*files:\s*(.+)$/i);
        if (filesMatch) files = filesMatch[1].trim();
        const conceptsMatch = subLine.match(/^\s+-\s*concepts:\s*(.+)$/i);
        if (conceptsMatch) concepts = conceptsMatch[1].trim();
      } else if (/^-\s/.test(subLine) || /^##/.test(subLine)) {
        // Next main item or section
        break;
      }
    }
    return { files, concepts };
  }

  // Parse ## Decisions section
  const decisionsMatch = content.match(/## Decisions\s*([\s\S]*?)(?=##|$)/i);
  if (decisionsMatch) {
    const lines = decisionsMatch[1].trim().split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Try typed format first: - [architecture] Use hooks: Better state
      const typedMatch = line.match(/^-\s*\[(\w+(?:-\w+)?)\]\s*(.+?):\s*(.+)$/);
      if (typedMatch) {
        const { files, concepts } = parseSubItems(lines, i);
        addDecision(typedMatch[2].trim(), typedMatch[3].trim(), typedMatch[1].toLowerCase(), files, concepts);
        extracted.decisions++;
        continue;
      }
      // Fallback to untyped: - Use hooks: Better state
      const match = line.match(/^-\s*(.+?):\s*(.+)$/);
      if (match && !match[1].startsWith('[') && !/^\s/.test(line)) {
        const { files, concepts } = parseSubItems(lines, i);
        addDecision(match[1].trim(), match[2].trim(), 'other', files, concepts);
        extracted.decisions++;
      }
    }
  }

  // Parse ## Patterns section
  const patternsMatch = content.match(/## Patterns\s*([\s\S]*?)(?=##|$)/i);
  if (patternsMatch) {
    const lines = patternsMatch[1].trim().split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Try typed format: - [convention] Always test first
      const typedMatch = line.match(/^-\s*\[(\w+(?:-\w+)?)\]\s*(.+)$/);
      if (typedMatch) {
        const { files, concepts } = parseSubItems(lines, i);
        addPattern(typedMatch[2].trim(), typedMatch[1].toLowerCase(), files, concepts);
        extracted.patterns++;
        continue;
      }
      // Fallback to untyped
      const match = line.match(/^-\s*(.+)$/);
      if (match && !match[1].startsWith('[') && !/^\s/.test(line)) {
        const { files, concepts } = parseSubItems(lines, i);
        addPattern(match[1].trim(), 'other', files, concepts);
        extracted.patterns++;
      }
    }
  }

  // Parse ## Issues section
  const issuesMatch = content.match(/## Issues\s*([\s\S]*?)(?=##|$)/i);
  if (issuesMatch) {
    const lines = issuesMatch[1].trim().split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Try typed format: - [bugfix] Memory leak: resolved
      const typedMatch = line.match(/^-\s*\[(\w+(?:-\w+)?)\]\s*(.+?):\s*(open|resolved)$/i);
      if (typedMatch) {
        const { files, concepts } = parseSubItems(lines, i);
        addIssue(typedMatch[2].trim(), typedMatch[3].toLowerCase(), typedMatch[1].toLowerCase(), files, concepts);
        extracted.issues++;
        continue;
      }
      // Fallback to untyped
      const match = line.match(/^-\s*(.+?):\s*(open|resolved)$/i);
      if (match && !match[1].startsWith('[') && !/^\s/.test(line)) {
        const { files, concepts } = parseSubItems(lines, i);
        addIssue(match[1].trim(), match[2].toLowerCase(), 'other', files, concepts);
        extracted.issues++;
      }
    }
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

// Memory file management (v7.0.0)
const MEMORY_FILES = {
  project: { file: 'project.md', title: 'Project Overview' },
  architecture: { file: 'architecture.md', title: 'Architecture' },
  conventions: { file: 'conventions.md', title: 'Conventions' }
};

function memorySet(name, content) {
  if (!name) {
    console.log('[MEMORY_KEEPER] Error: memory name required');
    console.log('  Valid names: project, architecture, conventions');
    return;
  }

  const key = name.toLowerCase();
  const memConfig = MEMORY_FILES[key];

  if (!memConfig) {
    console.log(`[MEMORY_KEEPER] Unknown memory file: ${name}`);
    console.log('  Valid names: project, architecture, conventions');
    return;
  }

  if (!content) {
    console.log('[MEMORY_KEEPER] Error: content required');
    console.log(`  Usage: memory-set ${key} "Your content here"`);
    return;
  }

  const projectDir = getProjectDir();
  ensureDir(projectDir);
  const filePath = path.join(projectDir, memConfig.file);

  writeFile(filePath, content);
  console.log(`[MEMORY_KEEPER] Saved ${memConfig.title} to ${memConfig.file}`);
}

function memoryGet(name) {
  const projectDir = getProjectDir();

  if (!name) {
    // Show all memory files
    console.log('[MEMORY_KEEPER] Memory Files:');
    Object.entries(MEMORY_FILES).forEach(([key, config]) => {
      const filePath = path.join(projectDir, config.file);
      if (fs.existsSync(filePath)) {
        const content = readFileOrDefault(filePath, '').trim();
        const lines = content.split('\n').length;
        const preview = content.substring(0, 100).replace(/\n/g, ' ');
        console.log(`\n[${key}] ${config.title} (${lines} lines)`);
        console.log(`  ${preview}${content.length > 100 ? '...' : ''}`);
      } else {
        console.log(`\n[${key}] ${config.title} - not created`);
      }
    });
    return;
  }

  const key = name.toLowerCase();
  const memConfig = MEMORY_FILES[key];

  if (!memConfig) {
    console.log(`[MEMORY_KEEPER] Unknown memory file: ${name}`);
    console.log('  Valid names: project, architecture, conventions');
    return;
  }

  const filePath = path.join(projectDir, memConfig.file);
  if (!fs.existsSync(filePath)) {
    console.log(`[MEMORY_KEEPER] ${memConfig.title} not created yet.`);
    console.log(`  Create with: memory-set ${key} "content"`);
    return;
  }

  const content = readFileOrDefault(filePath, '');
  console.log(`[MEMORY_KEEPER] ${memConfig.title}:`);
  console.log('---');
  console.log(content);
  console.log('---');
}

function memoryList() {
  const projectDir = getProjectDir();
  console.log('[MEMORY_KEEPER] Memory Structure:');

  let total = 0;
  Object.entries(MEMORY_FILES).forEach(([key, config]) => {
    const filePath = path.join(projectDir, config.file);
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const content = readFileOrDefault(filePath, '');
      const lines = content.trim().split('\n').length;
      console.log(`  ✓ ${config.file} (${lines} lines, ${stats.size} bytes)`);
      total++;
    } else {
      console.log(`  ○ ${config.file} - not created`);
    }
  });

  // Also show memory.md (rolling)
  const memoryPath = path.join(projectDir, 'memory.md');
  if (fs.existsSync(memoryPath)) {
    const stats = fs.statSync(memoryPath);
    const content = readFileOrDefault(memoryPath, '');
    const lines = content.trim().split('\n').length;
    console.log(`  ✓ memory.md (${lines} lines, ${stats.size} bytes) [rolling]`);
  } else {
    console.log(`  ○ memory.md - not created [rolling]`);
  }

  // Show facts.json
  const factsPath = getFactsPath();
  if (fs.existsSync(factsPath)) {
    const facts = loadFacts();
    const counts = `${facts.decisions.length}d/${facts.patterns.length}p/${facts.issues.length}i`;
    console.log(`  ✓ facts.json (${counts})`);
  }

  console.log(`\nHierarchical files: ${total}/3 created`);
}

// Parse --key=value from arguments
function parseArg(args, key) {
  const prefix = `--${key}=`;
  for (const arg of args) {
    if (arg.startsWith(prefix)) {
      return arg.substring(prefix.length);
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
    // add-decision "content" "reason" [type] [files] [concepts]
    addDecision(args[0], args[1], args[2], args[3], args[4]);
    break;
  case 'add-pattern':
    // add-pattern "content" [type] [files] [concepts]
    addPattern(args[0], args[1], args[2], args[3]);
    break;
  case 'add-issue':
    // add-issue "content" "status" [type] [files] [concepts]
    addIssue(args[0], args[1], args[2], args[3], args[4]);
    break;
  case 'search':
    // search [query] [--type=X] [--concept=X] [--file=X]
    {
      const typeFilter = parseArg(args, 'type');
      const conceptFilter = parseArg(args, 'concept');
      const fileFilter = parseArg(args, 'file');
      const query = args.find(a => !a.startsWith('--')) || null;
      search(query, typeFilter, conceptFilter, fileFilter);
    }
    break;
  case 'clear-facts':
    clearFacts();
    break;
  case 'extract-facts':
    extractFacts(args[0]);
    break;
  case 'memory-set':
    memorySet(args[0], args.slice(1).join(' '));
    break;
  case 'memory-get':
    memoryGet(args[0]);
    break;
  case 'memory-list':
    memoryList();
    break;
  default:
    console.log(`Usage: counter.js <command>

Commands:
  check                  Increment counter, trigger save at interval
  final                  Session end handler (reads stdin for hook data)
  reset                  Reset counter to 0
  compress               Archive old session files (30+ days)

Memory Management (v7.0.0):
  memory-set <name> <content>
                         Set hierarchical memory file content
                         Names: project, architecture, conventions
  memory-get [name]      Get memory file content (all if no name)
  memory-list            List all memory files with status

Fact Commands:
  add-decision <content> <reason> [type] [files] [concepts]
                         Add decision with optional file refs and concept tags
                         Types: architecture, technology, approach, other
                         Files/concepts: comma-separated (e.g., "src/a.ts,src/b.ts")

  add-pattern <content> [type] [files] [concepts]
                         Add pattern with optional file refs and concept tags
                         Types: convention, best-practice, anti-pattern, other

  add-issue <content> <status> [type] [files] [concepts]
                         Add issue with optional file refs and concept tags
                         Types: bugfix, performance, security, feature, other

  search [query] [--type=X] [--concept=X] [--file=X]
                         Search facts with filters or show summary (no args)

  clear-facts            Clear all facts (keeps _meta and concepts)
  extract-facts [session]
                         Extract facts from session file (parses files/concepts sub-items)
`);
}
