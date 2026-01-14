# Memory Update & Rules Injection Plan v4

## Overview

Two improvements to memory-keeper:
1. L1-based memory.md delta updates (Haiku summarization)
2. UserPromptSubmit rules injection

---

## 1. L1-Based Memory.md Delta Updates

### Current Problem

- Trigger: 5 tool uses → output "1-2 sentence summary of work so far"
- Issues:
  - Vague instruction - Claude doesn't know what to summarize
  - May miss important content or repeat previous summaries
  - No context about what happened since last update

### Desired Behavior

- Script extracts delta (content since last memory.md update) from L1
- Delta saved to temp file (with size limit handling)
- Main Claude calls Haiku via Task tool to summarize
- Haiku summarizes, Main Claude appends to memory.md

### Trigger: Tool Count (Keep Current)

**Decision: Keep tool count.** Work volume = content to record.

### Delta Extraction: Timestamp Watermark

**Implementation:**
1. memory.md 업데이트 후 → `memory-index.json`에 `lastMemoryUpdateTs` 저장
2. Delta 추출 시 → 해당 timestamp 이후 L1 entries 필터링

### Haiku 호출 방식

**Hook이 직접 API 호출 안 함.** Main Claude가 Task tool로 Haiku 호출.

```
Hook (counter.js check)
  ↓ delta 추출 → 임시 파일 저장 (.claude/memory/delta_temp.txt)
  ↓ outputs "[MEMORY_KEEPER_DELTA] file=delta_temp.txt"
  ↓
Main Claude가 트리거 인식
  ↓
Main Claude가 Task tool 호출 → Haiku (delta-summarizer agent)
  ↓
Haiku가 delta 파일 읽고 요약
  ↓
Main Claude가 요약 결과를 memory.md에 append
  ↓
Main Claude가 timestamp 업데이트 + temp 파일 삭제
```

### Session-End Delta Processing (Option B)

**문제:** 세션 중 delta trigger는 현재 세션 L1이 없어서 현재 세션 내용 캡처 못함.

**해결:** final()에서도 delta 처리 추가.

```
counter.js final()
  ↓ L1 생성 완료 후
  ↓ delta 추출 (방금 생성된 L1에서)
  ↓ delta 있으면 "[MEMORY_KEEPER_DELTA]" 출력
  ↓
Main Claude가 처리 (세션 종료 전 마지막 작업)
```

이렇게 하면:
- 세션 중 trigger: 이전 세션 잔여 내용 처리
- 세션 종료 final(): 현재 세션 잔여 내용 처리

---

### Implementation

#### 1.1 Update `scripts/constants.js`

```javascript
const DELTA_TEMP_FILE = 'delta_temp.txt';
const HAIKU_CONTEXT_LIMIT = 200000;  // 200K tokens
const HAIKU_SAFE_MARGIN = 0.95;      // 5% margin
const HAIKU_SAFE_TOKENS = Math.floor(HAIKU_CONTEXT_LIMIT * HAIKU_SAFE_MARGIN);
const FIRST_RUN_MAX_ENTRIES = 50;    // First run limit

module.exports = {
  // ... existing
  DELTA_TEMP_FILE,
  HAIKU_SAFE_TOKENS,
  FIRST_RUN_MAX_ENTRIES
};
```

#### 1.2 New Script: `scripts/extract-delta.js`

```javascript
// scripts/extract-delta.js
const fs = require('fs');
const path = require('path');
const { getProjectDir, readJsonOrDefault, writeJson, estimateTokens, extractTailByTokens } = require('./utils');
const { SESSIONS_DIR, MEMORY_DIR, DELTA_TEMP_FILE, HAIKU_SAFE_TOKENS, FIRST_RUN_MAX_ENTRIES } = require('./constants');

function extractDelta() {
  try {
    const projectDir = getProjectDir();
    const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
    const sessionsDir = path.join(projectDir, '.claude', SESSIONS_DIR);
    const indexPath = path.join(memoryDir, 'memory-index.json');

    // Get last update timestamp
    const index = readJsonOrDefault(indexPath, {});
    const lastUpdateTs = index.lastMemoryUpdateTs || null;

    // Get most recent L1 file
    if (!fs.existsSync(sessionsDir)) {
      return { success: false, reason: 'No sessions dir' };
    }

    const l1Files = fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.l1.jsonl'))
      .sort()
      .reverse();

    if (l1Files.length === 0) {
      return { success: false, reason: 'No L1 files' };
    }

    const l1Path = path.join(sessionsDir, l1Files[0]);
    const content = fs.readFileSync(l1Path, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    // Filter entries after lastUpdateTs
    const delta = [];
    let skippedCount = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Skip if before last update
        if (lastUpdateTs && entry.ts && entry.ts <= lastUpdateTs) {
          skippedCount++;
          continue;
        }

        // Format entry with output included
        if (entry.role === 'assistant' && entry.text) {
          delta.push(`[Assistant]: ${entry.text}`);
        } else if (entry.role === 'tool' && entry.name) {
          const cmdPreview = entry.cmd || '';
          let toolEntry = `[Tool: ${entry.name}] ${cmdPreview}`;

          // Include truncated output
          if (entry.output) {
            const outputPreview = entry.output.substring(0, 300);
            toolEntry += `\nOutput: ${outputPreview}${entry.output.length > 300 ? '...' : ''}`;
          }
          delta.push(toolEntry);
        } else if (entry.role === 'user' && entry.text) {
          delta.push(`[User]: ${entry.text}`);
        }
      } catch (e) {}
    }

    // First run handling: limit to recent entries
    if (!lastUpdateTs && delta.length > FIRST_RUN_MAX_ENTRIES) {
      delta.splice(0, delta.length - FIRST_RUN_MAX_ENTRIES);
    }

    if (delta.length === 0) {
      return { success: false, reason: 'No new content' };
    }

    // Join delta content
    let deltaContent = delta.join('\n\n');

    // Handle Haiku context limit
    const tokens = estimateTokens(deltaContent);
    if (tokens > HAIKU_SAFE_TOKENS) {
      deltaContent = extractTailByTokens(deltaContent, HAIKU_SAFE_TOKENS);
    }

    // Write delta to temp file
    const deltaPath = path.join(memoryDir, DELTA_TEMP_FILE);
    fs.writeFileSync(deltaPath, deltaContent);

    return {
      success: true,
      deltaFile: DELTA_TEMP_FILE,
      entryCount: delta.length,
      tokens: estimateTokens(deltaContent)
    };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

// Update timestamp after memory.md is updated
function markMemoryUpdated() {
  try {
    const projectDir = getProjectDir();
    const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
    const indexPath = path.join(memoryDir, 'memory-index.json');

    const index = readJsonOrDefault(indexPath, {});
    index.lastMemoryUpdateTs = new Date().toISOString();
    writeJson(indexPath, index);

    console.log('[MEMORY_KEEPER] Timestamp updated:', index.lastMemoryUpdateTs);
    return true;
  } catch (e) {
    console.error('[MEMORY_KEEPER] Failed to update timestamp:', e.message);
    return false;
  }
}

// Delete temp file
function cleanupDeltaTemp() {
  try {
    const projectDir = getProjectDir();
    const memoryDir = path.join(projectDir, '.claude', MEMORY_DIR);
    const deltaPath = path.join(memoryDir, DELTA_TEMP_FILE);

    if (fs.existsSync(deltaPath)) {
      fs.unlinkSync(deltaPath);
    }
    return true;
  } catch (e) {
    return false;
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];

  switch (command) {
    case 'extract':
      const result = extractDelta();
      console.log(JSON.stringify(result));
      break;
    case 'mark-updated':
      markMemoryUpdated();
      break;
    case 'cleanup':
      cleanupDeltaTemp();
      break;
    default:
      console.log('Usage: extract-delta.js <extract|mark-updated|cleanup>');
  }
}

module.exports = { extractDelta, markMemoryUpdated, cleanupDeltaTemp };
```

#### 1.3 Update `scripts/counter.js` check()

```javascript
// In check() function, when counter >= interval:

const { extractDelta } = require('./extract-delta');
const result = extractDelta();

if (result.success) {
  const instructions = `
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER_DELTA] file=${result.deltaFile}
═══════════════════════════════════════════════════════════════
Delta extracted: ${result.entryCount} entries, ~${result.tokens} tokens.
`;
  setCounter(0);
  console.error(instructions);
  process.exit(2);
} else {
  // No delta, just reset counter
  setCounter(0);
}
```

#### 1.4 Update `scripts/counter.js` final()

```javascript
// At the end of final(), after L1 is created:

// Process any remaining delta before session ends
const { extractDelta } = require('./extract-delta');
const deltaResult = extractDelta();

if (deltaResult.success) {
  // Include delta trigger in final output
  const deltaInstructions = `
[MEMORY_KEEPER_DELTA] file=${deltaResult.deltaFile}
Delta extracted at session end: ${deltaResult.entryCount} entries.
`;
  // Append to existing output or create new
  if (config.quietStop !== false) {
    console.error(deltaInstructions);
  }
}
```

#### 1.5 New Agent: `agents/delta-summarizer.md`

```markdown
---
name: delta-summarizer
description: Summarize delta content to 1-2 sentences for memory.md
tools: Read
model: haiku
---

## Task

Read the delta file and output a concise 1-2 sentence summary.

## Input

File: `.claude/memory/delta_temp.txt`

## Output Format

Plain text only. 1-2 sentences summarizing the key activities, decisions, or changes.

Do NOT output:
- JSON
- Markdown headers
- Bullet points
- Explanations

Just the summary text.

## Examples

Good: "Implemented JWT authentication and fixed login redirect bug. Updated user model with email verification field."

Good: "Refactored database queries for better performance. Added pagination to user list endpoint."

Bad: "## Summary\n- Did X\n- Did Y" (no markdown)

Bad: "Here is the summary: ..." (no preamble)
```

#### 1.6 New Skill: `skills/memory-delta/SKILL.md`

```markdown
---
name: memory-delta
description: Auto-execute when "[MEMORY_KEEPER_DELTA]" trigger detected
---

## Trigger Condition

Auto-invoked when hook outputs `[MEMORY_KEEPER_DELTA] file=delta_temp.txt`.

## Execution Steps

1. **Call Haiku agent for summarization**:
   ```
   Task tool:
   - subagent_type: "delta-summarizer"
   - model: "haiku"
   - prompt: "Read .claude/memory/delta_temp.txt and summarize in 1-2 sentences."
   ```

2. **Get current timestamp**:
   ```bash
   date +"%Y-%m-%d_%H%M"
   ```

3. **Append summary to memory.md**:
   ```bash
   echo -e "\n## {timestamp}\n{haiku_summary}" >> .claude/memory/memory.md
   ```

4. **Update timestamp marker**:
   ```bash
   node scripts/extract-delta.js mark-updated
   ```

5. **Delete temp file**:
   ```bash
   node scripts/extract-delta.js cleanup
   ```

## Failure Handling

- If Task tool fails: Don't update timestamp, don't delete temp file
- Next trigger will retry with accumulated content (temp file overwritten)
- Log error but don't block main workflow
```

#### 1.7 Edge Cases

| Scenario | Handling |
|----------|----------|
| No L1 file exists | Return success: false, skip trigger |
| No entries since last update | Return success: false, skip trigger |
| First run (no lastUpdateTs) | Limit to last 50 entries |
| Delta exceeds Haiku limit | Truncate to safe token count |
| Haiku call fails | Don't update timestamp, retry next trigger |
| Session ends with pending delta | final() processes remaining delta |

---

## 2. UserPromptSubmit Rules Injection

### Current Problem

- Rules in SessionStart (load-memory.js) - runs once at start
- Rules in CLAUDE.md - static file, may be deprioritized
- Long sessions: initial context pushed back, rules forgotten

### Desired Behavior

- Inject rules via UserPromptSubmit hook (before each prompt processed)
- Default: every prompt (configurable via config)
- User sees brief indicator: `[rules injected]`
- Full rules hidden from user, visible to Claude via `additionalContext`

### Implementation

#### 2.1 New Script: `scripts/inject-rules.js`

```javascript
// scripts/inject-rules.js
const fs = require('fs');
const path = require('path');

const RULES = `
## CRITICAL RULES (auto-injected every prompt)
- NEVER delete files without explicit user permission. REPORT first, ASK permission.
- Think objectively. Don't just agree with user - verify claims independently.
- Don't assume, verify. Check the specified method first, even if you think you know a better way.
- When you make a mistake, don't apologize. Explain your actual reasoning process.
- If you don't know or want a better approach, search the internet.
`;

function getProjectDir() {
  // Try common methods to find project dir
  if (process.env.CLAUDE_PROJECT_DIR) {
    return process.env.CLAUDE_PROJECT_DIR;
  }
  return process.cwd();
}

function readJsonSafe(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {}
  return defaultValue;
}

function main() {
  try {
    const projectDir = getProjectDir();
    const configPath = path.join(projectDir, '.claude', 'memory', 'config.json');
    const config = readJsonSafe(configPath, {});

    const frequency = config.rulesInjectionFrequency || 1;

    // Counter stored in memory-index.json
    const indexPath = path.join(projectDir, '.claude', 'memory', 'memory-index.json');
    const index = readJsonSafe(indexPath, {});

    let count = (index.rulesInjectionCount || 0) + 1;

    // Update counter if frequency > 1 (need to track)
    if (frequency > 1) {
      index.rulesInjectionCount = count;
      fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    }

    // Check if should inject
    if (count % frequency === 0 || frequency === 1) {
      // Output rules via additionalContext (hidden from user, seen by Claude)
      const output = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: RULES
        }
      };
      console.log(JSON.stringify(output));

      // Brief indicator to stderr (shown to user)
      console.error('[rules injected]');
    }
  } catch (e) {
    // On error, still try to inject rules (fail-safe)
    console.error('[rules injection error: ' + e.message + ']');

    // Output rules anyway to not break the workflow
    const output = {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: RULES
      }
    };
    console.log(JSON.stringify(output));
  }
}

main();
```

#### 2.2 Update `hooks/hooks.json`

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/inject-rules.js\""
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/load-memory.js\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/counter.js\" check"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/counter.js\" final"
          }
        ]
      }
    ]
  }
}
```

#### 2.3 Config Options

In `.claude/memory/config.json`:
```json
{
  "saveInterval": 5,
  "rulesInjectionFrequency": 1,
  "quietStop": true
}
```

- `rulesInjectionFrequency`: 1 = every prompt (default), N = every N prompts
- Counter persists across sessions (intentional - maintains consistent injection rhythm)

#### 2.4 Output Mechanism

| Output Method | User Sees | Claude Sees |
|---------------|-----------|-------------|
| `console.log(JSON with additionalContext)` | No | Yes |
| `console.error(text)` | Yes | No |

#### 2.5 Error Handling

- Script wrapped in try/catch
- On error: log error to stderr, still inject rules (fail-safe)
- Never block user's prompt due to injection failure

#### 2.6 First Prompt Double Injection

- SessionStart outputs CLAUDE_RULES
- UserPromptSubmit also injects rules
- Result: Rules appear twice on first prompt
- Impact: Minor token overhead (~240 tokens), acceptable

---

## 3. Cleanup: Remove Redundant Rule Injection

### After Implementation

- **Keep:** `inject-rules.js` (UserPromptSubmit) - primary injection
- **Keep:** `load-memory.js` CLAUDE_RULES output (SessionStart) - backup/first prompt
- **Remove:** `ensureClaudeMdRules()` function in load-memory.js
- **Remove:** `CLAUDE_MD_SECTION` constant in load-memory.js

CLAUDE.md should contain project-specific notes only, not generic rules.

---

## 4. Implementation Order

### Phase 1: Rules Injection (simpler, test first)
1. Create `scripts/inject-rules.js`
2. Update `hooks/hooks.json` - add UserPromptSubmit
3. Test: verify `[rules injected]` shows, rules in Claude context
4. Test: verify error handling works

### Phase 2: Delta Updates (more complex)
1. Update `scripts/constants.js` - add new constants
2. Create `scripts/extract-delta.js` with CLI interface
3. Create `agents/delta-summarizer.md`
4. Create `skills/memory-delta/SKILL.md`
5. Update `scripts/counter.js` check() - integrate extractDelta
6. Update `scripts/counter.js` final() - add session-end delta processing
7. Test: verify delta extraction, timestamp watermark
8. Test: verify Haiku summarization via Task tool
9. Test: verify memory.md update and cleanup

### Phase 3: Cleanup & Documentation
1. Remove `ensureClaudeMdRules()` from load-memory.js
2. Remove `CLAUDE_MD_SECTION` from load-memory.js
3. Update CLAUDE.md (remove generic rules, keep project notes)
4. Update USER-MANUAL.md with new features
5. Update CHANGELOG.md

---

## 5. Files to Create/Modify

| File | Action | Phase |
|------|--------|-------|
| `scripts/inject-rules.js` | Create | 1 |
| `hooks/hooks.json` | Add UserPromptSubmit | 1 |
| `scripts/constants.js` | Add DELTA constants | 2 |
| `scripts/extract-delta.js` | Create (with CLI) | 2 |
| `agents/delta-summarizer.md` | Create | 2 |
| `skills/memory-delta/SKILL.md` | Create | 2 |
| `scripts/counter.js` | Integrate extractDelta in check() and final() | 2 |
| `scripts/load-memory.js` | Remove ensureClaudeMdRules | 3 |
| `CLAUDE.md` | Remove generic rules | 3 |
| `docs/USER-MANUAL.md` | Update documentation | 3 |
| `CHANGELOG.md` | Add v13.5.0 changes | 3 |

---

## 6. Key Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Delta extraction trigger | Tool count | Work volume = content to record |
| Delta tracking | Timestamp watermark | More reliable than pattern matching |
| Delta passing to Haiku | Temp file | No size limit, clean separation |
| Haiku invocation | Main Claude via Task tool | No API key handling in hook |
| Haiku context handling | Truncate to 190K tokens | 5% safety margin |
| First run handling | Limit to 50 entries | Prevent oversized first delta |
| Session-end delta | Process in final() | Capture current session content |
| Task tool format | `subagent_type: "delta-summarizer"` | Agent name only, no plugin prefix |
| Rules injection frequency | Every prompt (configurable) | Ensure rules always fresh |
| Rules injection errors | Fail-safe (inject anyway) | Never block user prompt |
| Output in delta | Include truncated (300 chars) | More context for summarization |

---

## 7. Success Criteria

- [ ] Rules injected every prompt (visible via `[rules injected]`)
- [ ] Rules injection error handling works (doesn't block prompt)
- [ ] Claude receives rules in context (verify via asking "what rules do you have?")
- [ ] Delta extracted based on timestamp watermark
- [ ] Delta includes tool output (truncated)
- [ ] First run limits to 50 entries
- [ ] Large delta truncated to Haiku safe limit
- [ ] Haiku called via Task tool with correct agent name
- [ ] Summary appended to memory.md with timestamp
- [ ] Timestamp marker updated after successful save
- [ ] Temp delta file cleaned up after use
- [ ] Session-end delta processing works in final()
- [ ] Config allows adjusting injection frequency

---

## 8. Testing Checklist

### Rules Injection Tests
- [ ] `[rules injected]` appears on each prompt
- [ ] Ask Claude "what rules were you given?" - should list rules
- [ ] Intentionally break config file - should still inject (fail-safe)
- [ ] Set frequency to 5, verify injection every 5 prompts

### Delta Update Tests
- [ ] Use 5+ tools, verify delta trigger fires
- [ ] Check delta_temp.txt content - should have entries since last update
- [ ] Verify Haiku summarization produces coherent summary
- [ ] Check memory.md - should have new timestamped entry
- [ ] Verify memory-index.json lastMemoryUpdateTs updated
- [ ] Verify delta_temp.txt deleted after success
- [ ] Start new session, verify previous session delta processed
- [ ] End session, verify session-end delta processed

---

## Version

Plan version: 4.0
Target version: 13.5.0
Date: 2026-01-14
