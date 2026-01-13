const fs = require('fs');
const path = require('path');

// Auto-generate L2 from L1 by extracting key information
function autoGenerateL2(l1Path) {
  if (!fs.existsSync(l1Path)) return null;

  const lines = fs.readFileSync(l1Path, 'utf8').split('\n').filter(l => l.trim());

  const userRequests = [];
  const toolsUsed = new Set();
  const filesModified = new Set();
  const keywords = new Set();
  let exchangeCount = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);

      if (entry.role === 'user' && entry.text) {
        exchangeCount++;
        // Extract first 100 chars of user request
        const text = entry.text.replace(/<[^>]*>/g, '').trim();
        if (text.length > 5 && !text.startsWith('Caveat:')) {
          userRequests.push(text.substring(0, 100));
        }
      }

      if (entry.role === 'tool' && entry.name) {
        toolsUsed.add(entry.name);
        if (entry.target) {
          const fileName = path.basename(entry.target);
          filesModified.add(fileName);
          // Extract keywords from filename
          const parts = fileName.replace(/\.[^.]+$/, '').split(/[-_]/);
          parts.forEach(p => {
            if (p.length > 2) keywords.add(p.toLowerCase());
          });
        }
      }

      if (entry.role === 'assistant' && entry.text) {
        // Extract keywords from assistant response
        const matches = entry.text.match(/[가-힣]{2,}|[a-zA-Z]{4,}/g) || [];
        matches.slice(0, 5).forEach(m => {
          if (m.length < 15) keywords.add(m.toLowerCase());
        });
      }
    } catch (e) {
      // Skip invalid lines
    }
  }

  if (exchangeCount === 0) return null;

  // Generate summary
  const mainRequest = userRequests[0] || 'Session work';
  const tools = Array.from(toolsUsed).slice(0, 5);
  const files = Array.from(filesModified).slice(0, 10);
  const kw = Array.from(keywords).slice(0, 5);

  // Create L2 structure
  const l2 = {
    exchanges: [{
      id: 'e001',
      summary: mainRequest.substring(0, 80) + (mainRequest.length > 80 ? '...' : ''),
      details: `Session with ${exchangeCount} exchanges. Tools: ${tools.join(', ') || 'none'}`,
      files: files,
      keywords: kw.length > 0 ? kw : ['session'],
      l1_range: [1, lines.length]
    }]
  };

  // Add more exchanges if significant activity
  if (exchangeCount > 5 && userRequests.length > 1) {
    for (let i = 1; i < Math.min(userRequests.length, 4); i++) {
      l2.exchanges.push({
        id: `e00${i + 1}`,
        summary: userRequests[i].substring(0, 80),
        details: 'Continued work in session',
        files: [],
        keywords: [],
        l1_range: [1, lines.length]
      });
    }
  }

  return l2;
}

// Process all L1 files in a directory
function processAllL1(sessionsDir) {
  if (!fs.existsSync(sessionsDir)) {
    console.log('[AUTO-L2] Sessions directory not found');
    return;
  }

  const l1Files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.l1.jsonl'))
    .filter(f => !fs.existsSync(path.join(sessionsDir, f.replace('.l1.jsonl', '.l2.json'))));

  if (l1Files.length === 0) {
    console.log('[AUTO-L2] All L1 files already have L2 versions');
    return;
  }

  console.log(`[AUTO-L2] Processing ${l1Files.length} L1 files...`);

  let processed = 0;
  let skipped = 0;

  for (const file of l1Files) {
    const l1Path = path.join(sessionsDir, file);
    const l2Path = l1Path.replace('.l1.jsonl', '.l2.json');

    try {
      const l2 = autoGenerateL2(l1Path);
      if (l2) {
        fs.writeFileSync(l2Path, JSON.stringify(l2, null, 2));
        processed++;
        if (processed % 50 === 0) {
          console.log(`  Processed ${processed}/${l1Files.length}...`);
        }
      } else {
        skipped++;
      }
    } catch (e) {
      console.log(`  ${file}: ERROR - ${e.message}`);
      skipped++;
    }
  }

  console.log(`[AUTO-L2] Done: ${processed} processed, ${skipped} skipped`);
}

// CLI
if (require.main === module) {
  const sessionsDir = process.argv[2] || path.join(process.cwd(), '.claude', 'memory', 'sessions');
  processAllL1(sessionsDir);
}

module.exports = { autoGenerateL2, processAllL1 };
