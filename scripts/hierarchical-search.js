const path = require('path');
const fs = require('fs');
const { getProjectDir, readJsonOrDefault, readFileOrDefault } = require('./utils');

/**
 * Hierarchical Search (H-MEM inspired top-down traversal)
 *
 * Search order: L4 → L3 → L2 → L1
 * - L4 (Keywords/Permanent): Fast index lookup
 * - L3 (Concepts): Category-level search
 * - L2 (Sessions): Session summary search
 * - L1 (Raw): Full-text search in raw sessions (expensive, last resort)
 */

const CONFIG = {
  MAX_L4_RESULTS: 10,
  MAX_L3_RESULTS: 5,
  MAX_L2_RESULTS: 5,
  MAX_L1_RESULTS: 3,
  L1_SEARCH_ENABLED: true  // Can disable for performance
};

/**
 * L4: Search keywords and permanent memory
 * Fastest - just index lookup
 */
function searchL4(query, projectDir) {
  const results = { keywords: [], permanent: [] };
  const factsPath = path.join(projectDir, 'facts.json');
  const facts = readJsonOrDefault(factsPath, null);

  if (!facts) return results;

  const queryLower = query.toLowerCase();

  // Search keywords index
  if (facts.keywords) {
    for (const [keyword, refs] of Object.entries(facts.keywords)) {
      if (keyword.includes(queryLower)) {
        results.keywords.push({
          keyword,
          refs: refs.slice(0, 5),
          score: keyword === queryLower ? 1.0 : 0.8
        });
      }
    }
    results.keywords.sort((a, b) => b.score - a.score);
    results.keywords = results.keywords.slice(0, CONFIG.MAX_L4_RESULTS);
  }

  // Search permanent memory
  if (facts.permanent) {
    const perm = facts.permanent;

    // Rules
    if (perm.rules) {
      perm.rules.forEach(r => {
        if (r.content.toLowerCase().includes(queryLower)) {
          results.permanent.push({ type: 'rule', ...r });
        }
      });
    }

    // Solutions
    if (perm.solutions) {
      perm.solutions.forEach(s => {
        if (s.problem.toLowerCase().includes(queryLower) ||
            s.solution.toLowerCase().includes(queryLower)) {
          results.permanent.push({ type: 'solution', ...s });
        }
      });
    }
  }

  return results;
}

/**
 * L3: Search concepts
 * Medium - searches concept names, keywords, files
 */
function searchL3(query, projectDir) {
  const results = [];
  const conceptsPath = path.join(projectDir, 'concepts.json');
  const data = readJsonOrDefault(conceptsPath, null);

  if (!data || !data.concepts) return results;

  const queryLower = query.toLowerCase();

  for (const concept of data.concepts) {
    let score = 0;

    // Name match (highest weight)
    if (concept.name.toLowerCase().includes(queryLower)) {
      score += 0.5;
    }

    // Keyword match
    if (concept.keywords?.some(k => k.toLowerCase().includes(queryLower))) {
      score += 0.3;
    }

    // File match
    if (concept.files?.some(f => f.toLowerCase().includes(queryLower))) {
      score += 0.2;
    }

    // Summary match
    if (concept.summary?.toLowerCase().includes(queryLower)) {
      score += 0.1;
    }

    if (score > 0) {
      results.push({ ...concept, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, CONFIG.MAX_L3_RESULTS);
}

/**
 * L2: Search session summaries
 * Medium-slow - searches L2 JSON files
 */
function searchL2(query, projectDir) {
  const results = [];
  const sessionsDir = path.join(projectDir, 'sessions');

  if (!fs.existsSync(sessionsDir)) return results;

  const queryLower = query.toLowerCase();
  const l2Files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.l2.json'))
    .sort()
    .reverse();

  for (const file of l2Files) {
    const l2Path = path.join(sessionsDir, file);
    const l2Data = readJsonOrDefault(l2Path, null);
    if (!l2Data || !l2Data.exchanges) continue;

    const sessionId = file.replace('.l2.json', '');

    for (const ex of l2Data.exchanges) {
      let score = 0;

      // Summary match
      if (ex.summary?.toLowerCase().includes(queryLower)) {
        score += 0.4;
      }

      // Keywords match
      if (ex.keywords?.some(k => k.toLowerCase().includes(queryLower))) {
        score += 0.3;
      }

      // Files match
      if (ex.files?.some(f => f.toLowerCase().includes(queryLower))) {
        score += 0.2;
      }

      // Details match
      if (ex.details?.toLowerCase().includes(queryLower)) {
        score += 0.1;
      }

      if (score > 0) {
        results.push({
          sessionId,
          exchangeId: ex.id,
          summary: ex.summary,
          keywords: ex.keywords || [],
          files: ex.files || [],
          score
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, CONFIG.MAX_L2_RESULTS);
}

/**
 * L1: Search raw/refined sessions (full-text)
 * Slowest - searches L1 JSONL files line by line
 */
function searchL1(query, projectDir) {
  if (!CONFIG.L1_SEARCH_ENABLED) return [];

  const results = [];
  const sessionsDir = path.join(projectDir, 'sessions');

  if (!fs.existsSync(sessionsDir)) return results;

  const queryLower = query.toLowerCase();
  const l1Files = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.l1.jsonl'))
    .sort()
    .reverse()
    .slice(0, 10);  // Only search recent 10 sessions

  for (const file of l1Files) {
    const l1Path = path.join(sessionsDir, file);
    const content = readFileOrDefault(l1Path, '');
    const lines = content.split('\n').filter(Boolean);

    const sessionId = file.replace('.l1.jsonl', '');
    let matchCount = 0;
    const matches = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const text = JSON.stringify(entry).toLowerCase();

        if (text.includes(queryLower)) {
          matchCount++;
          if (matches.length < 3) {
            // Extract relevant snippet
            const snippet = entry.content?.substring(0, 200) ||
                           entry.summary?.substring(0, 200) ||
                           'Match found';
            matches.push(snippet);
          }
        }
      } catch (e) {
        // Skip malformed lines
      }
    }

    if (matchCount > 0) {
      results.push({
        sessionId,
        matchCount,
        matches,
        file: l1Path
      });
    }
  }

  results.sort((a, b) => b.matchCount - a.matchCount);
  return results.slice(0, CONFIG.MAX_L1_RESULTS);
}

/**
 * Main: Hierarchical search across all layers
 */
function hierarchicalSearch(query) {
  if (!query) {
    console.log('Usage: node hierarchical-search.js <query>');
    console.log('Searches L4→L3→L2→L1 in order');
    return;
  }

  const projectDir = getProjectDir();
  console.log(`\n═══ Hierarchical Search: "${query}" ═══\n`);

  // L4: Keywords & Permanent
  console.log('## L4: Keywords & Permanent Memory');
  const l4Results = searchL4(query, projectDir);

  if (l4Results.keywords.length > 0) {
    console.log('**Keywords:**');
    l4Results.keywords.forEach(k => {
      console.log(`  - ${k.keyword} → ${k.refs.join(', ')}`);
    });
  }

  if (l4Results.permanent.length > 0) {
    console.log('**Permanent:**');
    l4Results.permanent.forEach(p => {
      if (p.type === 'rule') {
        console.log(`  - [Rule] ${p.content}`);
      } else if (p.type === 'solution') {
        console.log(`  - [Solution] ${p.problem}: ${p.solution}`);
      }
    });
  }

  if (l4Results.keywords.length === 0 && l4Results.permanent.length === 0) {
    console.log('  (no matches)');
  }

  // L3: Concepts
  console.log('\n## L3: Concepts');
  const l3Results = searchL3(query, projectDir);

  if (l3Results.length > 0) {
    l3Results.forEach(c => {
      const kw = c.keywords?.slice(0, 3).join(', ') || '';
      const files = c.files?.slice(0, 3).join(', ') || '';
      console.log(`  - **${c.name}** (score: ${c.score.toFixed(2)})`);
      if (kw) console.log(`    Keywords: ${kw}`);
      if (files) console.log(`    Files: ${files}`);
    });
  } else {
    console.log('  (no matches)');
  }

  // L2: Session summaries
  console.log('\n## L2: Session Summaries');
  const l2Results = searchL2(query, projectDir);

  if (l2Results.length > 0) {
    l2Results.forEach(s => {
      console.log(`  - **${s.sessionId}**: ${s.summary?.substring(0, 100) || 'No summary'}...`);
      if (s.keywords.length > 0) console.log(`    Keywords: ${s.keywords.join(', ')}`);
    });
  } else {
    console.log('  (no matches)');
  }

  // L1: Raw sessions (if enabled)
  if (CONFIG.L1_SEARCH_ENABLED) {
    console.log('\n## L1: Raw Sessions');
    const l1Results = searchL1(query, projectDir);

    if (l1Results.length > 0) {
      l1Results.forEach(s => {
        console.log(`  - **${s.sessionId}**: ${s.matchCount} matches`);
        s.matches.forEach(m => {
          console.log(`    "${m.substring(0, 80)}..."`);
        });
      });
    } else {
      console.log('  (no matches)');
    }
  }

  // Summary
  const totalResults = l4Results.keywords.length + l4Results.permanent.length +
                       l3Results.length + l2Results.length;
  console.log(`\n═══ Found ${totalResults} results across layers ═══\n`);
}

// CLI
if (require.main === module) {
  const query = process.argv.slice(2).join(' ');
  hierarchicalSearch(query);
}

module.exports = { hierarchicalSearch, searchL4, searchL3, searchL2, searchL1 };
