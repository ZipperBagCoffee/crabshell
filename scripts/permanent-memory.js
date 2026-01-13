const fs = require('fs');
const path = require('path');
const { loadFacts, saveFacts } = require('./keyword-index');

// Add a rule (user explicit or detected pattern)
function addRule(content, reason, source = 'auto') {
  const facts = loadFacts();
  if (!facts) {
    console.error('[MEMORY_KEEPER] No facts.json found. Run migrate-facts first.');
    return null;
  }

  const id = `r${String(facts._meta.nextRuleId++).padStart(3, '0')}`;
  const rule = {
    id,
    content,
    reason,
    source,
    confidence: source === 'user' ? 1.0 : 0.7,
    contradictions: 0,
    created: new Date().toISOString().split('T')[0],
    last_validated: new Date().toISOString().split('T')[0]
  };

  facts.permanent.rules.push(rule);
  saveFacts(facts);

  console.log(`[MEMORY_KEEPER] Added rule: ${id}`);
  return rule;
}

// Add a solution (repeated problem → fix)
function addSolution(problem, solution, attempts = 1) {
  const facts = loadFacts();
  if (!facts) {
    console.error('[MEMORY_KEEPER] No facts.json found. Run migrate-facts first.');
    return null;
  }

  const id = `s${String(facts._meta.nextSolutionId++).padStart(3, '0')}`;
  const sol = {
    id,
    problem,
    solution,
    attempts,
    confidence: Math.min(0.5 + (attempts * 0.05), 0.95),
    created: new Date().toISOString().split('T')[0]
  };

  facts.permanent.solutions.push(sol);
  saveFacts(facts);

  console.log(`[MEMORY_KEEPER] Added solution: ${id}`);
  return sol;
}

// Add core logic entry
function addCoreLogic(feature, description, files = []) {
  const facts = loadFacts();
  if (!facts) {
    console.error('[MEMORY_KEEPER] No facts.json found. Run migrate-facts first.');
    return null;
  }

  const id = `cl${String(facts._meta.nextCoreLogicId++).padStart(3, '0')}`;
  const entry = {
    id,
    feature,
    description,
    files,
    created: new Date().toISOString().split('T')[0]
  };

  facts.permanent.core_logic.push(entry);
  saveFacts(facts);

  console.log(`[MEMORY_KEEPER] Added core logic: ${id}`);
  return entry;
}

// Record contradiction (for self-correction)
function recordContradiction(ruleId) {
  const facts = loadFacts();
  if (!facts) return;

  const rule = facts.permanent.rules.find(r => r.id === ruleId);
  if (rule) {
    rule.contradictions = (rule.contradictions || 0) + 1;

    if (rule.contradictions >= 5) {
      console.log(`[MEMORY_KEEPER] WARNING: Rule ${ruleId} has ${rule.contradictions} contradictions - review needed`);
    }

    saveFacts(facts);
  }
}

// Validate rule (reset contradictions, update confidence)
function validateRule(ruleId) {
  const facts = loadFacts();
  if (!facts) return;

  const rule = facts.permanent.rules.find(r => r.id === ruleId);
  if (rule) {
    rule.contradictions = 0;
    rule.confidence = Math.min(rule.confidence + 0.1, 1.0);
    rule.last_validated = new Date().toISOString().split('T')[0];
    saveFacts(facts);
    console.log(`[MEMORY_KEEPER] Rule ${ruleId} validated`);
  } else {
    console.log(`[MEMORY_KEEPER] Rule ${ruleId} not found`);
  }
}

// Delete rule (after review determines it's wrong)
function deleteRule(ruleId) {
  const facts = loadFacts();
  if (!facts) return;

  const before = facts.permanent.rules.length;
  facts.permanent.rules = facts.permanent.rules.filter(r => r.id !== ruleId);

  if (facts.permanent.rules.length < before) {
    saveFacts(facts);
    console.log(`[MEMORY_KEEPER] Rule ${ruleId} deleted`);
  } else {
    console.log(`[MEMORY_KEEPER] Rule ${ruleId} not found`);
  }
}

// List permanent memories
function listPermanent() {
  const facts = loadFacts();
  if (!facts) {
    console.log('[MEMORY_KEEPER] No facts found');
    return;
  }

  console.log('[MEMORY_KEEPER] Permanent Memory:\n');

  if (facts.permanent.rules.length > 0) {
    console.log('RULES:');
    for (const r of facts.permanent.rules) {
      const conf = (r.confidence * 100).toFixed(0);
      const warn = r.contradictions >= 5 ? ' ⚠️ NEEDS REVIEW' : '';
      console.log(`  [${r.id}] ${r.content} (${conf}% confidence)${warn}`);
    }
    console.log('');
  }

  if (facts.permanent.solutions.length > 0) {
    console.log('SOLUTIONS:');
    for (const s of facts.permanent.solutions) {
      console.log(`  [${s.id}] ${s.problem}`);
      console.log(`         → ${s.solution}`);
    }
    console.log('');
  }

  if (facts.permanent.core_logic.length > 0) {
    console.log('CORE LOGIC:');
    for (const c of facts.permanent.core_logic) {
      console.log(`  [${c.id}] ${c.feature}: ${c.description}`);
    }
  }
}

// === v11: Reflection-based Auto-Promotion ===

// Get promotion candidates from L2 files (Reflection Step 1-2)
// Returns patterns that appear frequently across sessions
function getPromotionCandidates(sessionsDir) {
  const { getProjectDir } = require('./utils');
  const dir = sessionsDir || path.join(getProjectDir(), 'sessions');

  if (!fs.existsSync(dir)) {
    return { keywords: [], files: [], decisions: [] };
  }

  const l2Files = fs.readdirSync(dir).filter(f => f.endsWith('.l2.json'));
  const patterns = {
    keywords: {},      // keyword → count
    files: {},         // file → count
    facts: [],         // all facts for analysis
    decisions: {}      // decision pattern → count
  };

  // Aggregate patterns from L2 files
  for (const file of l2Files) {
    try {
      const l2Data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

      for (const ex of l2Data.exchanges || []) {
        // Count keywords
        for (const kw of ex.keywords || []) {
          const key = kw.toLowerCase();
          patterns.keywords[key] = (patterns.keywords[key] || 0) + 1;
        }

        // Count files
        for (const f of ex.files || []) {
          patterns.files[f] = (patterns.files[f] || 0) + 1;
        }

        // Collect facts for analysis
        if (ex.facts?.length > 0) {
          patterns.facts.push(...ex.facts);
        } else if (ex.summary) {
          patterns.facts.push(ex.summary);
        }
      }
    } catch (e) {
      // Skip invalid files
    }
  }

  // Filter by frequency (>= 3 occurrences)
  const keywordCandidates = Object.entries(patterns.keywords)
    .filter(([k, v]) => v >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([k, v]) => ({ keyword: k, count: v }));

  const fileCandidates = Object.entries(patterns.files)
    .filter(([k, v]) => v >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([k, v]) => ({ file: k, count: v }));

  return {
    keywords: keywordCandidates,
    files: fileCandidates,
    facts: patterns.facts.slice(0, 50),  // For Claude to analyze
    totalL2Files: l2Files.length
  };
}

// Cleanup by utility (Reflection Step 5)
// Remove rules that are old and unused, or have too many contradictions
function cleanupByUtility() {
  const facts = loadFacts();
  if (!facts) return { removed: 0 };

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const cutoffDate = sixMonthsAgo.toISOString().split('T')[0];

  const before = facts.permanent.rules.length;
  const removed = [];

  facts.permanent.rules = facts.permanent.rules.filter(r => {
    // Remove if: 6 months old AND not validated recently
    const isOld = r.last_validated < cutoffDate;
    // Remove if: 2+ contradictions AND low confidence
    const hasContradictions = r.contradictions >= 2 && r.confidence < 0.7;

    if (isOld || hasContradictions) {
      removed.push(r);
      return false;
    }
    return true;
  });

  if (removed.length > 0) {
    saveFacts(facts);
    console.log(`[MEMORY_KEEPER] Cleanup: Removed ${removed.length} rules`);
    for (const r of removed) {
      console.log(`  - ${r.id}: ${r.content.substring(0, 50)}...`);
    }
  }

  return { removed: removed.length, rules: removed };
}

// Generate Reflection prompt for Claude (used by compress command)
function generateReflectionPrompt(candidates) {
  const { keywords, files, facts, totalL2Files } = candidates;

  let prompt = `
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER] L4 REFLECTION - Pattern Analysis
═══════════════════════════════════════════════════════════════

Analyzed ${totalL2Files} L2 files. Found the following patterns:

**Frequent Keywords (3+ occurrences):**
${keywords.map(k => `- ${k.keyword}: ${k.count} times`).join('\n') || 'None'}

**Frequently Modified Files (3+ times):**
${files.map(f => `- ${f.file}: ${f.count} times`).join('\n') || 'None'}

**Recent Facts (sample):**
${facts.slice(0, 10).map(f => `- ${f.substring(0, 100)}`).join('\n') || 'None'}

═══════════════════════════════════════════════════════════════

**YOUR TASK: Identify patterns for L4 promotion**

Review the above and identify:

1. **Rules to add** - Repeated decisions/principles that should be permanent
   \`\`\`bash
   node scripts/counter.js add-rule "rule content" "why this matters" "auto"
   \`\`\`

2. **Solutions to add** - Repeated problem→fix patterns
   \`\`\`bash
   node scripts/counter.js add-solution "the problem" "the solution" <attempts>
   \`\`\`

3. **Core logic to add** - Key implementation patterns
   \`\`\`bash
   node scripts/counter.js add-core-logic "feature" "description" "file1,file2"
   \`\`\`

**Validation criteria:**
- Is this pattern likely to be useful in future sessions?
- Is it generalizable (not project-specific)?
- Does evidence support it (not a hallucination)?

Only promote patterns that pass ALL criteria.
═══════════════════════════════════════════════════════════════`;

  return prompt;
}

module.exports = {
  addRule,
  addSolution,
  addCoreLogic,
  recordContradiction,
  validateRule,
  deleteRule,
  listPermanent,
  // v11: Reflection-based auto-promotion
  getPromotionCandidates,
  cleanupByUtility,
  generateReflectionPrompt
};
