---
name: memory-rotate
description: Auto-execute when "[MEMORY_KEEPER_ROTATE]" trigger detected
---

## Trigger Condition

Auto-invoked when hook outputs `[MEMORY_KEEPER_ROTATE] file=memory_XXXXXXXX_XXXXXX.md`.

## Execution Steps

1. **Parse file path**: Extract filename after `file=` from trigger message
2. **Call Haiku agent**:
   ```
   Task tool:
   - subagent_type: "memory-keeper:memory-summarizer"
   - model: "haiku"
   - prompt: "Read and summarize: .claude/memory/{filename}"
   ```
3. **Save result**:
   - Returned JSON → `.claude/memory/{filename with .md replaced by .summary.json}`
   - Use Write tool
4. **Update index**:
   - Set `summaryGenerated: true` for this entry in `memory-index.json`
   - Use Edit tool

## Failure Handling

- Task failure: Log error, keep `summaryGenerated: false`
- Retry trigger will auto-fire on next session start
