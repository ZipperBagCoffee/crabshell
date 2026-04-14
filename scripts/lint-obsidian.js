'use strict';

/**
 * lint-obsidian.js — Lint checks for Crabshell Obsidian documents
 *
 * Usage:
 *   node scripts/lint-obsidian.js --project-dir=PATH [--check=CHECK]
 *
 * --check options: orphans, wikilinks, stale, frontmatter, index (default: all)
 * --project-dir defaults to cwd
 *
 * Output:
 *   Console: summary table
 *   File: .crabshell/lint-report.md
 */

const fs = require('fs');
const path = require('path');

// ---------- CLI parsing ----------

function parseArgs(argv) {
  const args = { projectDir: process.cwd(), check: 'all' };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--project-dir=')) {
      args.projectDir = arg.slice('--project-dir='.length);
    } else if (arg.startsWith('--check=')) {
      args.check = arg.slice('--check='.length);
    }
  }
  return args;
}

// ---------- Helpers ----------

/**
 * Read a file safely; returns null on error.
 */
function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
}

/**
 * Collect all .md files in a directory (non-recursive, flat).
 * Returns [] if directory does not exist.
 */
function listMdFiles(dir) {
  try {
    const entries = fs.readdirSync(dir);
    return entries
      .filter((e) => e.endsWith('.md'))
      .map((e) => path.join(dir, e));
  } catch (_) {
    return [];
  }
}

/**
 * Derive bare ID from filename (strip extension, lowercase).
 */
function fileId(filePath) {
  return path.basename(filePath, '.md');
}

/**
 * Return true if filename should be excluded from checks (INDEX.md, MOC*.md).
 */
function isExcluded(filePath) {
  const name = path.basename(filePath);
  return name === 'INDEX.md' || name.startsWith('MOC');
}

/**
 * Extract YAML frontmatter block (between leading --- delimiters).
 * Returns the raw frontmatter string or null.
 */
function extractFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  return content.slice(3, end).trim();
}

/**
 * Parse a simple key: value frontmatter block into an object.
 */
function parseFrontmatter(raw) {
  const obj = {};
  for (const line of raw.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
    obj[key] = val;
  }
  return obj;
}

/**
 * Extract all wikilink targets from content.
 * Returns array of { target, alias, line } objects.
 */
function extractWikilinks(content) {
  const links = [];
  const lines = content.split('\n');
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  lines.forEach((lineText, idx) => {
    let m;
    while ((m = re.exec(lineText)) !== null) {
      links.push({ target: m[1].trim(), alias: m[2] || null, line: idx + 1 });
    }
  });
  return links;
}

/**
 * Find the date of the last ### [YYYY-MM-DD log entry in content.
 * Returns Date or null.
 */
function lastLogDate(content) {
  const re = /^#{1,4}\s+\[(\d{4}-\d{2}-\d{2})/gm;
  let last = null;
  let m;
  while ((m = re.exec(content)) !== null) {
    const d = new Date(m[1]);
    if (!isNaN(d.getTime())) last = d;
  }
  return last;
}

// ---------- Document directories ----------

const DOC_DIRS = ['discussion', 'investigation', 'plan', 'ticket', 'worklog', 'hotfix'];

/**
 * Collect all document .md files across DOC_DIRS under .crabshell/.
 * Returns { files: string[], byDir: { dirName: string[] } }
 */
function collectAllDocFiles(crabshellDir) {
  const files = [];
  const byDir = {};
  for (const dir of DOC_DIRS) {
    const full = path.join(crabshellDir, dir);
    const dirFiles = listMdFiles(full);
    byDir[dir] = dirFiles;
    files.push(...dirFiles);
  }
  return { files, byDir };
}

// ---------- Check 1: Orphan documents ----------

/**
 * A document is an orphan if its ID does not appear:
 * - in any INDEX.md in the project, OR
 * - as a [[filename|alias]] or [[filename]] wikilink in any other document
 */
function checkOrphans(crabshellDir) {
  const { files } = collectAllDocFiles(crabshellDir);
  const issues = [];

  // Build full content of all files for reference scanning
  const allContents = {};
  for (const f of files) {
    allContents[f] = readFileSafe(f) || '';
  }

  // Collect INDEX.md contents
  const indexContents = [];
  for (const dir of DOC_DIRS) {
    const idxPath = path.join(crabshellDir, dir, 'INDEX.md');
    const c = readFileSafe(idxPath);
    if (c) indexContents.push(c);
  }
  const combinedIndex = indexContents.join('\n');

  // Collect all wikilink targets from non-excluded docs
  const wikilinkTargets = new Set();
  for (const f of files) {
    if (isExcluded(f)) continue;
    const content = allContents[f];
    const links = extractWikilinks(content);
    for (const l of links) {
      wikilinkTargets.add(l.target.toLowerCase());
    }
  }

  for (const f of files) {
    if (isExcluded(f)) continue;
    const id = fileId(f);
    const idLower = id.toLowerCase();

    // Check INDEX.md mentions
    const inIndex = combinedIndex.includes(id);

    // Check wikilinks in other documents
    const inWikilinks = wikilinkTargets.has(idLower);

    if (!inIndex && !inWikilinks) {
      issues.push({
        file: f,
        message: `Orphan: "${id}" has no INDEX.md entry and no inbound wikilinks`,
      });
    }
  }

  return issues;
}

// ---------- Check 2: Broken wikilinks ----------

function checkWikilinks(crabshellDir) {
  const { files } = collectAllDocFiles(crabshellDir);
  const issues = [];

  // Build a set of all known filenames (without extension, lowercased)
  const knownFiles = new Set();
  for (const f of files) {
    knownFiles.add(fileId(f).toLowerCase());
  }

  for (const f of files) {
    const content = readFileSafe(f);
    if (!content) continue;
    const links = extractWikilinks(content);
    for (const l of links) {
      const targetLower = l.target.toLowerCase();
      if (!knownFiles.has(targetLower)) {
        issues.push({
          file: f,
          line: l.line,
          message: `Broken wikilink: [[${l.target}]] not found`,
        });
      }
    }
  }

  return issues;
}

// ---------- Check 3: Stale status ----------

const STALE_DAYS = 30;

function checkStale(crabshellDir) {
  const { files } = collectAllDocFiles(crabshellDir);
  const issues = [];
  const now = new Date();

  for (const f of files) {
    if (isExcluded(f)) continue;
    const content = readFileSafe(f);
    if (!content) continue;

    const rawFm = extractFrontmatter(content);
    if (!rawFm) continue;
    const fm = parseFrontmatter(rawFm);

    if (fm.status !== 'open') continue;

    const last = lastLogDate(content);
    if (!last) continue;

    const diffDays = (now - last) / (1000 * 60 * 60 * 24);
    if (diffDays > STALE_DAYS) {
      issues.push({
        file: f,
        message: `Stale: status=open, last log ${Math.floor(diffDays)} days ago (${last.toISOString().slice(0, 10)})`,
      });
    }
  }

  return issues;
}

// ---------- Check 4: Missing frontmatter ----------

function checkFrontmatter(crabshellDir) {
  const { files } = collectAllDocFiles(crabshellDir);
  const issues = [];

  for (const f of files) {
    if (isExcluded(f)) continue;
    const content = readFileSafe(f);
    if (!content) continue;
    if (!extractFrontmatter(content)) {
      issues.push({
        file: f,
        message: `Missing frontmatter: no YAML --- block at start`,
      });
    }
  }

  return issues;
}

// ---------- Check 5: INDEX inconsistencies ----------

/**
 * For each directory, compare .md files vs INDEX.md rows.
 * An INDEX.md row is considered to reference a file if the row contains the
 * bare filename (without .md) anywhere on the line.
 */
function checkIndex(crabshellDir) {
  const issues = [];

  for (const dir of DOC_DIRS) {
    const dirPath = path.join(crabshellDir, dir);
    const idxPath = path.join(dirPath, 'INDEX.md');

    // Collect .md files (excluding INDEX.md and MOC*.md)
    const dirFiles = listMdFiles(dirPath).filter((f) => !isExcluded(f));

    const idxContent = readFileSafe(idxPath);
    if (!idxContent) {
      // INDEX.md missing — report each document as missing from index
      for (const f of dirFiles) {
        issues.push({
          file: f,
          message: `INDEX missing: INDEX.md does not exist in ${dir}/`,
        });
      }
      continue;
    }

    const idxLines = idxContent.split('\n');

    // For each .md file, check if any INDEX row contains its bare ID
    for (const f of dirFiles) {
      const id = fileId(f);
      const inIndex = idxLines.some((line) => line.includes(id));
      if (!inIndex) {
        issues.push({
          file: f,
          message: `INDEX gap: "${id}" exists on disk but has no row in ${dir}/INDEX.md`,
        });
      }
    }

    // For each INDEX row referencing a known ID pattern, check file exists
    // We look for patterns that look like document IDs: D\d+, P\d+, I\d+, W\d+, P\d+_T\d+
    const idPattern = /\b([DPITWH]\d+(?:_T\d+)?)\b/g;
    const indexedIds = new Set();
    for (const line of idxLines) {
      let m;
      while ((m = idPattern.exec(line)) !== null) {
        indexedIds.add(m[1]);
      }
    }

    const diskIds = new Set(dirFiles.map((f) => fileId(f)));
    for (const id of indexedIds) {
      // Find any file whose name starts with or equals this id
      const found = [...diskIds].some(
        (d) => d === id || d.startsWith(id + '-') || d.startsWith(id + '_')
      );
      if (!found) {
        issues.push({
          file: idxPath,
          message: `INDEX ghost: "${id}" listed in ${dir}/INDEX.md but no matching file on disk`,
        });
      }
    }
  }

  return issues;
}

// ---------- Report generation ----------

function formatIssues(issues, crabshellDir) {
  if (issues.length === 0) return '  (none)';
  return issues
    .map((i) => {
      const rel = path.relative(crabshellDir, i.file).replace(/\\/g, '/');
      const loc = i.line ? `:${i.line}` : '';
      return `  - ${rel}${loc} — ${i.message}`;
    })
    .join('\n');
}

function buildReport(results, timestamp, crabshellDir) {
  const lines = [
    `# Crabshell Lint Report`,
    ``,
    `Generated: ${timestamp}`,
    ``,
    `## Summary`,
    ``,
    `| Check | Issues | Status |`,
    `|-------|--------|--------|`,
  ];

  const checks = Object.keys(results);
  for (const check of checks) {
    const count = results[check].length;
    const status = count === 0 ? 'OK' : 'WARN';
    lines.push(`| ${check} | ${count} | ${status} |`);
  }

  lines.push('');
  lines.push('## Details');

  for (const check of checks) {
    lines.push('');
    lines.push(`### ${check}`);
    lines.push('');
    lines.push(formatIssues(results[check], crabshellDir));
  }

  return lines.join('\n') + '\n';
}

function printSummaryTable(results) {
  console.log('');
  console.log('Crabshell Lint Results');
  console.log('----------------------');
  console.log('Check          Issues  Status');
  console.log('-------------- ------- ------');
  for (const check of Object.keys(results)) {
    const count = results[check].length;
    const status = count === 0 ? 'OK' : 'WARN';
    const padCheck = check.padEnd(14, ' ');
    const padCount = String(count).padEnd(7, ' ');
    console.log(`${padCheck} ${padCount} ${status}`);
  }
  console.log('');
}

// ---------- Main ----------

function main() {
  const args = parseArgs(process.argv);
  const projectDir = path.resolve(args.projectDir);
  const crabshellDir = path.join(projectDir, '.crabshell');

  // Fail-open: if .crabshell/ doesn't exist, print message and exit 0
  if (!fs.existsSync(crabshellDir)) {
    console.log(`lint-obsidian: .crabshell/ not found in ${projectDir} — nothing to lint.`);
    process.exit(0);
  }

  const checkArg = args.check;
  const allChecks = ['orphans', 'wikilinks', 'stale', 'frontmatter', 'index'];
  const checksToRun =
    checkArg === 'all'
      ? allChecks
      : checkArg.split(',').map((c) => c.trim()).filter((c) => allChecks.includes(c));

  if (checksToRun.length === 0) {
    console.error(`lint-obsidian: unknown check "${checkArg}". Valid: ${allChecks.join(', ')}, all`);
    process.exit(0);
  }

  const results = {};

  for (const check of checksToRun) {
    try {
      switch (check) {
        case 'orphans':
          results[check] = checkOrphans(crabshellDir);
          break;
        case 'wikilinks':
          results[check] = checkWikilinks(crabshellDir);
          break;
        case 'stale':
          results[check] = checkStale(crabshellDir);
          break;
        case 'frontmatter':
          results[check] = checkFrontmatter(crabshellDir);
          break;
        case 'index':
          results[check] = checkIndex(crabshellDir);
          break;
      }
    } catch (err) {
      console.error(`lint-obsidian: error running check "${check}": ${err.message}`);
      results[check] = [];
    }
  }

  const timestamp = new Date().toISOString();
  printSummaryTable(results);

  // Write report to .crabshell/lint-report.md
  const reportPath = path.join(crabshellDir, 'lint-report.md');
  const report = buildReport(results, timestamp, crabshellDir);
  try {
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`Report written to: ${reportPath}`);
  } catch (err) {
    console.error(`lint-obsidian: could not write report: ${err.message}`);
  }

  process.exit(0);
}

main();
