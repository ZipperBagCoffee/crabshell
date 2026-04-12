---
name: memory-delta
description: "Auto-executes when the [CRABSHELL_DELTA] trigger is detected. Calls delta-summarizer agent to summarize and append to logbook.md. Not user-invocable — triggered automatically."
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

**Step 4**: Append summary to logbook.md and mark appended:
   1. Write the summary text to a temp file: Use Write tool to save ONLY the summary text (the new entry with timestamp header) to `{PROJECT_DIR}/.crabshell/memory/delta_summary_temp.txt`
   2. Run via Bash: `"C:/Program Files/nodejs/node.exe" "{PLUGIN_ROOT}/scripts/append-memory.js" --project-dir="{PROJECT_DIR}"`
      (Reads delta_summary_temp.txt, appends to logbook.md with dual timestamps, cleans up temp file)
   3. Run via Bash: `"C:/Program Files/nodejs/node.exe" "{PLUGIN_ROOT}/scripts/extract-delta.js" mark-appended --project-dir="{PROJECT_DIR}"`
      (Sets `memoryAppendedInThisRun=true` in memory-index.json)

**Step 5**: Update timestamp marker:
   Run via Bash: `"C:/Program Files/nodejs/node.exe" "{PLUGIN_ROOT}/scripts/extract-delta.js" mark-updated --project-dir="{PROJECT_DIR}"`
   (Moves `pendingLastProcessedTs` → `lastMemoryUpdateTs`, or uses current ISO timestamp as fallback)

**Step 6**: Clean up temp file:
   Run via Bash: `"C:/Program Files/nodejs/node.exe" "{PLUGIN_ROOT}/scripts/extract-delta.js" cleanup --project-dir="{PROJECT_DIR}"`
   (Verifies logbook.md was updated, deletes delta_temp.txt, clears `deltaReady` and `memoryAppendedInThisRun`)

## Failure Handling

- If file doesn't exist in Step 1: STOP immediately
- If summarizer fails in Step 2: Don't update timestamp, don't delete temp file
- Next trigger will retry with accumulated content (temp file overwritten)
