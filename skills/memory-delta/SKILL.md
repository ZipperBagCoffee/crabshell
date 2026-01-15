---
name: memory-delta
description: Auto-execute when "[MEMORY_KEEPER_DELTA]" trigger detected
---

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

From "Base directory for this skill:" above, derive the scripts path:
- Remove `/skills/memory-delta` from the end
- Add `/scripts/` to get the scripts directory

Example:
- Base: `~/.claude/plugins/cache/memory-keeper-marketplace/memory-keeper/13.8.3/skills/memory-delta`
- Scripts: `~/.claude/plugins/cache/memory-keeper-marketplace/memory-keeper/13.8.3/scripts/`

Use this full path when running node commands below.

## Trigger Condition

Auto-invoked when hook outputs `[MEMORY_KEEPER_DELTA] file=delta_temp.txt`.

## Execution Steps

1. **Call Haiku agent for summarization**:
   ```
   Task tool:
   - subagent_type: "memory-keeper:delta-summarizer"
   - model: "haiku"
   - prompt: "Read .claude/memory/delta_temp.txt and summarize in 1-2 sentences."
   ```

2. **Get current timestamp**:
   ```bash
   date +"%Y-%m-%d_%H%M"
   ```

3. **Append summary to memory.md**:
   ```bash
   printf '\n## %s\n%s\n' "{timestamp}" "{haiku_summary}" >> .claude/memory/memory.md
   ```

4. **Update timestamp marker** (use full path from above):
   ```bash
   node "{SCRIPTS_PATH}/extract-delta.js" mark-updated
   ```

5. **Delete temp file** (use full path from above):
   ```bash
   node "{SCRIPTS_PATH}/extract-delta.js" cleanup
   ```

## Failure Handling

- If Task tool fails: Don't update timestamp, don't delete temp file
- Next trigger will retry with accumulated content (temp file overwritten)
- Log error but don't block main workflow
