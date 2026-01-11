const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');

const OLD_FACTS_FILE = 'facts.json';

function migrateFacts() {
  const factsPath = path.join(getProjectDir(), OLD_FACTS_FILE);
  const oldFacts = readJsonOrDefault(factsPath, null);

  if (!oldFacts) {
    // Initialize new structure
    const newFacts = initNewFacts();
    writeJson(factsPath, newFacts);
    console.log('[MEMORY_KEEPER] Initialized new facts.json structure');
    return newFacts;
  }

  // Check if already migrated
  if (oldFacts.keywords && oldFacts.permanent) {
    console.log('[MEMORY_KEEPER] facts.json already in new format');
    return oldFacts;
  }

  // Migrate old structure
  const newFacts = initNewFacts();

  // Convert old decisions to rules
  if (oldFacts.decisions) {
    for (const d of oldFacts.decisions) {
      newFacts.permanent.rules.push({
        id: d.id.replace('d', 'r'),
        content: d.content,
        reason: d.reason,
        source: 'migrated',
        confidence: 0.8,
        contradictions: 0,
        created: d.date,
        last_validated: d.date
      });
      newFacts._meta.nextRuleId++;
    }
  }

  // Convert old patterns to rules
  if (oldFacts.patterns) {
    for (const p of oldFacts.patterns) {
      newFacts.permanent.rules.push({
        id: `r${String(newFacts._meta.nextRuleId++).padStart(3, '0')}`,
        content: p.content,
        source: 'migrated',
        confidence: 0.8,
        contradictions: 0,
        created: p.date,
        last_validated: p.date
      });
    }
  }

  // Convert old issues to solutions (resolved only)
  if (oldFacts.issues) {
    for (const i of oldFacts.issues) {
      if (i.status === 'resolved') {
        newFacts.permanent.solutions.push({
          id: `s${String(newFacts._meta.nextSolutionId++).padStart(3, '0')}`,
          problem: i.content,
          solution: 'See resolution details',
          attempts: 1,
          confidence: 0.7,
          created: i.date
        });
      }
    }
  }

  // Save migrated facts
  writeJson(factsPath, newFacts);
  console.log('[MEMORY_KEEPER] facts.json migrated to new format');
  console.log(`  Rules: ${newFacts.permanent.rules.length}`);
  console.log(`  Solutions: ${newFacts.permanent.solutions.length}`);
  return newFacts;
}

function initNewFacts() {
  return {
    keywords: {},
    permanent: {
      rules: [],
      solutions: [],
      core_logic: []
    },
    stats: {
      total_exchanges: 0,
      total_concepts: 0,
      last_updated: new Date().toISOString().split('T')[0]
    },
    _meta: {
      version: 2,
      nextRuleId: 1,
      nextSolutionId: 1,
      nextCoreLogicId: 1
    }
  };
}

// CLI
if (require.main === module) {
  migrateFacts();
}

module.exports = { migrateFacts, initNewFacts };
