# L1 Raw Content Refinement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce raw transcript size by 95% by extracting only meaningful content

**Architecture:** New `refine-raw.js` script processes raw.jsonl, filters junk metadata, extracts user/assistant text and tool summaries, outputs .l1.jsonl

**Tech Stack:** Node.js, fs, readline (streaming for large files)

---

## Task 1: Create refine-raw.js with Basic Structure

**Files:**
- Create: `scripts/refine-raw.js`

**Step 1: Create the basic script structure**

```javascript
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Types to completely remove
const JUNK_TYPES = [
  'queue-operation',
  'file-history-snapshot'
];

// Process a single raw.jsonl file into l1.jsonl
async function refineRaw(inputPath, outputPath) {
  const output = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const refined = processLine(line);
    if (refined) {
      output.push(JSON.stringify(refined));
    }
  }

  fs.writeFileSync(outputPath, output.join('\n'));
  return output.length;
}

// Process a single line, return refined object or null
function processLine(line) {
  try {
    const obj = JSON.parse(line);
    return refineLine(obj);
  } catch (e) {
    return null;
  }
}

// Refine based on type
function refineLine(obj) {
  const type = obj.type;

  // Remove junk types
  if (JUNK_TYPES.includes(type)) {
    return null;
  }

  // TODO: Process each type
  return null;
}

module.exports = { refineRaw, processLine, refineLine };

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node refine-raw.js <input.raw.jsonl> <output.l1.jsonl>');
    process.exit(1);
  }
  refineRaw(args[0], args[1]).then(count => {
    console.log(`Refined ${count} lines`);
  });
}
```

**Step 2: Run to verify structure**

```bash
node scripts/refine-raw.js
```
Expected: "Usage: node refine-raw.js <input.raw.jsonl> <output.l1.jsonl>"

**Step 3: Commit**

```bash
git add scripts/refine-raw.js
git commit -m "feat(L1): add refine-raw.js basic structure"
```

---

## Task 2: Implement User Message Processing

**Files:**
- Modify: `scripts/refine-raw.js`

**Step 1: Add user message handler**

Add after `refineLine` function:

```javascript
// Extract user message
function processUser(obj) {
  // User messages have type: "user" with message.content array
  if (obj.type === 'user' && obj.message?.content) {
    const textContent = obj.message.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    if (textContent) {
      return {
        ts: obj.timestamp || new Date().toISOString(),
        role: 'user',
        text: textContent
      };
    }
  }
  return null;
}
```

**Step 2: Update refineLine to use it**

```javascript
function refineLine(obj) {
  const type = obj.type;

  if (JUNK_TYPES.includes(type)) {
    return null;
  }

  if (type === 'user') {
    return processUser(obj);
  }

  return null;
}
```

**Step 3: Test with sample data**

Create `test-data/sample.raw.jsonl`:
```jsonl
{"type":"queue-operation","operation":"dequeue","timestamp":"2026-01-05T01:41:55.296Z"}
{"type":"user","timestamp":"2026-01-05T01:42:00.000Z","message":{"content":[{"type":"text","text":"Fix the REST button"}]}}
```

Run:
```bash
node scripts/refine-raw.js test-data/sample.raw.jsonl test-data/sample.l1.jsonl
cat test-data/sample.l1.jsonl
```

Expected: One line with user message, no queue-operation

**Step 4: Commit**

```bash
git add scripts/refine-raw.js
git commit -m "feat(L1): add user message processing"
```

---

## Task 3: Implement Assistant Message Processing

**Files:**
- Modify: `scripts/refine-raw.js`

**Step 1: Add assistant message handler**

```javascript
// Extract assistant message (text only, no thinking)
function processAssistant(obj) {
  if (obj.type === 'assistant' && obj.message?.content) {
    const textContent = obj.message.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    if (textContent) {
      return {
        ts: obj.timestamp || new Date().toISOString(),
        role: 'assistant',
        text: textContent
      };
    }
  }
  return null;
}
```

**Step 2: Update refineLine**

```javascript
function refineLine(obj) {
  const type = obj.type;

  if (JUNK_TYPES.includes(type)) {
    return null;
  }

  if (type === 'user') {
    return processUser(obj);
  }

  if (type === 'assistant') {
    return processAssistant(obj);
  }

  return null;
}
```

**Step 3: Test**

Add to `test-data/sample.raw.jsonl`:
```jsonl
{"type":"assistant","timestamp":"2026-01-05T01:42:05.000Z","message":{"content":[{"type":"thinking","thinking":"Let me think..."},{"type":"text","text":"I'll fix the REST button."}]}}
```

Run and verify thinking is excluded, only text kept.

**Step 4: Commit**

```bash
git commit -am "feat(L1): add assistant message processing (excludes thinking)"
```

---

## Task 4: Implement Tool Use Processing

**Files:**
- Modify: `scripts/refine-raw.js`

**Step 1: Add tool use handler with diff summary**

```javascript
// Extract tool use with summary
function processToolUse(obj) {
  if (obj.type === 'tool_use') {
    const tool = {
      ts: obj.timestamp || new Date().toISOString(),
      role: 'tool',
      name: obj.name || 'unknown'
    };

    const input = obj.input || {};

    // Extract relevant info based on tool type
    switch (tool.name) {
      case 'Read':
        tool.target = input.file_path || input.path;
        if (input.offset) tool.lines = `${input.offset}-${input.offset + (input.limit || 100)}`;
        break;

      case 'Edit':
        tool.target = input.file_path;
        // Create diff summary
        if (input.old_string && input.new_string) {
          const oldLines = input.old_string.split('\n').slice(0, 3).join('\n');
          const newLines = input.new_string.split('\n').slice(0, 3).join('\n');
          tool.diff = `-${oldLines.substring(0, 100)}\n+${newLines.substring(0, 100)}`;
        }
        break;

      case 'Write':
        tool.target = input.file_path;
        tool.size = input.content?.length || 0;
        break;

      case 'Bash':
        tool.cmd = (input.command || '').substring(0, 200);
        break;

      case 'Grep':
        tool.pattern = input.pattern;
        tool.path = input.path;
        break;

      case 'Glob':
        tool.pattern = input.pattern;
        break;

      default:
        // Generic: just store input keys
        tool.params = Object.keys(input).join(',');
    }

    return tool;
  }
  return null;
}
```

**Step 2: Update refineLine**

```javascript
function refineLine(obj) {
  const type = obj.type;

  if (JUNK_TYPES.includes(type)) {
    return null;
  }

  switch (type) {
    case 'user': return processUser(obj);
    case 'assistant': return processAssistant(obj);
    case 'tool_use': return processToolUse(obj);
    default: return null;
  }
}
```

**Step 3: Test with real raw file**

```bash
node scripts/refine-raw.js "C:/Users/user/Documents/memory-keeper-plugin/.claude/memory/sessions/2026-01-11_0042.raw.jsonl" test-data/test.l1.jsonl
wc -l test-data/test.l1.jsonl
head -20 test-data/test.l1.jsonl
```

**Step 4: Commit**

```bash
git commit -am "feat(L1): add tool use processing with diff summary"
```

---

## Task 5: Implement Tool Result Processing

**Files:**
- Modify: `scripts/refine-raw.js`

**Step 1: Add tool result handler**

```javascript
// Extract tool result (success/fail + brief output)
function processToolResult(obj) {
  if (obj.type === 'tool_result') {
    const result = {
      ts: obj.timestamp || new Date().toISOString(),
      role: 'tool_result',
      tool_use_id: obj.tool_use_id
    };

    // Check if error
    if (obj.is_error) {
      result.result = 'error';
      result.output = (obj.content || '').substring(0, 200);
    } else {
      result.result = 'ok';
      // Brief output for context
      const content = typeof obj.content === 'string'
        ? obj.content
        : JSON.stringify(obj.content);
      if (content && content.length > 0) {
        result.output = content.substring(0, 200);
      }
    }

    return result;
  }
  return null;
}
```

**Step 2: Update refineLine**

```javascript
switch (type) {
  case 'user': return processUser(obj);
  case 'assistant': return processAssistant(obj);
  case 'tool_use': return processToolUse(obj);
  case 'tool_result': return processToolResult(obj);
  default: return null;
}
```

**Step 3: Test and verify size reduction**

```bash
node scripts/refine-raw.js "C:/Users/user/Documents/OtherProject/.claude/memory/sessions/2026-01-05_2227.raw.jsonl" test-data/large.l1.jsonl
ls -lh "C:/Users/user/Documents/OtherProject/.claude/memory/sessions/2026-01-05_2227.raw.jsonl" test-data/large.l1.jsonl
```

Expected: 20MB → ~1MB (95% reduction)

**Step 4: Commit**

```bash
git commit -am "feat(L1): add tool result processing"
```

---

## Task 6: Integrate into final() Hook

**Files:**
- Modify: `scripts/counter.js`

**Step 1: Import refine-raw**

Add at top of counter.js:
```javascript
const { refineRaw } = require('./refine-raw');
```

**Step 2: Modify final() to create L1 after raw copy**

After the raw copy section (around line 270), add:

```javascript
// Create L1 refined version
if (rawSaved) {
  try {
    const l1Dest = rawSaved.replace('.raw.jsonl', '.l1.jsonl');
    const lineCount = await refineRaw(rawSaved, l1Dest);
    // Log stats
    const rawSize = fs.statSync(rawSaved).size;
    const l1Size = fs.statSync(l1Dest).size;
    const reduction = ((1 - l1Size / rawSize) * 100).toFixed(1);
    fs.appendFileSync(path.join(getProjectDir(), 'refine.log'),
      `${timestamp}: ${lineCount} lines, ${rawSize}→${l1Size} bytes (${reduction}% reduction)\n`);
  } catch (e) {
    fs.appendFileSync(path.join(getProjectDir(), 'error.log'),
      `${timestamp}: Failed to create L1: ${e.message}\n`);
  }
}
```

**Step 3: Test by triggering Stop hook manually**

This will be tested when session ends.

**Step 4: Commit**

```bash
git commit -am "feat(L1): integrate refine-raw into final() hook"
```

---

## Task 7: Add CLI Command for Batch Processing

**Files:**
- Modify: `scripts/counter.js`

**Step 1: Add refine-all command**

Add new command handler:

```javascript
async function refineAll() {
  const sessionsDir = path.join(getProjectDir(), 'sessions');
  if (!fs.existsSync(sessionsDir)) {
    console.log('[MEMORY_KEEPER] No sessions directory found');
    return;
  }

  const rawFiles = fs.readdirSync(sessionsDir)
    .filter(f => f.endsWith('.raw.jsonl'))
    .filter(f => !fs.existsSync(path.join(sessionsDir, f.replace('.raw.jsonl', '.l1.jsonl'))));

  if (rawFiles.length === 0) {
    console.log('[MEMORY_KEEPER] All raw files already have L1 versions');
    return;
  }

  console.log(`[MEMORY_KEEPER] Processing ${rawFiles.length} raw files...`);

  let totalRaw = 0;
  let totalL1 = 0;

  for (const file of rawFiles) {
    const rawPath = path.join(sessionsDir, file);
    const l1Path = rawPath.replace('.raw.jsonl', '.l1.jsonl');

    try {
      await refineRaw(rawPath, l1Path);
      const rawSize = fs.statSync(rawPath).size;
      const l1Size = fs.statSync(l1Path).size;
      totalRaw += rawSize;
      totalL1 += l1Size;
      console.log(`  ${file}: ${(rawSize/1024/1024).toFixed(1)}MB → ${(l1Size/1024/1024).toFixed(1)}MB`);
    } catch (e) {
      console.log(`  ${file}: ERROR - ${e.message}`);
    }
  }

  const reduction = ((1 - totalL1 / totalRaw) * 100).toFixed(1);
  console.log(`[MEMORY_KEEPER] Total: ${(totalRaw/1024/1024).toFixed(1)}MB → ${(totalL1/1024/1024).toFixed(1)}MB (${reduction}% reduction)`);
}
```

**Step 2: Add to command switch**

```javascript
case 'refine-all':
  await refineAll();
  break;
```

**Step 3: Test**

```bash
node scripts/counter.js refine-all
```

**Step 4: Commit**

```bash
git commit -am "feat(L1): add refine-all CLI command for batch processing"
```

---

## Task 8: Update Version and Documentation

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `README.md`

**Step 1: Bump version to 8.0.0**

```json
"version": "8.0.0"
```

**Step 2: Update README with L1 info**

Add to README:
```markdown
## v8.0.0 - Hierarchical Memory (L1)

### L1: Refined Raw Content

Raw transcripts are now automatically refined to remove junk metadata:
- Removes: queue-operation, file-history-snapshot, thinking blocks
- Keeps: user text, assistant text, tool summaries with diff
- Size reduction: ~95% (20MB → 1MB)

### Commands

- `refine-all` - Process all existing raw files to create L1 versions
```

**Step 3: Commit and tag**

```bash
git add -A
git commit -m "feat: v8.0.0 - L1 hierarchical memory refinement"
git tag v8.0.0
git push && git push --tags
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | Basic refine-raw.js structure | 5 min |
| 2 | User message processing | 5 min |
| 3 | Assistant message processing | 5 min |
| 4 | Tool use processing with diff | 10 min |
| 5 | Tool result processing | 5 min |
| 6 | Integrate into final() hook | 5 min |
| 7 | Add refine-all CLI command | 5 min |
| 8 | Version bump and docs | 5 min |

**Total: ~45 minutes**