'use strict';
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let projectDir = process.cwd();
let dryRun = false;
let backup = false;

for (const arg of args) {
  if (arg.startsWith('--project-dir=')) {
    projectDir = arg.slice('--project-dir='.length).replace(/^["']|["']$/g, '');
  } else if (arg === '--dry-run') {
    dryRun = true;
  } else if (arg === '--backup') {
    backup = true;
  }
}

// Resolve to absolute path
projectDir = path.resolve(projectDir);
const crabshellDir = path.join(projectDir, '.crabshell');

if (!fs.existsSync(crabshellDir)) {
  console.error(`Error: .crabshell/ not found under ${projectDir}`);
  process.exit(1);
}

console.log(`Project dir : ${projectDir}`);
console.log(`Dry-run     : ${dryRun}`);
console.log(`Backup      : ${backup}`);
console.log('');

// ---------------------------------------------------------------------------
// Directory → document type mapping
// ---------------------------------------------------------------------------
const DOC_DIRS = [
  { dir: 'discussion',    type: 'discussion',    prefix: 'D', ticketOnly: false },
  { dir: 'investigation', type: 'investigation', prefix: 'I', ticketOnly: false },
  { dir: 'plan',          type: 'plan',          prefix: 'P', ticketOnly: false },
  { dir: 'ticket',        type: 'ticket',        prefix: 'P', ticketOnly: true  },
  { dir: 'worklog',       type: 'worklog',       prefix: 'W', ticketOnly: false },
];

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------
let totalScanned = 0;
let totalFrontmatterAdded = 0;
let totalIndexRowsConverted = 0;
let totalInlineConverted = 0;
let totalSkippedFrontmatter = 0;
let totalErrors = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write a file, optionally creating a .bak copy first.
 * In dry-run mode, only prints what would happen.
 */
function writeFile(filePath, content) {
  if (dryRun) return;
  if (backup && fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, filePath + '.bak');
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Extract the document ID from a filename.
 * e.g. "D094-obsidian-l2.md"    → "D094"
 *      "P124_T001-some-title.md" → "P124_T001"
 */
function extractIdFromFilename(filename) {
  const base = path.basename(filename, '.md');
  // Match ticket IDs like P124_T001 first, then plain IDs like D094
  const ticketMatch = base.match(/^([A-Z]\d{3}_T\d{3})/);
  if (ticketMatch) return ticketMatch[1];
  const plainMatch = base.match(/^([A-Z]\d{3})/);
  if (plainMatch) return plainMatch[1];
  return null;
}

/**
 * Extract the title from the first H1 heading of a file.
 * "# D094 - Obsidian L2 통합" → "Obsidian L2 통합"
 * Falls back to the full H1 text if the "ID - " prefix is absent.
 */
function extractTitleFromContent(content) {
  const h1Match = content.match(/^#\s+(.+)/m);
  if (!h1Match) return '';
  const heading = h1Match[1].trim();
  // Strip leading "ID - " or "ID — " prefix
  const stripped = heading.replace(/^[A-Z]\d{3}(?:_T\d{3})?\s*[-—]\s*/, '');
  return stripped || heading;
}

/**
 * Look up the status and created date for a document ID from its INDEX.md.
 * Returns { status, created } or safe defaults.
 */
function lookupIndexEntry(indexPath, docId) {
  if (!fs.existsSync(indexPath)) return { status: 'open', created: '' };
  const content = fs.readFileSync(indexPath, 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    // Table row: | ID | Title | Status | Created | ... |
    const cells = line.split('|').map(c => c.trim());
    if (cells.length < 2) continue;
    if (cells[1] === docId) {
      const status = cells[3] || 'open';
      const created = cells[4] || '';
      const dateMatch = created.match(/\d{4}-\d{2}-\d{2}/);
      return {
        status: (status.toLowerCase() || 'open'),
        created: dateMatch ? dateMatch[0] : ''
      };
    }
  }
  return { status: 'open', created: '' };
}

/**
 * Build a 6-field YAML frontmatter block.
 */
function buildFrontmatter(type, id, title, status, created) {
  const titleEscaped = title.replace(/"/g, '\\"');
  const createdVal = created || new Date().toISOString().slice(0, 10);
  return `---\ntype: ${type}\nid: ${id}\ntitle: "${titleEscaped}"\nstatus: ${status}\ncreated: ${createdVal}\ntags: []\n---\n`;
}

/**
 * Return true when the file content already has YAML frontmatter
 * (i.e. first line is exactly "---").
 */
function hasFrontmatter(content) {
  return content.startsWith('---\n') || content.startsWith('---\r\n');
}

// ---------------------------------------------------------------------------
// File-ID lookup cache
// Built once on first call to findDocFile(), covering all five directories.
// ---------------------------------------------------------------------------
let _fileIdCache = null;

function buildFileIdCache() {
  _fileIdCache = {};
  for (const { dir } of DOC_DIRS) {
    const dirPath = path.join(crabshellDir, dir);
    if (!fs.existsSync(dirPath)) continue;
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
    for (const f of files) {
      const id = extractIdFromFilename(f);
      if (id) {
        // Store relative path inside .crabshell as "dir/basename-no-ext"
        _fileIdCache[id] = path.basename(f, '.md');
      }
    }
  }
}

/**
 * Given a document ID, return the .md filename stem (no directory, no extension),
 * or null if no matching file exists.
 */
function findDocFile(docId) {
  if (!_fileIdCache) buildFileIdCache();
  return _fileIdCache[docId] || null;
}

/**
 * Convert a document ID to a wikilink: [[filename|ID]]
 * Falls back to the plain ID string when no matching file is found.
 */
function idToWikilink(docId) {
  const stem = findDocFile(docId);
  if (!stem) return docId;
  return `[[${stem}|${docId}]]`;
}

// ---------------------------------------------------------------------------
// Step 3: Add frontmatter to document files
// ---------------------------------------------------------------------------

function processFrontmatter() {
  console.log('=== Step 3: Adding frontmatter ===');

  for (const { dir, type } of DOC_DIRS) {
    const dirPath = path.join(crabshellDir, dir);
    if (!fs.existsSync(dirPath)) continue;

    const indexPath = path.join(dirPath, 'INDEX.md');
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.md') && f !== 'INDEX.md' && !f.endsWith('.bak'));

    for (const filename of files) {
      const id = extractIdFromFilename(filename);
      if (!id) continue;

      // plan/ skips ticket files; ticket/ only processes ticket files
      const isTicket = /^[A-Z]\d{3}_T\d{3}/.test(id);
      if (dir === 'plan'   &&  isTicket) continue;
      if (dir === 'ticket' && !isTicket) continue;

      const filePath = path.join(dirPath, filename);
      totalScanned++;

      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (e) {
        console.error(`  ERROR reading ${filePath}: ${e.message}`);
        totalErrors++;
        continue;
      }

      if (hasFrontmatter(content)) {
        totalSkippedFrontmatter++;
        continue;
      }

      const title = extractTitleFromContent(content);
      const { status, created } = lookupIndexEntry(indexPath, id);
      const frontmatter = buildFrontmatter(type, id, title, status, created);
      const newContent = frontmatter + content;

      if (dryRun) {
        console.log(`  [dry-run] Would add frontmatter → ${dir}/${filename}`);
        console.log(`            id=${id}  status=${status}  created=${created}`);
        console.log(`            title="${title}"`);
      } else {
        writeFile(filePath, newContent);
        console.log(`  Added frontmatter → ${dir}/${filename}`);
      }
      totalFrontmatterAdded++;
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Step 4: Convert INDEX.md wikilinks
// ---------------------------------------------------------------------------

/**
 * Replace bare IDs in a single table cell with wikilinks.
 * Handles multiple IDs separated by ", ".
 * Leaves R-prefix IDs, tilde shorthands, non-ID values, and already-wikilinked
 * values untouched.
 */
function convertCellIds(cell) {
  if (!cell || cell.trim() === '') return cell;
  if (cell.includes('[[')) return cell;   // already wikilinked
  if (cell.includes('~')) return cell;    // tilde shorthand

  const parts = cell.split(', ');
  const converted = parts.map(part => {
    const trimmed = part.trim();
    // Only convert if the whole segment is a bare doc ID (D/I/P/T/W prefix)
    if (/^[DIPTW]\d{3}(?:_T\d{3})?$/.test(trimmed)) {
      return idToWikilink(trimmed);
    }
    return part; // R-IDs, filenames, etc.
  });
  return converted.join(', ');
}

function processIndexFile(indexPath) {
  if (!fs.existsSync(indexPath)) return;

  const content = fs.readFileSync(indexPath, 'utf8');
  const lines = content.split('\n');
  let modified = false;
  let convertedInThisFile = 0;

  const newLines = lines.map(line => {
    if (!line.startsWith('|')) return line;

    const cells = line.split('|');
    const newCells = cells.map((cell, i) => {
      // Boundary empty cells
      if (i === 0 || i === cells.length - 1) return cell;

      // Column 1 = ID column: convert if bare ID
      if (i === 1) {
        const trimmed = cell.trim();
        if (/^[DIPTW]\d{3}(?:_T\d{3})?$/.test(trimmed)) {
          const wl = idToWikilink(trimmed);
          if (wl !== trimmed) {
            modified = true;
            convertedInThisFile++;
            return cell.replace(trimmed, wl);
          }
        }
        return cell;
      }

      // Remaining columns (Title, Status, Created, Related, Plan, Tickets…)
      const original = cell;
      const result = convertCellIds(cell);
      if (result !== original) {
        modified = true;
        // Count converted IDs (number of segments that changed)
        const origParts = original.split(', ');
        const newParts  = result.split(', ');
        for (let j = 0; j < origParts.length; j++) {
          if (origParts[j] !== newParts[j]) convertedInThisFile++;
        }
      }
      return result;
    });

    return newCells.join('|');
  });

  totalIndexRowsConverted += convertedInThisFile;
  if (!modified) return;

  const newContent = newLines.join('\n');
  if (dryRun) {
    console.log(`  [dry-run] Would update → ${path.relative(crabshellDir, indexPath)}  (${convertedInThisFile} IDs)`);
  } else {
    writeFile(indexPath, newContent);
    console.log(`  Updated → ${path.relative(crabshellDir, indexPath)}  (${convertedInThisFile} IDs)`);
  }
}

function processIndexFiles() {
  console.log('=== Step 4: Converting INDEX.md wikilinks ===');
  for (const { dir } of DOC_DIRS) {
    processIndexFile(path.join(crabshellDir, dir, 'INDEX.md'));
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Step 5: Convert inline bare ID references in document bodies
// ---------------------------------------------------------------------------

/**
 * Return true when position `pos` in `text` falls inside a fenced code block.
 * Counts ``` fence openers before pos; odd count = inside block.
 */
function isInsideCodeBlock(text, pos) {
  let count = 0;
  let idx = 0;
  while (idx < pos) {
    const found = text.indexOf('```', idx);
    if (found === -1 || found >= pos) break;
    count++;
    idx = found + 3;
  }
  return count % 2 === 1;
}

/**
 * Return true when position `pos` falls inside the YAML frontmatter block
 * (between the opening "---\n" and the closing "\n---" line).
 */
function isInsideFrontmatter(text, pos) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return false;
  const secondDash = text.indexOf('\n---', 4);
  if (secondDash === -1) return false;
  return pos > 0 && pos < secondDash + 4;
}

/**
 * Return true when position `pos` falls inside an inline code span (single `).
 * Heuristic: count odd backticks on the same line before pos.
 */
function isInsideInlineCode(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const lineEnd   = text.indexOf('\n', pos);
  const line      = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const relPos    = pos - lineStart;
  let count = 0;
  for (let i = 0; i < relPos; i++) {
    // Single backtick (not part of a triple-backtick sequence)
    if (line[i] === '`' && line[i - 1] !== '`' && line[i + 1] !== '`') count++;
  }
  return count % 2 === 1;
}

/**
 * Return true when the match at [matchStart, matchEnd) is already inside [[ ]].
 */
function isInsideWikilink(text, matchStart, matchEnd) {
  const before = text.slice(0, matchStart);
  const after  = text.slice(matchEnd);
  return (
    /\[\[[^\]]*$/.test(before) ||   // unclosed [[ before match
    after.startsWith('|')      ||   // "ID|..." inside wikilink
    after.startsWith(']]')          // "ID]]" closing wikilink
  );
}

/**
 * Replace bare ID references in `content` with wikilinks.
 * Returns { newContent, count }.
 */
function convertInlineReferences(content) {
  // Match bare IDs: D001, I054, P124, P124_T001, W016
  // Not preceded by "[" or a word char; not followed by word char, ], or |
  const re = /(?<!\[)(?<!\w)([DIPTW]\d{3}(?:_T\d{3})?)(?!\w)(?!\])(?!\|)/g;

  let result = '';
  let lastIndex = 0;
  let count = 0;
  let match;

  while ((match = re.exec(content)) !== null) {
    const matchStart = match.index;
    const matchEnd   = re.lastIndex;
    const id         = match[1];

    if (isInsideFrontmatter(content, matchStart)) continue;
    if (isInsideCodeBlock(content, matchStart))   continue;
    if (isInsideInlineCode(content, matchStart))  continue;
    if (isInsideWikilink(content, matchStart, matchEnd)) continue;

    const wikilink = idToWikilink(id);
    if (wikilink === id) continue; // no matching file — leave as-is

    result    += content.slice(lastIndex, matchStart) + wikilink;
    lastIndex  = matchEnd;
    count++;
  }

  result += content.slice(lastIndex);
  return { newContent: result, count };
}

function processInlineReferences() {
  console.log('=== Step 5: Converting inline ID references ===');

  for (const { dir } of DOC_DIRS) {
    const dirPath = path.join(crabshellDir, dir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.md') && f !== 'INDEX.md' && !f.endsWith('.bak'));

    for (const filename of files) {
      const id = extractIdFromFilename(filename);
      if (!id) continue;

      const isTicket = /^[A-Z]\d{3}_T\d{3}/.test(id);
      if (dir === 'plan'   &&  isTicket) continue;
      if (dir === 'ticket' && !isTicket) continue;

      const filePath = path.join(dirPath, filename);

      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (e) {
        console.error(`  ERROR reading ${filePath}: ${e.message}`);
        totalErrors++;
        continue;
      }

      const { newContent, count } = convertInlineReferences(content);
      if (count === 0) continue;

      totalInlineConverted += count;

      if (dryRun) {
        console.log(`  [dry-run] Would convert ${count} inline ref(s) → ${dir}/${filename}`);
      } else {
        writeFile(filePath, newContent);
        console.log(`  Converted ${count} inline ref(s) → ${dir}/${filename}`);
      }
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Starting Obsidian migration...\n');

try {
  processFrontmatter();
  processIndexFiles();
  processInlineReferences();
} catch (e) {
  console.error('Unexpected error:', e);
  totalErrors++;
}

console.log('=== Migration complete ===');
console.log(`  Files scanned               : ${totalScanned}`);
console.log(`  Frontmatter added           : ${totalFrontmatterAdded}`);
console.log(`  INDEX.md IDs converted      : ${totalIndexRowsConverted}`);
console.log(`  Inline references converted : ${totalInlineConverted}`);
console.log(`  Skipped (has frontmatter)   : ${totalSkippedFrontmatter}`);
console.log(`  Errors                      : ${totalErrors}`);
