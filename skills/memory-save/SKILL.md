---
name: memory-save
description: Auto-triggered when "[MEMORY_KEEPER_SAVE]" appears in hook output. Summarizes session and saves to .claude/memory/. Use when you see MEMORY_KEEPER_SAVE or MEMORY_KEEPER_FINAL messages.
---

# Memory Save Skill

When you see `[MEMORY_KEEPER_SAVE]` or `[MEMORY_KEEPER_FINAL]` in the conversation, execute this skill automatically.

## Step 1: Analyze Current Session

Review the conversation and identify:
- What was accomplished (summary)
- Key decisions made and why
- Patterns or conventions discovered
- Issues found (open or resolved)

## Step 2: Create Summary JSON

Format your analysis as:
```json
{
  "summary": "200-300 char summary of what was done",
  "decisions": [{"content": "decision made", "reason": "why"}],
  "patterns": [{"content": "pattern discovered"}],
  "issues": [{"content": "issue", "status": "open|resolved"}]
}
```

## Step 3: Save Files

Use Bash to save (paths from hook message):

```bash
# Get project memory directory
MEMORY_DIR=".claude/memory"
TIMESTAMP=$(date +%Y-%m-%d_%H%M)

# Append to memory.md
echo -e "\n## ${TIMESTAMP}\n[Your summary here]" >> "${MEMORY_DIR}/memory.md"

# Save session file
echo "[Full summary]" > "${MEMORY_DIR}/sessions/${TIMESTAMP}.md"
```

## Step 4: Update facts.json

If decisions, patterns, or issues were found, update facts.json by reading existing content and appending new items.

## Step 5: Reset Counter

Run the reset command from the hook message:
```bash
node "[path from message]" reset
```

## Important

- Always save files BEFORE resetting counter
- Use paths provided in the hook message
- Keep summaries concise (under 300 chars)
- Empty arrays are fine if nothing to report
