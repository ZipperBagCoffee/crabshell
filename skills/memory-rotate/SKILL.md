---
name: memory-rotate
description: "Auto-executes when the [CRABSHELL_ROTATE] trigger is detected, rotating memory.md when it exceeds token limits. Calls Haiku agent for summarization of rotated content. Not user-invocable — triggered automatically."
---

## Trigger Condition

Auto-invoked when hook outputs `[CRABSHELL_ROTATE] file=memory_XXXXXXXX_XXXXXX.md`.

## Execution Steps

1. **Parse file path**: Extract filename after `file=` from trigger message
2. **Call memory-summarizer agent**:
   Use the `memory-summarizer` agent (defined in `agents/memory-summarizer.md`).
   Prompt: "Read and summarize: .crabshell/memory/{filename}"
3. **Save result**:
   - Returned JSON → `.crabshell/memory/{filename with .md replaced by .summary.json}`
   - Use Write tool
4. **Update index**:
   - Set `summaryGenerated: true` for this entry in `memory-index.json`
   - Use Edit tool

## Failure Handling

- Task failure: Log error, keep `summaryGenerated: false`
- Retry trigger will auto-fire on next session start
