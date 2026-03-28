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

**Step 4**: Append summary to memory.md and mark appended:
   1. Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/memory.md` to get existing content.
   2. Generate dual timestamps from current time. TZ_OFFSET is available from your context's "Timezone" section.
      - UTC: `YYYY-MM-DD_HHmm` format (e.g., `2026-03-28_0700`)
      - Local: `MM-DD_HHmm` format (e.g., `03-28_1600`) — use the TZ_OFFSET to compute local time
   3. Use the Write tool to write `{PROJECT_DIR}/.crabshell/memory/memory.md` with: `{existing content}\n\n## {utc_timestamp} (local {local_timestamp})\n{summary}\n`
   4. Run via Bash: `"C:/Program Files/nodejs/node.exe" "{PLUGIN_ROOT}/scripts/extract-delta.js" mark-appended --project-dir="{PROJECT_DIR}"`
      (Sets `memoryAppendedInThisRun=true` in memory-index.json)

**Step 5**: Update timestamp marker:
   Run via Bash: `"C:/Program Files/nodejs/node.exe" "{PLUGIN_ROOT}/scripts/extract-delta.js" mark-updated --project-dir="{PROJECT_DIR}"`
   (Moves `pendingLastProcessedTs` → `lastMemoryUpdateTs`, or uses current ISO timestamp as fallback)

**Step 6**: Clean up temp file:
   Run via Bash: `"C:/Program Files/nodejs/node.exe" "{PLUGIN_ROOT}/scripts/extract-delta.js" cleanup --project-dir="{PROJECT_DIR}"`
   (Verifies memory.md was updated, deletes delta_temp.txt, clears `deltaReady` and `memoryAppendedInThisRun`)

## Failure Handling

- If file doesn't exist in Step 1: STOP immediately
- If summarizer fails in Step 2: Don't update timestamp, don't delete temp file
- Next trigger will retry with accumulated content (temp file overwritten)
