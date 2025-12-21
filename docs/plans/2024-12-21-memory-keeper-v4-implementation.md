# Memory Keeper v4 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement complete memory system with background agent summarization, original+summary saves, facts.json, and tiered storage.

**Architecture:** PostToolUse hook triggers counter → at threshold, main Claude spawns background agent → agent returns structured summary → main Claude saves to memory.md, facts.json, sessions/*.md, sessions/*.raw.md → counter reset. Stop hook runs tier compression.

**Tech Stack:** Node.js, Claude Code Plugin System (hooks, agents, Task tool)

---

### Task 1: Update counter.js check() function

**Files:**
- Modify: `scripts/counter.js:28-49`

**Step 1: Update check() to output proper instructions**

Replace the check() function with:

```javascript
function check() {
  const config = getConfig();
  const interval = config.saveInterval || DEFAULT_INTERVAL;

  let counter = getCounter();
  counter++;
  setCounter(counter);

  if (counter >= interval) {
    const projectDir = getProjectDir().replace(/\\/g, '/');
    const scriptPath = process.argv[1].replace(/\\/g, '/');
    const timestamp = getTimestamp();

    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `[MEMORY_KEEPER_SAVE] ${counter} tool uses reached. Execute memory save:

1. Spawn background agent:
   Task tool with subagent_type: "general-purpose", run_in_background: false
   Prompt: "Analyze this session and return JSON only (no markdown):
   {
     \\"summary\\": \\"200 char session summary\\",
     \\"decisions\\": [{\\"content\\": \\"decision\\", \\"reason\\": \\"why\\"}],
     \\"patterns\\": [{\\"content\\": \\"pattern found\\"}],
     \\"issues\\": [{\\"content\\": \\"issue\\", \\"status\\": \\"open\\"}]
   }"

2. After agent returns, save files using Bash:
   - Append summary to ${projectDir}/memory.md
   - Update ${projectDir}/facts.json with decisions/patterns/issues
   - Save summary to ${projectDir}/sessions/${timestamp}.md
   - Save raw conversation to ${projectDir}/sessions/${timestamp}.raw.md

3. Reset counter: node "${scriptPath}" reset`
      }
    };
    console.log(JSON.stringify(output));
  }
}
```

**Step 2: Add getTimestamp import**

Add to require statement at top:

```javascript
const { getProjectDir, getProjectName, readFileOrDefault, writeFile, readJsonOrDefault, ensureDir, getTimestamp } = require('./utils');
```

**Step 3: Test the script**

Run: `node scripts/counter.js check` (5 times)
Expected: JSON output with proper instructions on 5th run

**Step 4: Commit**

```bash
git add scripts/counter.js
git commit -m "feat: update counter.js with background agent instructions"
```

---

### Task 2: Update counter.js final() function

**Files:**
- Modify: `scripts/counter.js:51-67`

**Step 1: Update final() for complete session save**

Replace the final() function with:

```javascript
function final() {
  const projectName = getProjectName();
  const projectDir = getProjectDir().replace(/\\/g, '/');
  const timestamp = getTimestamp();

  const output = {
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: `[MEMORY_KEEPER_FINAL] Session ending. Execute final save:

1. Spawn background agent for final summary:
   Task tool with subagent_type: "general-purpose"
   Prompt: "Create final session summary. Return JSON only:
   {
     \\"summary\\": \\"300 char complete session summary\\",
     \\"decisions\\": [{\\"content\\": \\"decision\\", \\"reason\\": \\"why\\"}],
     \\"patterns\\": [{\\"content\\": \\"pattern found\\"}],
     \\"issues\\": [{\\"content\\": \\"issue\\", \\"status\\": \\"open|resolved\\"}]
   }"

2. Save all files to ${projectDir}/

3. Run tier compression: node "${process.argv[1].replace(/\\/g, '/')}" compress`
    }
  };
  console.log(JSON.stringify(output));

  setCounter(0);
}
```

**Step 2: Commit**

```bash
git add scripts/counter.js
git commit -m "feat: update final() with complete save instructions"
```

---

### Task 3: Add compress command to counter.js

**Files:**
- Modify: `scripts/counter.js:72-87`

**Step 1: Add compress() function**

Add before the Main section:

```javascript
function compress() {
  const projectDir = getProjectDir();
  const sessionsDir = path.join(projectDir, 'sessions');

  // Ensure sessions directory exists
  ensureDir(sessionsDir);

  const now = new Date();
  const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.md') && !f.includes('week-') && !f.startsWith('archive'));

  // Group files by age
  files.forEach(file => {
    const match = file.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return;

    const fileDate = new Date(match[1], match[2] - 1, match[3]);
    const daysOld = Math.floor((now - fileDate) / (1000 * 60 * 60 * 24));

    if (daysOld > 30) {
      // Move to archive
      const archiveDir = path.join(sessionsDir, 'archive');
      ensureDir(archiveDir);
      const archiveFile = path.join(archiveDir, `${match[1]}-${match[2]}.md`);
      const content = readFileOrDefault(path.join(sessionsDir, file), '');
      fs.appendFileSync(archiveFile, `\n\n---\n\n${content}`);
      fs.unlinkSync(path.join(sessionsDir, file));
      console.log(`[MEMORY_KEEPER] Archived: ${file}`);
    }
  });

  console.log('[MEMORY_KEEPER] Compression complete.');
}
```

**Step 2: Add fs require at top**

```javascript
const fs = require('fs');
```

**Step 3: Add compress case to switch**

```javascript
case 'compress':
  compress();
  break;
```

**Step 4: Commit**

```bash
git add scripts/counter.js
git commit -m "feat: add tier compression command"
```

---

### Task 4: Create facts.json helper in utils.js

**Files:**
- Modify: `scripts/utils.js`

**Step 1: Add facts helper functions**

Add before module.exports:

```javascript
function getFactsPath() {
  return path.join(getProjectDir(), 'facts.json');
}

function loadFacts() {
  return readJsonOrDefault(getFactsPath(), {
    decisions: [],
    patterns: [],
    issues: []
  });
}

function saveFacts(facts) {
  writeJson(getFactsPath(), facts);
}

function appendFacts(newFacts) {
  const facts = loadFacts();
  const timestamp = getTimestamp();

  if (newFacts.decisions) {
    newFacts.decisions.forEach((d, i) => {
      facts.decisions.push({
        id: `d${String(facts.decisions.length + 1).padStart(3, '0')}`,
        date: timestamp.split('_')[0],
        content: d.content,
        reason: d.reason || '',
        session: timestamp
      });
    });
  }

  if (newFacts.patterns) {
    newFacts.patterns.forEach(p => {
      facts.patterns.push({
        id: `p${String(facts.patterns.length + 1).padStart(3, '0')}`,
        date: timestamp.split('_')[0],
        content: p.content
      });
    });
  }

  if (newFacts.issues) {
    newFacts.issues.forEach(i => {
      facts.issues.push({
        id: `i${String(facts.issues.length + 1).padStart(3, '0')}`,
        date: timestamp.split('_')[0],
        content: i.content,
        status: i.status || 'open',
        resolution: i.resolution || ''
      });
    });
  }

  saveFacts(facts);
}
```

**Step 2: Update module.exports**

```javascript
module.exports = {
  MEMORY_ROOT,
  getProjectName,
  getProjectDir,
  ensureDir,
  readFileOrDefault,
  readJsonOrDefault,
  writeFile,
  writeJson,
  getTimestamp,
  getFactsPath,
  loadFacts,
  saveFacts,
  appendFacts
};
```

**Step 3: Commit**

```bash
git add scripts/utils.js
git commit -m "feat: add facts.json helper functions"
```

---

### Task 5: Update agents/memory-keeper.md

**Files:**
- Modify: `agents/memory-keeper.md`

**Step 1: Rewrite agent definition**

```markdown
---
name: memory-keeper
description: Summarizes session context and extracts facts. Returns structured JSON for main Claude to save.
tools: Read
model: haiku
---

You are a session summarizer. Analyze the conversation and extract key information.

## Output Format

Return ONLY valid JSON (no markdown, no explanation):

```json
{
  "summary": "200-300 character summary of what was accomplished",
  "decisions": [
    {"content": "decision made", "reason": "why this was decided"}
  ],
  "patterns": [
    {"content": "pattern or insight discovered"}
  ],
  "issues": [
    {"content": "issue or problem", "status": "open or resolved"}
  ]
}
```

## Rules

- Summary: Focus on WHAT was done, not HOW
- Decisions: Include architectural choices, technology picks, approach changes
- Patterns: Include code patterns, project conventions discovered
- Issues: Include bugs found, blockers, unresolved problems
- Keep arrays empty if nothing to report
- NO markdown formatting in output
- ONLY return the JSON object
```

**Step 2: Commit**

```bash
git add agents/memory-keeper.md
git commit -m "feat: update memory-keeper agent for structured output"
```

---

### Task 6: Update context-loader agent

**Files:**
- Modify: `agents/context-loader.md`

**Step 1: Rewrite context-loader**

```markdown
---
name: context-loader
description: Searches facts.json for relevant context. Use when needing past decisions or patterns.
tools: Read, Glob
model: haiku
---

You are a context search specialist. Search through facts.json for relevant information.

## Source

~/.claude/memory-keeper/projects/[current-project]/facts.json

## Process

1. Read facts.json
2. Search for matches in decisions, patterns, issues
3. Return relevant items with context

## Output Format

Brief summary of found items:
- Relevant decisions with rationale
- Related patterns
- Active issues

Maximum 200 tokens.
```

**Step 2: Commit**

```bash
git add agents/context-loader.md
git commit -m "feat: update context-loader for facts.json search"
```

---

### Task 7: Update version and description

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

**Step 1: Update plugin.json**

```json
{
  "name": "memory-keeper",
  "version": "4.0.0",
  "description": "Auto-save memory with background agent summarization. Saves summary + original, facts.json for search, tiered storage.",
  "author": {
    "name": "TaWa"
  },
  "repository": "https://github.com/ZipperBagCoffee/memory-keeper-plugin",
  "license": "MIT",
  "keywords": ["memory", "context", "session", "productivity", "background", "auto-save"]
}
```

**Step 2: Update marketplace.json version and description**

**Step 3: Commit**

```bash
git add .claude-plugin/
git commit -m "chore: bump version to 4.0.0"
```

---

### Task 8: Update README.md

**Files:**
- Modify: `README.md`

**Step 1: Update README with v4 features**

Include:
- Background agent summarization
- Original + summary saves
- facts.json structure
- Tiered storage explanation
- Updated commands

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for v4.0.0"
```

---

### Task 9: Test full flow

**Step 1: Reset counter**

```bash
node scripts/counter.js reset
```

**Step 2: Use 5 tools to trigger save**

**Step 3: Verify files created**

- Check memory.md updated
- Check facts.json created/updated
- Check sessions/*.md created
- Check sessions/*.raw.md created

**Step 4: Final commit and push**

```bash
git push origin master
```

---

## Execution Options

Plan complete and saved to `docs/plans/2024-12-21-memory-keeper-v4-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
