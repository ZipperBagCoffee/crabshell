const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');

const CONCEPTS_FILE = 'concepts.json';
const OVERLAP_THRESHOLD = 0.3; // 30% overlap to match existing concept

// Load concepts
function loadConcepts() {
  const conceptsPath = path.join(getProjectDir(), CONCEPTS_FILE);
  return readJsonOrDefault(conceptsPath, { concepts: [], nextId: 1 });
}

// Save concepts
function saveConcepts(data) {
  const conceptsPath = path.join(getProjectDir(), CONCEPTS_FILE);
  writeJson(conceptsPath, data);
}

// Calculate overlap between two arrays
// Returns ratio of intersection to the smaller set (more lenient matching)
function calculateOverlap(arr1, arr2) {
  // Both empty = no basis for comparison, don't match
  if (!arr1?.length && !arr2?.length) return 0;

  // One empty = no overlap possible
  if (!arr1?.length || !arr2?.length) return 0;

  const set1 = new Set(arr1.map(s => s.toLowerCase()));
  const set2 = new Set(arr2.map(s => s.toLowerCase()));
  const intersection = [...set1].filter(x => set2.has(x));

  // Use Math.min for more lenient matching (easier to find overlap)
  return intersection.length / Math.min(set1.size, set2.size);
}

// Find matching concept or create new one
function findOrCreateConcept(exchange, conceptsData) {
  const { files = [], keywords = [] } = exchange;

  // Find best matching concept
  let bestMatch = null;
  let bestScore = 0;

  for (const concept of conceptsData.concepts) {
    const fileOverlap = calculateOverlap(files, concept.files);
    const keywordOverlap = calculateOverlap(keywords, concept.keywords);
    const score = (fileOverlap + keywordOverlap) / 2;

    if (score > bestScore && score >= OVERLAP_THRESHOLD) {
      bestScore = score;
      bestMatch = concept;
    }
  }

  return bestMatch;
}

// Update concepts with new L2 exchanges
function updateConcepts(l2Data) {
  const conceptsData = loadConcepts();

  for (const exchange of l2Data.exchanges) {
    const matchingConcept = findOrCreateConcept(exchange, conceptsData);

    if (matchingConcept) {
      // Update existing concept
      if (!matchingConcept.exchanges.includes(exchange.id)) {
        matchingConcept.exchanges.push(exchange.id);
      }
      // Merge files and keywords
      matchingConcept.files = [...new Set([...matchingConcept.files, ...(exchange.files || [])])];
      matchingConcept.keywords = [...new Set([...matchingConcept.keywords, ...(exchange.keywords || [])])];
      matchingConcept.updated = new Date().toISOString().split('T')[0];
    } else {
      // Create new concept with improved naming (v9.0.0)
      // Generate a short, descriptive name from keywords or summary
      let conceptName = 'Unnamed concept';
      if (exchange.keywords?.length > 0) {
        // Use first 2-3 keywords as name
        conceptName = exchange.keywords.slice(0, 3).join(' - ');
      } else if (exchange.summary) {
        // Extract key phrase from summary (first 50 chars, break at word)
        const summary = exchange.summary;
        if (summary.length <= 50) {
          conceptName = summary;
        } else {
          const truncated = summary.substring(0, 50);
          const lastSpace = truncated.lastIndexOf(' ');
          conceptName = lastSpace > 20 ? truncated.substring(0, lastSpace) + '...' : truncated + '...';
        }
      }

      const newConcept = {
        id: `c${String(conceptsData.nextId++).padStart(3, '0')}`,
        name: conceptName,
        summary: exchange.details || exchange.summary || conceptName,
        exchanges: [exchange.id],
        files: exchange.files || [],
        keywords: exchange.keywords || [],
        updated: new Date().toISOString().split('T')[0]
      };
      conceptsData.concepts.push(newConcept);
    }
  }

  saveConcepts(conceptsData);
  return conceptsData;
}

// CLI: node update-concepts.js <l2-path>
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node update-concepts.js <l2-path>');
    process.exit(1);
  }

  const l2Path = args[0];

  if (!fs.existsSync(l2Path)) {
    console.error(`[MEMORY_KEEPER] L2 file not found: ${l2Path}`);
    process.exit(1);
  }

  const l2Data = JSON.parse(fs.readFileSync(l2Path, 'utf8'));
  const result = updateConcepts(l2Data);

  console.log(`[MEMORY_KEEPER] Concepts updated: ${result.concepts.length} total concepts`);
}

module.exports = { loadConcepts, saveConcepts, updateConcepts, findOrCreateConcept };
