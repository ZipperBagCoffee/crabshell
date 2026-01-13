const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');

const FACTS_FILE = 'facts.json';

// Load facts - use utils.loadFacts for consistent structure
function loadFacts() {
  const { loadFacts: utilsLoadFacts } = require('./utils');
  return utilsLoadFacts();
}

// Save facts
function saveFacts(facts) {
  const factsPath = path.join(getProjectDir(), FACTS_FILE);
  // Update stats if exists
  if (facts.stats) {
    facts.stats.last_updated = new Date().toISOString().split('T')[0];
  }
  writeJson(factsPath, facts);
}

// Add keywords from L2/L3 to index
function indexKeywords(keywords, refs) {
  const facts = loadFacts();
  if (!facts) return;

  // Ensure keywords object exists
  if (!facts.keywords) facts.keywords = {};

  for (const kw of keywords) {
    const key = kw.toLowerCase();
    if (!facts.keywords[key]) {
      facts.keywords[key] = [];
    }
    for (const ref of refs) {
      if (!facts.keywords[key].includes(ref)) {
        facts.keywords[key].push(ref);
      }
    }
  }

  saveFacts(facts);
}

// Search by keyword
function searchKeywords(query) {
  const facts = loadFacts();
  if (!facts || !facts.keywords) return [];

  const results = [];
  const queryLower = query.toLowerCase();

  for (const [keyword, refs] of Object.entries(facts.keywords)) {
    if (keyword.includes(queryLower)) {
      results.push({ keyword, refs });
    }
  }

  return results;
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === 'search' && args[1]) {
    const results = searchKeywords(args[1]);
    if (results.length === 0) {
      console.log('[MEMORY_KEEPER] No keywords matched');
    } else {
      for (const r of results) {
        console.log(`[${r.keyword}] → ${r.refs.join(', ')}`);
      }
    }
  } else {
    console.log('Usage: node keyword-index.js search <query>');
  }
}

module.exports = { loadFacts, saveFacts, indexKeywords, searchKeywords };
