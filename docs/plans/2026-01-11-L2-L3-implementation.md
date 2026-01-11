# L2-L3 Hierarchical Summarization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add L2 (exchange summaries) and L3 (concept grouping) layers to hierarchical memory system

**Architecture:**
- L2: Claude generates structured JSON summaries from L1 content on session end
- L3: Rule-based concept grouping with file/keyword overlap detection
- Both triggered via updated final() hook instructions

**Tech Stack:** Node.js, JSON

---

## Task 1: Create generate-l2.js Script

**Files:**
- Create: `scripts/generate-l2.js`

**Step 1: Create the L2 generation script**

This script reads L1 and outputs formatted content for Claude to summarize.

```javascript
const fs = require('fs');
const path = require('path');
const { getProjectDir, getTimestamp } = require('./utils');

// Read L1 file and format for LLM summarization
function prepareL1ForSummary(l1Path) {
  if (!fs.existsSync(l1Path)) {
    return null;
  }

  const lines = fs.readFileSync(l1Path, 'utf8').split('\n').filter(l => l.trim());
  const exchanges = [];
  let currentExchange = null;

  for (let i = 0; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);

      if (entry.role === 'user') {
        // Start new exchange
        if (currentExchange) {
          exchanges.push(currentExchange);
        }
        currentExchange = {
          startLine: i + 1,
          user: entry.text,
          assistant: [],
          tools: [],
          files: new Set()
        };
      } else if (entry.role === 'assistant' && currentExchange) {
        currentExchange.assistant.push(entry.text);
      } else if (entry.role === 'tool' && currentExchange) {
        currentExchange.tools.push({
          name: entry.name,
          target: entry.target || entry.cmd || entry.pattern
        });
        if (entry.target) {
          // Extract filename from path
          const fileName = path.basename(entry.target);
          currentExchange.files.add(fileName);
        }
      }
    } catch (e) {
      // Skip invalid lines
    }
  }

  if (currentExchange) {
    currentExchange.endLine = lines.length;
    exchanges.push(currentExchange);
  }

  // Convert Sets to Arrays
  exchanges.forEach(ex => {
    ex.files = Array.from(ex.files);
  });

  return exchanges;
}

// Format exchanges for LLM prompt
function formatForLLM(exchanges, sessionId) {
  let output = `Generate L2 summaries for session ${sessionId}.\n\n`;
  output += `For each exchange below, output a JSON object with:\n`;
  output += `- id: "e001", "e002", etc.\n`;
  output += `- summary: 1-sentence summary of what was done\n`;
  output += `- details: 1-2 sentences with specifics\n`;
  output += `- files: array of files modified\n`;
  output += `- keywords: 3-5 keywords for searchability\n`;
  output += `- l1_range: [startLine, endLine]\n\n`;
  output += `Output as JSON array. Start with [\n\n`;

  exchanges.forEach((ex, i) => {
    output += `--- Exchange ${i + 1} (lines ${ex.startLine}-${ex.endLine || '?'}) ---\n`;
    output += `User: ${ex.user?.substring(0, 200)}${ex.user?.length > 200 ? '...' : ''}\n`;
    if (ex.assistant.length > 0) {
      output += `Assistant: ${ex.assistant.join(' ').substring(0, 300)}...\n`;
    }
    if (ex.tools.length > 0) {
      output += `Tools: ${ex.tools.map(t => `${t.name}(${t.target || ''})`).join(', ')}\n`;
    }
    if (ex.files.length > 0) {
      output += `Files: ${ex.files.join(', ')}\n`;
    }
    output += '\n';
  });

  return output;
}

// CLI: node generate-l2.js <l1-path>
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: node generate-l2.js <l1-path>');
    process.exit(1);
  }

  const l1Path = args[0];
  const sessionId = path.basename(l1Path, '.l1.jsonl');
  const exchanges = prepareL1ForSummary(l1Path);

  if (!exchanges || exchanges.length === 0) {
    console.log('[MEMORY_KEEPER] No exchanges found in L1');
    process.exit(0);
  }

  console.log(formatForLLM(exchanges, sessionId));
}

module.exports = { prepareL1ForSummary, formatForLLM };
```

**Step 2: Test with existing L1 file**

```bash
node scripts/generate-l2.js ".claude/memory/sessions/2026-01-11_0042.l1.jsonl"
```

Expected: Formatted output with exchanges and LLM instructions

**Step 3: Commit**

```bash
git add scripts/generate-l2.js
git commit -m "feat(L2): add generate-l2.js for L1 summarization prep"
```

---

## Task 2: Create save-l2.js Script

**Files:**
- Create: `scripts/save-l2.js`

**Step 1: Create script to save L2 JSON**

```javascript
const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, writeJson } = require('./utils');

// Save L2 summaries to file
function saveL2(sessionId, summaries) {
  const sessionsDir = path.join(getProjectDir(), 'sessions');
  const l2Path = path.join(sessionsDir, `${sessionId}.l2.json`);

  // Validate summaries structure
  if (!Array.isArray(summaries)) {
    throw new Error('Summaries must be an array');
  }

  // Add metadata
  const l2Data = {
    sessionId,
    generated: new Date().toISOString(),
    exchanges: summaries
  };

  writeJson(l2Path, l2Data);
  return l2Path;
}

// CLI: node save-l2.js <session-id> <json-string>
// Or: echo '<json>' | node save-l2.js <session-id>
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node save-l2.js <session-id> [json-string]');
    console.log('Or: echo \'<json>\' | node save-l2.js <session-id>');
    process.exit(1);
  }

  const sessionId = args[0];
  let jsonStr = args[1];

  // Read from stdin if no JSON provided
  if (!jsonStr) {
    jsonStr = fs.readFileSync(0, 'utf8');
  }

  try {
    const summaries = JSON.parse(jsonStr);
    const savedPath = saveL2(sessionId, summaries);
    console.log(`[MEMORY_KEEPER] L2 saved: ${savedPath}`);
    console.log(`[MEMORY_KEEPER] ${summaries.length} exchanges summarized`);
  } catch (e) {
    console.error(`[MEMORY_KEEPER] Error saving L2: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { saveL2 };
```

**Step 2: Test with sample data**

```bash
node scripts/save-l2.js "2026-01-11_test" '[{"id":"e001","summary":"Test summary","details":"Test details","files":[],"keywords":["test"],"l1_range":[1,10]}]'
cat .claude/memory/sessions/2026-01-11_test.l2.json
```

**Step 3: Commit**

```bash
git add scripts/save-l2.js
git commit -m "feat(L2): add save-l2.js for storing L2 summaries"
```

---

## Task 3: Create update-concepts.js Script

**Files:**
- Create: `scripts/update-concepts.js`

**Step 1: Create concept management script**

```javascript
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
function calculateOverlap(arr1, arr2) {
  if (!arr1?.length || !arr2?.length) return 0;
  const set1 = new Set(arr1.map(s => s.toLowerCase()));
  const set2 = new Set(arr2.map(s => s.toLowerCase()));
  const intersection = [...set1].filter(x => set2.has(x));
  return intersection.length / Math.max(set1.size, set2.size);
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
      // Create new concept
      const newConcept = {
        id: `c${String(conceptsData.nextId++).padStart(3, '0')}`,
        name: exchange.summary || 'Unnamed concept',
        summary: exchange.details || exchange.summary,
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
```

**Step 2: Test**

```bash
node scripts/update-concepts.js ".claude/memory/sessions/2026-01-11_test.l2.json"
cat .claude/memory/concepts.json
```

**Step 3: Commit**

```bash
git add scripts/update-concepts.js
git commit -m "feat(L3): add update-concepts.js for concept grouping"
```

---

## Task 4: Update final() Hook with L2-L3 Instructions

**Files:**
- Modify: `scripts/counter.js`

**Step 1: Update final() instructions**

Find the `instructions` template string in final() (around line 280-320) and update it to include L2 generation:

```javascript
const instructions = `
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER] SESSION ENDING - Final Save Required
═══════════════════════════════════════════════════════════════
${rawSaved ? `✓ Raw transcript saved: ${rawSaved}` : '⚠ Raw transcript not saved'}
${l1Saved ? `✓ L1 refined: ${l1Saved}` : ''}

**STEP 1: Generate L2 Summary**

Review this session and create L2 exchange summaries. For each distinct task/request:
\`\`\`json
[
  {
    "id": "e001",
    "summary": "One sentence: what was done",
    "details": "1-2 sentences with specifics (files, functions, fixes)",
    "files": ["file1.js", "file2.js"],
    "keywords": ["keyword1", "keyword2", "keyword3"],
    "l1_range": [1, 50]
  }
]
\`\`\`

Save L2:
\`\`\`bash
node "${scriptPath}" save-l2 "${timestamp}" '<paste-json-here>'
\`\`\`

**STEP 2: Update Concepts**

\`\`\`bash
node "${scriptPath}" update-concepts "${projectDir}/sessions/${timestamp}.l2.json"
\`\`\`

**STEP 3: Record Facts (as before)**

${existingFactsInstructions}

═══════════════════════════════════════════════════════════════`;
```

**Step 2: Add save-l2 and update-concepts commands to switch**

Add to the command switch in counter.js:

```javascript
case 'save-l2':
  // node counter.js save-l2 <session-id> <json>
  const { saveL2 } = require('./save-l2');
  const sessionId = args[1];
  const jsonStr = args.slice(2).join(' ');
  try {
    const summaries = JSON.parse(jsonStr);
    const saved = saveL2(sessionId, summaries);
    console.log(`[MEMORY_KEEPER] L2 saved: ${saved}`);
  } catch (e) {
    console.error(`[MEMORY_KEEPER] Error: ${e.message}`);
  }
  break;

case 'update-concepts':
  const { updateConcepts } = require('./update-concepts');
  const l2Path = args[1];
  const l2Data = JSON.parse(fs.readFileSync(l2Path, 'utf8'));
  const result = updateConcepts(l2Data);
  console.log(`[MEMORY_KEEPER] Concepts: ${result.concepts.length} total`);
  break;
```

**Step 3: Commit**

```bash
git commit -am "feat(L2-L3): update final() hook with L2/L3 instructions"
```

---

## Task 5: Add list-concepts Command

**Files:**
- Modify: `scripts/counter.js`

**Step 1: Add list-concepts function**

```javascript
function listConcepts() {
  const { loadConcepts } = require('./update-concepts');
  const data = loadConcepts();

  if (data.concepts.length === 0) {
    console.log('[MEMORY_KEEPER] No concepts yet');
    return;
  }

  console.log(`[MEMORY_KEEPER] ${data.concepts.length} concepts:\n`);

  for (const c of data.concepts) {
    console.log(`[${c.id}] ${c.name}`);
    console.log(`  ${c.summary}`);
    console.log(`  Files: ${c.files.join(', ') || 'none'}`);
    console.log(`  Keywords: ${c.keywords.join(', ')}`);
    console.log(`  Exchanges: ${c.exchanges.length}`);
    console.log('');
  }
}
```

**Step 2: Add to switch**

```javascript
case 'list-concepts':
  listConcepts();
  break;
```

**Step 3: Update help**

Add to help text:
```
L2-L3 Hierarchy:
  save-l2 <session> <json>  Save L2 exchange summaries
  update-concepts <l2-path> Update L3 concepts from L2
  list-concepts             List all concepts
```

**Step 4: Commit**

```bash
git commit -am "feat(L3): add list-concepts command"
```

---

## Task 6: Update Version to 8.1.0

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `README.md`

**Step 1: Bump version**

```json
"version": "8.1.0"
```

**Step 2: Update README**

Add to README:
```markdown
## v8.1.0 - L2-L3 Hierarchical Summarization

### L2: Exchange Summaries
- Session end prompts Claude to generate structured summaries
- Each user request → response cycle becomes an "exchange"
- Stored as `.l2.json` files with keywords and file references

### L3: Concept Grouping
- Related exchanges grouped by file/keyword overlap
- Concepts stored in `concepts.json`
- Automatic classification with 30% overlap threshold

### New Commands
- `save-l2 <session> <json>` - Save L2 summaries
- `update-concepts <l2-path>` - Update concepts from L2
- `list-concepts` - List all concepts
```

**Step 3: Commit and push**

```bash
git add -A
git commit -m "feat: v8.1.0 - L2-L3 hierarchical summarization"
git tag v8.1.0
git push && git push --tags
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Create generate-l2.js for L1→L2 prep |
| 2 | Create save-l2.js for storing summaries |
| 3 | Create update-concepts.js for L3 grouping |
| 4 | Update final() hook with L2-L3 flow |
| 5 | Add list-concepts command |
| 6 | Version bump to 8.1.0 |

**Total: ~30 minutes**
