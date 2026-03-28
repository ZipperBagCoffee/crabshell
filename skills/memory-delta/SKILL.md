---
name: memory-delta
description: "Auto-executes when the [CRABSHELL_DELTA] trigger is detected. Calls delta-summarizer agent in foreground to summarize and append to memory.md. Not user-invocable — triggered automatically."
---

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

## Trigger Condition

Auto-invoked when EITHER:
1. Hook stderr outputs: `[CRABSHELL_DELTA] file=delta_temp.txt`
2. Context contains: `[CRABSHELL_DELTA]` trigger pattern

If you see `[CRABSHELL_DELTA]` anywhere in your context, execute this skill immediately.

## Execution Steps

**Step 1**: Verify file exists (DO NOT SKIP):
   Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/delta_temp.txt` (limit 5 lines). If file not found or empty, STOP HERE - do not proceed.

**Step 2**: Call `delta-summarizer` agent (foreground):
   Prompt: "Read {PROJECT_DIR}/.crabshell/memory/delta_temp.txt and summarize (1 sentence per ~200 words)."

**Step 3**: Validate response:
   - If response starts with "ERROR:" → STOP
   - If response is empty → STOP

**Step 4**: Append summary to memory.md:
   1. Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/memory.md` to get existing content.
   2. Generate dual timestamps from current time. TZ_OFFSET is available from your context's "Timezone" section.
      - UTC: `YYYY-MM-DD_HHmm` format (e.g., `2026-03-28_0700`)
      - Local: `MM-DD_HHmm` format (e.g., `03-28_1600`) — use the TZ_OFFSET to compute local time
   3. Use the Write tool to write `{PROJECT_DIR}/.crabshell/memory/memory.md` with: `{existing content}\n\n## {utc_timestamp} (local {local_timestamp})\n{summary}\n`
   4. Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/memory-index.json`, parse the JSON.
   5. Set `memoryAppendedInThisRun` to `true` in the JSON object.
   6. Use the Write tool to write `{PROJECT_DIR}/.crabshell/memory/memory-index.json` back (preserve ALL other fields, 2-space indentation).

**Step 5**: Update timestamp marker:
   1. Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/memory-index.json`, parse the JSON.
   2. If `pendingLastProcessedTs` exists: set `lastMemoryUpdateTs` to its value, remove `pendingLastProcessedTs`.
   3. Else: set `lastMemoryUpdateTs` to current ISO timestamp.
   4. Use the Write tool to write `{PROJECT_DIR}/.crabshell/memory/memory-index.json` back (preserve ALL other fields, 2-space indentation).

**Step 6**: Clean up temp file:
   1. Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/memory-index.json`, parse the JSON.
   2. Verify `memoryAppendedInThisRun` is `true`. If not → STOP (don't clean up).
   3. Use the Write tool to write `{PROJECT_DIR}/.crabshell/memory/delta_temp.txt` with empty content `""`.
   4. In the index JSON: set `deltaReady` to `false`, remove `memoryAppendedInThisRun`, remove `deltaCreatedAtMemoryMtime`.
   5. Use the Write tool to write `{PROJECT_DIR}/.crabshell/memory/memory-index.json` back (preserve ALL other fields, 2-space indentation).

## Failure Handling

- If file doesn't exist in Step 1: STOP immediately
- If summarizer fails in Step 2: Don't update timestamp, don't delete temp file
- Next trigger will retry with accumulated content (temp file overwritten)
