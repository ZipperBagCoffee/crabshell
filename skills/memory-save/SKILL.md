---
name: memory-save
description: Execute when you see "[MEMORY_KEEPER]" in hook output. Follow the numbered steps exactly to save session memory.
---

# Memory Save Skill

This skill activates when `[MEMORY_KEEPER]` appears in conversation (from PostToolUse or Stop hooks).

## When Triggered

You will see a message like:
```
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER] AUTO-SAVE TRIGGERED - N tool uses reached
═══════════════════════════════════════════════════════════════
```

## Required Actions

**Follow the numbered steps in the hook message exactly:**

1. **ANALYZE** - Review the session and identify accomplishments, decisions, patterns, issues
2. **SAVE memory.md** - Append summary using the provided bash command
3. **SAVE session file** - Create session file using the provided bash command
4. **UPDATE facts.json** - If decisions/patterns/issues found, update the JSON file
5. **RESET counter** - Run the reset command provided

## Example Execution

```bash
# Step 2: Append to memory.md
echo -e "\n## 2025-12-21_1430\nImplemented new feature X. Fixed bug in Y." >> ".claude/memory/memory.md"

# Step 3: Save session file
echo "Session summary: Implemented feature X, fixed Y bug, discovered pattern Z." > ".claude/memory/sessions/2025-12-21_1430.md"

# Step 5: Reset counter
node "scripts/counter.js" reset
```

## facts.json Update Example

```javascript
// Read current facts
const facts = JSON.parse(fs.readFileSync('.claude/memory/facts.json'));

// Add new items
facts.decisions.push({
  id: "d" + String(facts.decisions.length + 1).padStart(3, '0'),
  date: "2025-12-21",
  content: "Decision description",
  reason: "Why this decision"
});

// Write back
fs.writeFileSync('.claude/memory/facts.json', JSON.stringify(facts, null, 2));
```

## Critical Rules

- **DO NOT SKIP** any steps
- **USE THE EXACT PATHS** provided in the hook message
- **RESET COUNTER** after saving (prevents duplicate triggers)
- Keep summaries concise (2-3 sentences for memory.md)
