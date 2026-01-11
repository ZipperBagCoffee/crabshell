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

module.exports = {
  addRule,
  addSolution,
  addCoreLogic,
  recordContradiction,
  validateRule,
  deleteRule,
  listPermanent
};
