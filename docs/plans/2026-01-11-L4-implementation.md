# L4 Permanent Memory Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automate permanent memory recording with trigger detection and self-correction

**Architecture:**
- Enhanced facts.json with keywords index, rules/solutions/core_logic, confidence tracking
- Auto-record triggers: user explicit, repeated solution, breakthrough, core logic
- Self-correction: track contradictions, flag for review when threshold reached

**Tech Stack:** Node.js, JSON

---

## Task 1: Migrate facts.json to New Structure

**Files:**
- Create: `scripts/migrate-facts.js`
- Modify: `scripts/counter.js` (loadFacts/saveFacts)

**Step 1: Create migration script**

```javascript
const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');

const OLD_FACTS_FILE = 'facts.json';

function migrateFacts() {
  const factsPath = path.join(getProjectDir(), OLD_FACTS_FILE);
  const oldFacts = readJsonOrDefault(factsPath, null);

  if (!oldFacts) {
    // Initialize new structure
    return initNewFacts();
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
    }
  }

  // Convert old patterns to rules
  if (oldFacts.patterns) {
    for (const p of oldFacts.patterns) {
      newFacts.permanent.rules.push({
        id: p.id.replace('p', 'r'),
        content: p.content,
        source: 'migrated',
        confidence: 0.8,
        contradictions: 0,
        created: p.date,
        last_validated: p.date
      });
    }
  }

  // Convert old issues to solutions (resolved) or open issues
  if (oldFacts.issues) {
    for (const i of oldFacts.issues) {
      if (i.status === 'resolved') {
        newFacts.permanent.solutions.push({
          id: i.id.replace('i', 's'),
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
```

**Step 2: Test migration**

```bash
node scripts/migrate-facts.js
cat .claude/memory/facts.json
```

**Step 3: Commit**

```bash
git add scripts/migrate-facts.js
git commit -m "feat(L4): add facts.json migration script"
```

---

## Task 2: Create Keyword Index Manager

**Files:**
- Create: `scripts/keyword-index.js`

**Step 1: Create keyword indexing functions**

```javascript
const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');

const FACTS_FILE = 'facts.json';

// Load facts
function loadFacts() {
  const factsPath = path.join(getProjectDir(), FACTS_FILE);
  return readJsonOrDefault(factsPath, null);
}

// Save facts
function saveFacts(facts) {
  const factsPath = path.join(getProjectDir(), FACTS_FILE);
  facts.stats.last_updated = new Date().toISOString().split('T')[0];
  writeJson(factsPath, facts);
}

// Add keywords from L2/L3 to index
function indexKeywords(keywords, refs) {
  const facts = loadFacts();
  if (!facts) return;

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
  if (!facts) return [];

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
```

**Step 2: Commit**

```bash
git add scripts/keyword-index.js
git commit -m "feat(L4): add keyword index manager"
```

---

## Task 3: Create Auto-Trigger Detection

**Files:**
- Create: `scripts/auto-triggers.js`

**Step 1: Create trigger detection functions**

```javascript
const fs = require('fs');
const path = require('path');

// Patterns that indicate user wants something remembered
const USER_EXPLICIT_PATTERNS = [
  /remember (this|that)/i,
  /always do/i,
  /never do/i,
  /from now on/i,
  /기억해/,
  /항상/,
  /앞으로는/
];

// Detect user explicit request
function detectUserExplicit(text) {
  for (const pattern of USER_EXPLICIT_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

// Detect if this is a repeated issue (needs history)
function detectRepeatedSolution(issueText, history) {
  // Count similar issues in history
  const similar = history.filter(h =>
    h.type === 'issue' &&
    calculateSimilarity(h.content, issueText) > 0.6
  );
  return similar.length >= 10;
}

// Simple word-based similarity
function calculateSimilarity(text1, text2) {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  const intersection = [...words1].filter(w => words2.has(w));
  return intersection.length / Math.max(words1.size, words2.size);
}

// Detect breakthrough (multiple failures then success)
function detectBreakthrough(attempts, success) {
  return attempts >= 3 && success;
}

// Detect core logic change
const CORE_LOGIC_PATTERNS = [
  /architecture/i,
  /core (function|feature|system)/i,
  /main (logic|flow)/i,
  /구조 변경/,
  /핵심 기능/
];

function detectCoreLogic(text, files) {
  // Check text patterns
  for (const pattern of CORE_LOGIC_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  // Check if modifying core files (heuristic: state, core, main in name)
  const coreFilePatterns = [/state/i, /core/i, /main/i, /index/i];
  for (const file of files || []) {
    for (const pattern of coreFilePatterns) {
      if (pattern.test(file)) {
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  detectUserExplicit,
  detectRepeatedSolution,
  detectBreakthrough,
  detectCoreLogic,
  calculateSimilarity
};
```

**Step 2: Commit**

```bash
git add scripts/auto-triggers.js
git commit -m "feat(L4): add auto-trigger detection for permanent memory"
```

---

## Task 4: Create Permanent Memory Manager

**Files:**
- Create: `scripts/permanent-memory.js`

**Step 1: Create permanent memory CRUD functions**

```javascript
const fs = require('fs');
const path = require('path');
const { loadFacts, saveFacts } = require('./keyword-index');

// Add a rule (user explicit or detected pattern)
function addRule(content, reason, source = 'auto') {
  const facts = loadFacts();
  if (!facts) return null;

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
  if (!facts) return null;

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
  if (!facts) return null;

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
  }
}

// Delete rule (after review determines it's wrong)
function deleteRule(ruleId) {
  const facts = loadFacts();
  if (!facts) return;

  facts.permanent.rules = facts.permanent.rules.filter(r => r.id !== ruleId);
  saveFacts(facts);
  console.log(`[MEMORY_KEEPER] Rule ${ruleId} deleted`);
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
```

**Step 2: Commit**

```bash
git add scripts/permanent-memory.js
git commit -m "feat(L4): add permanent memory manager with self-correction"
```

---

## Task 5: Integrate L4 Commands into counter.js

**Files:**
- Modify: `scripts/counter.js`

**Step 1: Add L4 commands to switch**

```javascript
// Add these cases to the main switch

case 'migrate-facts':
  const { migrateFacts } = require('./migrate-facts');
  migrateFacts();
  break;

case 'add-rule':
  // node counter.js add-rule "content" "reason" [source]
  const { addRule } = require('./permanent-memory');
  addRule(args[1], args[2], args[3] || 'user');
  break;

case 'add-solution':
  // node counter.js add-solution "problem" "solution" [attempts]
  const { addSolution } = require('./permanent-memory');
  addSolution(args[1], args[2], parseInt(args[3]) || 1);
  break;

case 'add-core-logic':
  // node counter.js add-core-logic "feature" "description" [files]
  const { addCoreLogic } = require('./permanent-memory');
  const files = args[4] ? args[4].split(',') : [];
  addCoreLogic(args[1], args[2], files);
  break;

case 'list-permanent':
  const { listPermanent } = require('./permanent-memory');
  listPermanent();
  break;

case 'validate-rule':
  const { validateRule } = require('./permanent-memory');
  validateRule(args[1]);
  break;

case 'delete-rule':
  const { deleteRule } = require('./permanent-memory');
  deleteRule(args[1]);
  break;

case 'search-keywords':
  const { searchKeywords } = require('./keyword-index');
  const kwResults = searchKeywords(args[1]);
  if (kwResults.length === 0) {
    console.log('[MEMORY_KEEPER] No keywords matched');
  } else {
    for (const r of kwResults) {
      console.log(`[${r.keyword}] → ${r.refs.join(', ')}`);
    }
  }
  break;
```

**Step 2: Update help text**

```
L4 Permanent Memory:
  migrate-facts              Migrate facts.json to new format
  add-rule <content> <reason> [source]  Add a rule
  add-solution <problem> <solution> [attempts]  Add a solution
  add-core-logic <feature> <desc> [files]  Add core logic
  list-permanent             List all permanent memories
  validate-rule <id>         Validate a rule (reset contradictions)
  delete-rule <id>           Delete a rule
  search-keywords <query>    Search keyword index
```

**Step 3: Commit**

```bash
git commit -am "feat(L4): integrate L4 commands into counter.js"
```

---

## Task 6: Update final() Hook with L4 Triggers

**Files:**
- Modify: `scripts/counter.js`

**Step 1: Update final() to include L4 instructions**

Add to the instructions template after L2-L3 steps:

```javascript
**STEP 8: Check for Permanent Memories**

Review this session for items to permanently remember:

1. **User explicit requests** - Did user say "remember", "always", "never", "from now on"?
   \`\`\`bash
   node "${scriptPath}" add-rule "what to remember" "why" "user"
   \`\`\`

2. **Repeated solutions** - Was a problem solved that appeared 10+ times?
   \`\`\`bash
   node "${scriptPath}" add-solution "the problem" "the solution" <attempts>
   \`\`\`

3. **Breakthroughs** - Multiple failed attempts then success?
   \`\`\`bash
   node "${scriptPath}" add-solution "what was failing" "what fixed it" <attempts>
   \`\`\`

4. **Core logic changes** - Major architecture/feature changes?
   \`\`\`bash
   node "${scriptPath}" add-core-logic "feature name" "what changed" "file1.js,file2.js"
   \`\`\`
```

**Step 2: Commit**

```bash
git commit -am "feat(L4): update final() hook with L4 trigger instructions"
```

---

## Task 7: Update Version to 8.2.0

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `README.md`

**Step 1: Bump version**

```json
"version": "8.2.0"
```

**Step 2: Update README**

```markdown
## v8.2.0 - L4 Permanent Memory Automation

### Auto-Record Triggers
- **User explicit**: "Remember this", "Always do X", "From now on"
- **Repeated solution**: Same issue 10+ times, then fixed
- **Breakthrough**: Multiple failures then success
- **Core logic**: Major architecture/feature changes

### Self-Correction
- Rules track `confidence` and `contradictions`
- After 5 contradictions, rule is flagged for review
- `validate-rule` resets contradictions, boosts confidence
- `delete-rule` removes incorrect rules

### New Commands
- `migrate-facts` - Migrate facts.json to new format
- `add-rule <content> <reason> [source]` - Add permanent rule
- `add-solution <problem> <solution> [attempts]` - Add solution
- `add-core-logic <feature> <desc> [files]` - Add core logic
- `list-permanent` - List all permanent memories
- `validate-rule <id>` - Validate a rule
- `delete-rule <id>` - Delete a rule
- `search-keywords <query>` - Search keyword index
```

**Step 3: Commit and push**

```bash
git add -A
git commit -m "feat: v8.2.0 - L4 permanent memory automation"
git tag v8.2.0
git push && git push --tags
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Create migrate-facts.js for new structure |
| 2 | Create keyword-index.js for keyword searching |
| 3 | Create auto-triggers.js for detection |
| 4 | Create permanent-memory.js for CRUD |
| 5 | Integrate L4 commands into counter.js |
| 6 | Update final() hook with L4 instructions |
| 7 | Version bump to 8.2.0 |

**Total: ~40 minutes**
