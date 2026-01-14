const path = require('path');
const fs = require('fs');
const { getProjectDir, getProjectName, readFileOrDefault, writeFile, readJsonOrDefault, writeJson, ensureDir, getTimestamp } = require('./utils');
const os = require('os');
const { refineRaw } = require('./refine-raw');
const { checkAndRotate } = require('./memory-rotation');
const { MEMORY_DIR, MEMORY_FILE, SESSIONS_DIR } = require('./constants');

// CRITICAL WARNING - Shown to Claude in hook outputs
const FILE_DELETION_WARNING = `
⚠️ CRITICAL: NEVER delete files without explicit user permission.
   If you need to delete something, REPORT first and ASK for permission.

⚠️ CRITICAL: Think objectively and logically before responding.
   Don't just agree with user statements - verify claims independently.
   The user's interpretation may be incomplete or wrong. Investigate first.`;

const CONFIG_PATH = path.join(process.cwd(), '.claude', 'memory', 'config.json');
const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.claude', 'memory-keeper', 'config.json');
const DEFAULT_INTERVAL = 5;

// Get logs directory (ensures it exists)
function getLogsDir() {
  const logsDir = path.join(getProjectDir(), '.claude', 'memory', 'logs');
  ensureDir(logsDir);
  return logsDir;
}

function getConfig() {
  let config = readJsonOrDefault(CONFIG_PATH, null);
  if (!config) {
    config = readJsonOrDefault(GLOBAL_CONFIG_PATH, { saveInterval: DEFAULT_INTERVAL, keepRaw: false, quietStop: true });
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
          const debugPath = path.join(getLogsDir(), 'stdin-parse-error.log');
          fs.appendFileSync(debugPath, `${new Date().toISOString()}: ${e.message}\nData: ${data.substring(0, 500)}\n`);
          resolve({});
        }
      } else {
        resolve({});
      }
    });

    // Handle error
    process.stdin.on('error', (e) => {
      const debugPath = path.join(getLogsDir(), 'stdin-error.log');
      fs.appendFileSync(debugPath, `${new Date().toISOString()}: ${e.message}\n`);
      resolve({});
    });

    // Resume stdin (important for piped input)
    process.stdin.resume();
  });
}


// Counter stored in memory-index.json
function getCounter() {
  const indexPath = path.join(getProjectDir(), '.claude', MEMORY_DIR, 'memory-index.json');
  const index = readJsonOrDefault(indexPath, { counter: 0 });
  return index.counter || 0;
}

function setCounter(value) {
  const indexPath = path.join(getProjectDir(), '.claude', MEMORY_DIR, 'memory-index.json');
  const index = readJsonOrDefault(indexPath, {});
  index.counter = value;
  writeJson(indexPath, index);
}

function check() {
  const config = getConfig();
  const interval = config.saveInterval || DEFAULT_INTERVAL;

  let counter = getCounter();
  counter++;
  setCounter(counter);

  // Check rotation before auto-save
    const memoryPath = path.join(getProjectDir(), ".claude", MEMORY_DIR, MEMORY_FILE);
    const rotationResult = checkAndRotate(memoryPath, config);
    if (rotationResult) {
      console.log(rotationResult.hookOutput);
    }

    if (counter >= interval) {
    const projectDir = getProjectDir().replace(/\\/g, '/');
    const scriptPath = process.argv[1].replace(/\\/g, '/');
    const timestamp = getTimestamp();

    const instructions = `
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER] AUTO-SAVE TRIGGERED - ${counter} tool uses reached
═══════════════════════════════════════════════════════════════
${FILE_DELETION_WARNING}

**APPEND to memory.md:**
\`\`\`bash
echo -e "\\n## ${timestamp}\\n[1-2 sentence summary of work so far]" >> "${projectDir}/.claude/memory/memory.md"
\`\`\`

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
  const sessionsDir = path.join(getProjectDir(), '.claude', SESSIONS_DIR);

  ensureDir(sessionsDir);

  // Debug: log what we received
  const logsDir = getLogsDir();
  const debugPath = path.join(logsDir, 'debug-hook.json');
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
      fs.appendFileSync(path.join(getLogsDir(), 'error.log'),
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
        fs.appendFileSync(path.join(getLogsDir(), 'error.log'),
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
        fs.appendFileSync(path.join(getLogsDir(), 'error.log'),
          `${timestamp}: Failed to find transcript: ${e.message}\n`);
      }
    }
  }

  // Create L1 refined version
  if (rawSaved) {
    try {
      const l1Dest = rawSaved.replace('.raw.jsonl', '.l1.jsonl');
      const lineCount = await refineRaw(rawSaved, l1Dest);
      // Log stats
      const rawSize = fs.statSync(rawSaved).size;
      const l1Size = fs.statSync(l1Dest).size;
      const reduction = ((1 - l1Size / rawSize) * 100).toFixed(1);
      fs.appendFileSync(path.join(logsDir, 'refine.log'),
        `${timestamp}: ${lineCount} lines, ${rawSize}→${l1Size} bytes (${reduction}% reduction)\n`);

      // Remove duplicate L1 files from same session
      cleanupDuplicateL1(l1Dest);

      // Delete raw file unless keepRaw is enabled
      const config = getConfig();
      if (!config.keepRaw) {
        fs.unlinkSync(rawSaved);
        rawSaved = ''; // Clear so instructions don't show deleted file
      }
    } catch (e) {
      fs.appendFileSync(path.join(getLogsDir(), 'error.log'),
        `${timestamp}: Failed to create L1: ${e.message}\n`);
    }
  }

  const scriptPath = process.argv[1].replace(/\\/g, '/');
  const config = getConfig();

  // Quiet mode by default - only show brief message
  if (config.quietStop !== false) {
    const output = {
      systemMessage: `[MEMORY_KEEPER] Session saved. L1: ${rawSaved ? 'OK' : 'SKIP'}${FILE_DELETION_WARNING}`
    };
    console.log(JSON.stringify(output));
    setCounter(0);
    return;
  }

  const instructions = `
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER] SESSION ENDING - Final Save Required
═══════════════════════════════════════════════════════════════
${FILE_DELETION_WARNING}

${rawSaved ? `✓ Raw transcript saved: ${rawSaved}` : '⚠ Raw transcript not saved'}

**APPEND complete summary to memory.md:**
\`\`\`bash
echo -e "\\n## ${timestamp} (Session End)\\n[Complete session summary - be thorough]" >> "${projectDir}/.claude/memory/memory.md"
\`\`\`

**RUN compression:**
\`\`\`bash
node "${scriptPath}" compress
\`\`\`

═══════════════════════════════════════════════════════════════`;

  const output = {
    systemMessage: instructions
  };
  console.log(JSON.stringify(output));

  setCounter(0);
}

function reset() {
  setCounter(0);
  console.log('[MEMORY_KEEPER] Counter reset.');
}

// Remove duplicate L1 files from same session (keep only the largest/latest)
function cleanupDuplicateL1(newL1Path) {
  const sessionsDir = path.dirname(newL1Path);
  const newL1Content = fs.readFileSync(newL1Path, 'utf8');
  const newL1FirstLine = newL1Content.split('\n')[0];

  let sessionStartTs;
  try {
    sessionStartTs = JSON.parse(newL1FirstLine).ts;
  } catch (e) {
    return; // Skip if parsing fails
  }

  const newL1Size = fs.statSync(newL1Path).size;
  const newL1Name = path.basename(newL1Path);

  // Find and delete smaller L1 files from same session
  const l1Files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl'));

  for (const fileName of l1Files) {
    if (fileName === newL1Name) continue;

    const filePath = path.join(sessionsDir, fileName);
    const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];

    try {
      const fileStartTs = JSON.parse(firstLine).ts;
      const fileSize = fs.statSync(filePath).size;

      // Same session and smaller than new file = delete
      if (fileStartTs === sessionStartTs && fileSize < newL1Size) {
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      continue;
    }
  }
}

// Deduplicate all L1 files (keep largest per session)
function dedupeL1() {
  const sessionsDir = path.join(getProjectDir(), '.claude', SESSIONS_DIR);
  if (!fs.existsSync(sessionsDir)) {
    console.log('[MEMORY_KEEPER] No sessions directory found');
    return;
  }

  const l1Files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl'));
  const tsMap = {};

  // Group files by session start timestamp
  for (const f of l1Files) {
    try {
      const filePath = path.join(sessionsDir, f);
      const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
      const ts = JSON.parse(firstLine).ts;
      const size = fs.statSync(filePath).size;
      if (!tsMap[ts]) tsMap[ts] = [];
      tsMap[ts].push({ file: f, size, path: filePath });
    } catch (e) {
      continue;
    }
  }

  let deletedCount = 0;
  let savedBytes = 0;

  // Find and delete duplicates
  for (const [ts, files] of Object.entries(tsMap)) {
    if (files.length > 1) {
      files.sort((a, b) => b.size - a.size);
      console.log(`\nDuplicate found: session ${ts}`);
      console.log(`  ✅ Keep: ${files[0].file} (${(files[0].size / 1024).toFixed(0)}KB)`);

      for (let i = 1; i < files.length; i++) {
        console.log(`  ❌ Delete: ${files[i].file} (${(files[i].size / 1024).toFixed(0)}KB)`);
        savedBytes += files[i].size;
        fs.unlinkSync(files[i].path);
        deletedCount++;
      }
    }
  }

  if (deletedCount === 0) {
    console.log('[MEMORY_KEEPER] No duplicate L1 files found');
  } else {
    console.log(`\n[MEMORY_KEEPER] Deleted: ${deletedCount} files, saved ${(savedBytes / 1024 / 1024).toFixed(2)}MB`);
  }
}


async function refineAll() {
  const sessionsDir = path.join(getProjectDir(), '.claude', SESSIONS_DIR);
  if (!fs.existsSync(sessionsDir)) {
    console.log('[MEMORY_KEEPER] No sessions directory found');
    return;
  }

  const rawFiles = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.raw.jsonl'))
    .filter(f => !fs.existsSync(path.join(sessionsDir, f.replace('.raw.jsonl', '.l1.jsonl'))));

  if (rawFiles.length === 0) {
    console.log('[MEMORY_KEEPER] All raw files already have L1 versions');
    return;
  }

  console.log(`[MEMORY_KEEPER] Processing ${rawFiles.length} raw files...`);

  let totalRaw = 0;
  let totalL1 = 0;

  for (const file of rawFiles) {
    const rawPath = path.join(sessionsDir, file);
    const l1Path = rawPath.replace('.raw.jsonl', '.l1.jsonl');

    try {
      await refineRaw(rawPath, l1Path);
      const rawSize = fs.statSync(rawPath).size;
      const l1Size = fs.statSync(l1Path).size;
      totalRaw += rawSize;
      totalL1 += l1Size;
      console.log(`  ${file}: ${(rawSize/1024/1024).toFixed(1)}MB → ${(l1Size/1024/1024).toFixed(1)}MB`);
    } catch (e) {
      console.log(`  ${file}: ERROR - ${e.message}`);
    }
  }

  const reduction = ((1 - totalL1 / totalRaw) * 100).toFixed(1);
  console.log(`[MEMORY_KEEPER] Total: ${(totalRaw/1024/1024).toFixed(1)}MB → ${(totalL1/1024/1024).toFixed(1)}MB (${reduction}% reduction)`);
}

function compress() {
  const projectDir = getProjectDir();
  const sessionsDir = path.join(projectDir, '.claude', SESSIONS_DIR);

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
  const memoryPath = path.join(projectDir, '.claude', MEMORY_DIR, MEMORY_FILE);
  if (fs.existsSync(memoryPath)) {
    const stats = fs.statSync(memoryPath);
    const content = readFileOrDefault(memoryPath, '');
    const lines = content.trim().split('\n').length;
    console.log(`  ✓ memory.md (${lines} lines, ${stats.size} bytes) [rolling]`);
  } else {
    console.log(`  ○ memory.md - not created [rolling]`);
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
  case 'refine-all':
    refineAll().catch(e => {
      console.error(`[MEMORY_KEEPER] Refine-all error: ${e.message}`);
      process.exit(1);
    });
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
  case 'generate-l3':
    // Manual L3 summary generation
    if (args[0]) {
      console.log('[MEMORY_KEEPER_ROTATE] file=' + args[0]);
    } else {
      console.log('[MEMORY_KEEPER] Usage: generate-l3 <archive-file>');
    }
    break;
  case 'search-memory':
    {
      const { searchMemory } = require('./search');
      const deep = args.includes('--deep');
      const query = args.filter(a => !a.startsWith('--'))[0];
      if (!query) {
        console.log('[MEMORY_KEEPER] Usage: search-memory <query> [--deep]');
        break;
      }
      const results = searchMemory(query, { deep });
      if (results.length === 0) {
        console.log('[MEMORY_KEEPER] No results for "' + query + '"');
      } else {
        for (const r of results) {
          console.log('\n[' + r.source + ']');
          for (const m of r.matches.slice(0, 5)) {
            if (m.line) console.log('  L' + m.line + ': ' + m.text);
            else if (m.type) console.log('  [' + m.type + '] ' + m.content);
            else console.log('  ' + m.file);
          }
          if (r.matches.length > 5) console.log('  ... and ' + (r.matches.length - 5) + ' more');
        }
      }
    }
    break;
  case 'migrate-legacy':
    {
      const { splitLegacyMemory } = require('./legacy-migration');
      const mp = path.join(getProjectDir(), '.claude', 'memory', 'memory.md');
      const result = splitLegacyMemory(mp);
      if (result) {
        console.log('[MEMORY_KEEPER] Legacy split: ' + result.archives.length + ' archives created');
        result.triggers.forEach(t => console.log(t));
      } else {
        console.log('[MEMORY_KEEPER] No migration needed (under threshold)');
      }
    }
    break;
  case 'dedupe-l1':
    dedupeL1();
    break;
  default:
    console.log(`Usage: counter.js <command>

Core Commands:
  check                  Increment counter, trigger auto-save at interval
  final                  Session end handler
  reset                  Reset counter to 0

Memory Management:
  memory-set <name> <content>   Set memory file (project|architecture|conventions)
  memory-get [name]             Get memory file content
  memory-list                   List all memory files

Memory Rotation (v13.0.0):
  search-memory <query> [--deep]  Search L3/L2/L1 hierarchically
  generate-l3 <archive-file>      Manual L3 summary generation
  migrate-legacy                  Split oversized legacy memory.md
  compress                        Archive old sessions (30+ days)
  refine-all                      Process raw.jsonl to L1
  dedupe-l1                       Remove duplicate L1 files (keep largest)
`);
}
