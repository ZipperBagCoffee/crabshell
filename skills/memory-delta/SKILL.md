---
name: memory-delta
description: "Auto-executes when the [CRABSHELL_DELTA] trigger is detected. Launches delta-processor background agent to summarize and append to memory.md without blocking. Not user-invocable — triggered automatically."
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

1. **Verify file exists first** (DO NOT SKIP):
   Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/delta_temp.txt` (limit 5 lines). If file not found or empty, STOP HERE - do not proceed.

2. **Check processing lock** (race condition prevention):
   Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/delta_processing.lock`.
   - If file not found → proceed.
   - If file content contains `"released": true` → proceed.
   - If file content contains `"locked": true` → parse the `ts` field. If the timestamp is older than 5 minutes → stale lock, proceed. If 5 minutes or less → STOP (another processor is running). Log: "Delta processing already in progress, skipping."

3. **Call delta-processor background agent**:
   Use the `delta-processor` agent (defined in `agents/delta-processor.md`).
   Call with `run_in_background: true`.

   Prompt (replace all placeholders with actual resolved paths):
   ```
   Process the delta file and append summary to memory.md.

   DELTA_PATH: {PROJECT_DIR}/.crabshell/memory/delta_temp.txt
   MEMORY_PATH: {PROJECT_DIR}/.crabshell/memory/memory.md
   PROJECT_DIR: {PROJECT_DIR}
   LOCK_PATH: {PROJECT_DIR}/.crabshell/memory/delta_processing.lock
   INDEX_PATH: {PROJECT_DIR}/.crabshell/memory/memory-index.json
   TZ_OFFSET: {TZ_OFFSET}
   ```

   To compute TZ_OFFSET: use JavaScript `new Date().getTimezoneOffset()` to get offset in minutes, then format as `+HHMM` or `-HHMM` (e.g., -540 minutes → "+0900" for KST, 300 minutes → "-0500" for EST).

   The agent runs in the background and handles steps 2-6 of the old flow:
   - Summarize (1 sentence per ~200 words)
   - Validate summary
   - Append to memory.md with dual timestamps
   - Run mark-updated
   - Run cleanup
   - Release lock

4. **Done** — the main conversation is not blocked. The delta-processor agent will complete in the background and results will be delivered when ready.

## Foreground Fallback

If the delta-processor agent call fails (e.g., agent not found, background execution not supported), fall back to the legacy foreground flow:

**Fallback Step 2**: Call `delta-summarizer` agent (foreground):
   Prompt: "Read {PROJECT_DIR}/.crabshell/memory/delta_temp.txt and summarize (1 sentence per ~200 words)."

**Fallback Step 3**: Validate response:
   - If response starts with "ERROR:" → STOP
   - If response is empty → STOP

**Fallback Step 4**: Append summary to memory.md:
   1. Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/memory.md` to get existing content.
   2. Generate dual timestamps from current time:
      - UTC: `YYYY-MM-DD_HHmm` format (e.g., `2026-03-28_0700`)
      - Local: `MM-DD_HHmm` format (e.g., `03-28_1600`) — use the timezone from your context's timestamp information
   3. Use the Write tool to write `{PROJECT_DIR}/.crabshell/memory/memory.md` with: `{existing content}\n\n## {utc_timestamp} (local {local_timestamp})\n{summary}\n`
   4. Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/memory-index.json`, parse the JSON.
   5. Set `memoryAppendedInThisRun` to `true` in the JSON object.
   6. Use the Write tool to write `{PROJECT_DIR}/.crabshell/memory/memory-index.json` back (preserve ALL other fields, 2-space indentation).

**Fallback Step 5**: Update timestamp marker:
   1. Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/memory-index.json`, parse the JSON.
   2. If `pendingLastProcessedTs` exists: set `lastMemoryUpdateTs` to its value, remove `pendingLastProcessedTs`.
   3. Else: set `lastMemoryUpdateTs` to current ISO timestamp.
   4. Use the Write tool to write `{PROJECT_DIR}/.crabshell/memory/memory-index.json` back (preserve ALL other fields, 2-space indentation).

**Fallback Step 6**: Clean up temp file:
   1. Use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/memory-index.json`, parse the JSON.
   2. Verify `memoryAppendedInThisRun` is `true`. If not → STOP (don't clean up).
   3. Use the Write tool to write `{PROJECT_DIR}/.crabshell/memory/delta_temp.txt` with empty content `""`.
   4. In the index JSON: set `deltaReady` to `false`, remove `memoryAppendedInThisRun`, remove `deltaCreatedAtMemoryMtime`.
   5. Use the Write tool to write `{PROJECT_DIR}/.crabshell/memory/memory-index.json` back (preserve ALL other fields, 2-space indentation).

## Failure Handling

- If file doesn't exist in step 1: STOP immediately
- If lock is fresh in step 2: STOP (another processor running)
- If background agent call fails in step 3: Use Foreground Fallback above
- If fallback also fails: Don't update timestamp, don't delete temp file
- Next trigger will retry with accumulated content (temp file overwritten)
