const path = require('path');
const fs = require('fs');
const { getProjectDir, readJsonOrDefault, writeJson, readFileOrDefault, ensureDir } = require('./utils');

/**
 * Auto-Compress: Hierarchical memory compression
 *
 * Strategy (inspired by H-MEM and mem0):
 * 1. L1 cleanup: Delete L1 if L2 exists (L2 is sufficient)
 * 2. L2→L3: Auto-update concepts from L2 files
 * 3. Archive: Move old sessions to archive
 * 4. Stats: Report space savings
 */

const CONFIG = {
  L1_KEEP_DAYS: 7,       // Keep L1 for 7 days even if L2 exists
  ARCHIVE_DAYS: 30,      // Archive sessions older than 30 days
  L2_REQUIRED_DAYS: 3    // Warn about L1 files older than 3 days without L2
};

/**
 * Get file age in days
 */
function getFileDays(filename) {
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return -1;

  const fileDate = new Date(match[1], parseInt(match[2]) - 1, parseInt(match[3]));
  const now = new Date();
  return Math.floor((now - fileDate) / (1000 * 60 * 60 * 24));
}

/**
 * Step 1: Clean up L1 files where L2 exists
 */
function cleanupL1(sessionsDir, stats) {
  const l1Files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l1.jsonl'));
  const l2Files = new Set(fs.readdirSync(sessionsDir).filter(f => f.endsWith('.l2.json')).map(f => f.replace('.l2.json', '')));

  for (const l1File of l1Files) {
    const sessionId = l1File.replace('.l1.jsonl', '');
    const days = getFileDays(l1File);

    if (l2Files.has(sessionId) && days > CONFIG.L1_KEEP_DAYS) {
      // L2 exists and L1 is old enough - safe to delete
      const l1Path = path.join(sessionsDir, l1File);
      const size = fs.statSync(l1Path).size;
      fs.unlinkSync(l1Path);
      stats.l1Deleted++;
      stats.bytesFreed += size;
      console.log(`  [L1] Deleted ${l1File} (L2 exists, ${days} days old, ${(size/1024).toFixed(1)}KB freed)`);
    } else if (!l2Files.has(sessionId) && days > CONFIG.L2_REQUIRED_DAYS) {
      // L2 missing for old L1 - needs processing
      stats.l1NeedsL2.push(l1File);
    }
  }

  // Also clean up raw files if L1 exists
  const rawFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.raw.jsonl'));
  const l1Set = new Set(l1Files.map(f => f.replace('.l1.jsonl', '')));

  for (const rawFile of rawFiles) {
    const sessionId = rawFile.replace('.raw.jsonl', '');
    if (l1Set.has(sessionId)) {
      const rawPath = path.join(sessionsDir, rawFile);
      const size = fs.statSync(rawPath).size;
      fs.unlinkSync(rawPath);
      stats.rawDeleted++;
      stats.bytesFreed += size;
      console.log(`  [RAW] Deleted ${rawFile} (L1 exists, ${(size/1024).toFixed(1)}KB freed)`);
    }
  }
}

/**
 * Step 2: Update L3 concepts from all L2 files
 */
function updateL3FromL2(sessionsDir, projectDir, stats) {
  const { updateConcepts, loadConcepts } = require('./update-concepts');

  const l2Files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.l2.json'))
    .sort();

  const beforeCount = loadConcepts().concepts?.length || 0;

  for (const l2File of l2Files) {
    const l2Path = path.join(sessionsDir, l2File);
    const l2Data = readJsonOrDefault(l2Path, null);
    if (l2Data && l2Data.exchanges) {
      try {
        updateConcepts(l2Data);
      } catch (e) {
        // Ignore errors
      }
    }
  }

  const afterCount = loadConcepts().concepts?.length || 0;
  stats.conceptsAdded = afterCount - beforeCount;

  if (stats.conceptsAdded > 0) {
    console.log(`  [L3] Added ${stats.conceptsAdded} new concepts`);
  }
}

/**
 * Step 3: Archive old sessions
 */
function archiveOldSessions(sessionsDir, stats) {
  const files = fs.readdirSync(sessionsDir).filter(f =>
    (f.endsWith('.md') || f.endsWith('.l2.json')) &&
    !f.includes('archive')
  );

  const archiveDir = path.join(sessionsDir, 'archive');

  for (const file of files) {
    const days = getFileDays(file);
    if (days > CONFIG.ARCHIVE_DAYS) {
      ensureDir(archiveDir);
      const src = path.join(sessionsDir, file);
      const dest = path.join(archiveDir, file);
      fs.renameSync(src, dest);
      stats.archived++;
      console.log(`  [ARCHIVE] Moved ${file} (${days} days old)`);
    }
  }
}

/**
 * Step 4: Consolidate memory.md (remove duplicates, keep recent)
 */
function consolidateMemoryMd(projectDir, stats) {
  const memoryPath = path.join(projectDir, 'memory.md');
  if (!fs.existsSync(memoryPath)) return;

  const content = readFileOrDefault(memoryPath, '');
  const lines = content.split('\n');

  // Parse sections
  const sections = [];
  let currentSection = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentSection) sections.push(currentSection);
      currentSection = { header: line, lines: [] };
    } else if (currentSection) {
      currentSection.lines.push(line);
    }
  }
  if (currentSection) sections.push(currentSection);

  // Deduplicate by header
  const seen = new Set();
  const uniqueSections = [];

  // Process in reverse to keep most recent
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    if (!seen.has(section.header)) {
      seen.add(section.header);
      uniqueSections.unshift(section);
    } else {
      stats.duplicatesRemoved++;
    }
  }

  // Keep only last 100 sections
  const maxSections = 100;
  if (uniqueSections.length > maxSections) {
    const removed = uniqueSections.length - maxSections;
    uniqueSections.splice(0, removed);
    stats.sectionsRemoved += removed;
  }

  // Write back
  const newContent = uniqueSections
    .map(s => [s.header, ...s.lines].join('\n'))
    .join('\n\n');

  const oldSize = Buffer.byteLength(content, 'utf8');
  const newSize = Buffer.byteLength(newContent, 'utf8');

  if (newSize < oldSize) {
    fs.writeFileSync(memoryPath, newContent);
    stats.bytesFreed += (oldSize - newSize);
    console.log(`  [MEMORY.MD] Consolidated: ${(oldSize/1024).toFixed(1)}KB → ${(newSize/1024).toFixed(1)}KB`);
  }
}

/**
 * Main: Run auto-compression
 */
function autoCompress() {
  const projectDir = getProjectDir();
  const sessionsDir = path.join(projectDir, 'sessions');

  console.log('\n═══ Memory Keeper: Auto-Compress ═══\n');

  if (!fs.existsSync(sessionsDir)) {
    console.log('No sessions directory found.');
    return;
  }

  const stats = {
    l1Deleted: 0,
    rawDeleted: 0,
    l1NeedsL2: [],
    conceptsAdded: 0,
    archived: 0,
    duplicatesRemoved: 0,
    sectionsRemoved: 0,
    bytesFreed: 0
  };

  console.log('## Step 1: L1 Cleanup');
  cleanupL1(sessionsDir, stats);

  console.log('\n## Step 2: L3 Concepts Update');
  updateL3FromL2(sessionsDir, projectDir, stats);

  console.log('\n## Step 3: Archive Old Sessions');
  archiveOldSessions(sessionsDir, stats);

  console.log('\n## Step 4: Consolidate memory.md');
  consolidateMemoryMd(projectDir, stats);

  // Summary
  console.log('\n═══ Compression Summary ═══');
  console.log(`  L1 files deleted: ${stats.l1Deleted}`);
  console.log(`  RAW files deleted: ${stats.rawDeleted}`);
  console.log(`  Sessions archived: ${stats.archived}`);
  console.log(`  Concepts added: ${stats.conceptsAdded}`);
  console.log(`  Duplicates removed: ${stats.duplicatesRemoved}`);
  console.log(`  Space freed: ${(stats.bytesFreed / 1024).toFixed(1)} KB`);

  if (stats.l1NeedsL2.length > 0) {
    console.log(`\n⚠️  ${stats.l1NeedsL2.length} L1 files need L2 processing:`);
    stats.l1NeedsL2.slice(0, 5).forEach(f => console.log(`    - ${f}`));
    if (stats.l1NeedsL2.length > 5) {
      console.log(`    ... and ${stats.l1NeedsL2.length - 5} more`);
    }
    console.log('  Run: node scripts/counter.js build-l2-prompts');
  }

  console.log('\n═══ Done ═══\n');
}

// CLI
if (require.main === module) {
  autoCompress();
}

module.exports = { autoCompress };
