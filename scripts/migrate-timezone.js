// scripts/migrate-timezone.js
// Migrate local timestamps to UTC in memory.md headers and L1 filenames

const fs = require('fs');
const path = require('path');
const { getProjectDir } = require('./utils');
const { MEMORY_DIR, SESSIONS_DIR } = require('./constants');

// Parse header timestamp: YYYY-MM-DD_HHMM -> Date
function parseHeaderTimestamp(ts) {
  const match = ts.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return new Date(year, month - 1, day, hour, minute);
}

// Format Date to header timestamp: YYYY-MM-DD_HHMM (UTC)
function formatHeaderTimestamp(date) {
  const pad = n => n.toString().padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

// Parse L1 filename: YYYY-MM-DD_HHMMSS.l1.jsonl -> Date
function parseL1Filename(filename) {
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.l1\.jsonl$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(year, month - 1, day, hour, minute, second);
}

// Format Date to L1 filename: YYYY-MM-DD_HHMMSS.l1.jsonl (UTC)
function formatL1Filename(date) {
  const pad = n => n.toString().padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}.l1.jsonl`;
}

// Migrate memory.md headers
function migrateMemoryMd(projectDir, offsetHours, dryRun = true, beforeTs = null) {
  const memoryPath = path.join(projectDir, '.claude', MEMORY_DIR, 'memory.md');
  if (!fs.existsSync(memoryPath)) {
    console.log('memory.md not found');
    return { changes: 0 };
  }

  const beforeDate = beforeTs ? parseHeaderTimestamp(beforeTs) : null;

  const content = fs.readFileSync(memoryPath, 'utf8');
  const lines = content.split('\n');
  let changes = 0;
  let skipped = 0;
  const newLines = [];

  for (const line of lines) {
    const match = line.match(/^## (\d{4}-\d{2}-\d{2}_\d{4})$/);
    if (match) {
      const localDate = parseHeaderTimestamp(match[1]);
      if (localDate) {
        // Skip if after cutoff (already UTC)
        if (beforeDate && localDate >= beforeDate) {
          console.log(`  ${match[1]} -> SKIP (after cutoff)`);
          newLines.push(line);
          skipped++;
          continue;
        }
        // Apply offset: local + offset = UTC
        // If local is UTC+8, offset should be 8 to get UTC
        const utcDate = new Date(localDate.getTime() - offsetHours * 60 * 60 * 1000);
        const newTs = formatHeaderTimestamp(utcDate);
        console.log(`  ${match[1]} -> ${newTs}`);
        newLines.push(`## ${newTs}`);
        changes++;
        continue;
      }
    }
    newLines.push(line);
  }

  if (!dryRun && changes > 0) {
    fs.writeFileSync(memoryPath, newLines.join('\n'));
    console.log(`Written ${changes} changes to memory.md (skipped ${skipped})`);
  }

  return { changes, skipped };
}

// Migrate L1 filenames
function migrateL1Files(projectDir, offsetHours, dryRun = true) {
  const sessionsDir = path.join(projectDir, '.claude', SESSIONS_DIR);
  if (!fs.existsSync(sessionsDir)) {
    console.log('sessions dir not found');
    return { changes: 0 };
  }

  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl'));
  let changes = 0;

  for (const file of files) {
    const localDate = parseL1Filename(file);
    if (localDate) {
      const utcDate = new Date(localDate.getTime() - offsetHours * 60 * 60 * 1000);
      const newName = formatL1Filename(utcDate);
      if (file !== newName) {
        console.log(`  ${file} -> ${newName}`);
        if (!dryRun) {
          const oldPath = path.join(sessionsDir, file);
          const newPath = path.join(sessionsDir, newName);
          fs.renameSync(oldPath, newPath);
        }
        changes++;
      }
    }
  }

  return { changes };
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const offsetArg = args.find(a => a.startsWith('--offset='));
  const beforeArg = args.find(a => a.startsWith('--before='));
  const dryRun = !args.includes('--apply');

  if (!offsetArg) {
    console.log('Usage: migrate-timezone.js --offset=<hours> [--before=YYYY-MM-DD_HHMM] [--apply]');
    console.log('');
    console.log('  --offset=<hours>  Timezone offset from UTC (e.g., 9 for UTC+9, -8 for UTC-8)');
    console.log('  --before=<ts>     Only convert timestamps before this (skip already-UTC entries)');
    console.log('  --apply           Actually apply changes (default: dry run)');
    console.log('');
    console.log('Example: migrate-timezone.js --offset=9 --before=2026-02-01_1036 --apply');
    console.log('  Converts timestamps before 2026-02-01_1036, assuming UTC+9 timezone');
    process.exit(1);
  }

  const offset = parseInt(offsetArg.split('=')[1], 10);
  if (isNaN(offset)) {
    console.error('Invalid offset value');
    process.exit(1);
  }

  const beforeTs = beforeArg ? beforeArg.split('=')[1] : null;

  const projectDir = getProjectDir();
  console.log(`Project: ${projectDir}`);
  console.log(`Offset: UTC${offset >= 0 ? '+' : ''}${offset}`);
  console.log(`Before: ${beforeTs || 'ALL'}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log('');

  console.log('=== memory.md headers ===');
  const memResult = migrateMemoryMd(projectDir, offset, dryRun, beforeTs);

  console.log('');
  console.log('=== L1 filenames ===');
  const l1Result = migrateL1Files(projectDir, offset, dryRun);

  console.log('');
  console.log(`Total: ${memResult.changes + l1Result.changes} changes`);
  if (dryRun) {
    console.log('Run with --apply to execute changes');
  }
}

module.exports = { migrateMemoryMd, migrateL1Files };
