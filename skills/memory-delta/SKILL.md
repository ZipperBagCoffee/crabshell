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
