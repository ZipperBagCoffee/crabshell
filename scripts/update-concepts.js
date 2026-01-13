const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');

const CONCEPTS_FILE = 'concepts.json';

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

// LiSA-style: Find concept by ID (Claude assigns conceptId)
function findConceptById(conceptId, conceptsData) {
  if (!conceptId) return null;
  return conceptsData.concepts.find(c => c.id === conceptId);
}

// Legacy fallback: keyword-based matching (only if no conceptId provided)
// This is a simplified version - no overlap threshold, just exact keyword match
function findConceptByKeywords(keywords, conceptsData) {
  if (!keywords?.length) return null;

  // Find concept with at least one matching keyword
  for (const concept of conceptsData.concepts) {
    const hasMatch = keywords.some(kw =>
      concept.keywords.some(ck => ck.toLowerCase() === kw.toLowerCase())
    );
    if (hasMatch) return concept;
  }
  return null;
}

// Update concepts with new L2 exchanges (v11: LiSA-style)
// Now supports:
// - conceptId: Claude assigns existing concept ID
// - conceptName: Claude creates new concept with this name
// - topic: Short topic description (3-5 words)
function updateConcepts(l2Data) {
  const conceptsData = loadConcepts();

  for (const exchange of l2Data.exchanges) {
    // LiSA-style: Check if Claude assigned a conceptId or conceptName
    let matchingConcept = null;

    if (exchange.conceptId) {
      // Claude assigned existing concept
      matchingConcept = findConceptById(exchange.conceptId, conceptsData);
    }

    // Fallback: keyword-based matching (legacy support)
    if (!matchingConcept && !exchange.conceptName) {
      matchingConcept = findConceptByKeywords(exchange.keywords, conceptsData);
    }

    if (matchingConcept) {
      // Update existing concept
      if (!matchingConcept.exchanges.includes(exchange.id)) {
        matchingConcept.exchanges.push(exchange.id);
      }
      // Merge files and keywords
      matchingConcept.files = [...new Set([...matchingConcept.files, ...(exchange.files || [])])];
      matchingConcept.keywords = [...new Set([...matchingConcept.keywords, ...(exchange.keywords || [])])];
      // Add topic if provided
      if (exchange.topic && !matchingConcept.topics) {
        matchingConcept.topics = [];
      }
      if (exchange.topic && !matchingConcept.topics?.includes(exchange.topic)) {
        matchingConcept.topics = matchingConcept.topics || [];
        matchingConcept.topics.push(exchange.topic);
      }
      matchingConcept.updated = new Date().toISOString().split('T')[0];
    } else {
      // Create new concept
      // LiSA-style: Use conceptName if provided, otherwise generate from keywords/summary/facts
      let conceptName = exchange.conceptName || 'Unnamed concept';

      if (!exchange.conceptName) {
        if (exchange.keywords?.length > 0) {
          // Use first 2-3 keywords as name
          conceptName = exchange.keywords.slice(0, 3).join(' - ');
        } else if (exchange.facts?.length > 0) {
          // ProMem style: Use first fact
          conceptName = exchange.facts[0].substring(0, 50);
        } else if (exchange.summary) {
          // Legacy: Extract from summary
          const summary = exchange.summary;
          conceptName = summary.length <= 50 ? summary : summary.substring(0, 50) + '...';
        }
      }

      const newConcept = {
        id: `c${String(conceptsData.nextId++).padStart(3, '0')}`,
        name: conceptName,
        summary: exchange.details || exchange.summary || (exchange.facts?.join('. ')) || conceptName,
        exchanges: [exchange.id],
        files: exchange.files || [],
        keywords: exchange.keywords || [],
        updated: new Date().toISOString().split('T')[0]
      };

      // Add topic if provided (LiSA style)
      if (exchange.topic) {
        newConcept.topics = [exchange.topic];
      }

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

module.exports = { loadConcepts, saveConcepts, updateConcepts, findConceptById, findConceptByKeywords };
