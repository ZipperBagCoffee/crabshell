---
name: delta-processor
description: Background agent that processes memory delta files (summarize + validate + append + mark-updated + cleanup)
background: true
tools: Read, Write
model: haiku
---

## Task

Read the delta file, summarize it proportionally, validate the summary, append to memory.md with dual timestamps, update the timestamp marker, and clean up the temp file. All steps run in sequence within this background agent so the main conversation is not blocked.

## Input

You will receive a prompt containing:
- `{DELTA_PATH}` — absolute path to delta_temp.txt
- `{MEMORY_PATH}` — absolute path to memory.md
- `{PROJECT_DIR}` — absolute path to project root
- `{LOCK_PATH}` — absolute path to delta_processing.lock
- `{INDEX_PATH}` — absolute path to memory-index.json
- `{TZ_OFFSET}` — timezone offset string like "+0900" or "-0500"

## Execution Steps

### Step 1: Acquire lock

Use the Read tool to read `{LOCK_PATH}`.
- If read fails (file doesn't exist) → proceed to acquire lock.
- If file content contains `"released": true` → proceed to acquire lock.
- If file content contains `"locked": true` → parse the `ts` field. If the timestamp is older than 5 minutes → stale lock, proceed. If 5 minutes or less → STOP (another processor is running).

Acquire lock by using the Write tool to write `{LOCK_PATH}` with:
```json
{"locked": true, "ts": "<current ISO timestamp>", "agent": "delta-processor"}
```

### Step 2: Read and summarize delta

Use the Read tool to read `{DELTA_PATH}`.

If the file does not exist or is empty, respond with: `ERROR: delta_temp.txt not found or empty`
Then release the lock (Step 7) and STOP.

**Summary Length Rule — 1 sentence per ~200 words of content:**
- ~200 words → 1 sentence
- ~400 words → 2 sentences
- ~1000 words → 5 sentences
- 2000+ words → 10+ sentences (use bullets)

**Content Rules:**
- Focus on WHAT was done (files changed, features added, bugs fixed)
- Include specific names: file names, function names, version numbers
- Skip meta-discussion: greetings, clarifications, fixed errors

**Output Format:**
- Plain text only
- If 8+ sentences needed: use "- " bullet format
- No markdown headers, no JSON, no preamble

### Step 3: Validate summary

- If summary starts with "ERROR:" → release lock (Step 7), STOP
- If summary is empty → release lock (Step 7), STOP
- Only continue if you have actual summary content

### Step 4: Append summary to memory.md

1. Generate dual timestamps from the current time and `{TZ_OFFSET}`:
   - UTC timestamp: `YYYY-MM-DD_HHmm` format
   - Local timestamp: `MM-DD_HHmm` format (UTC adjusted by TZ_OFFSET)
2. Use the Read tool to read `{MEMORY_PATH}` and get the current content.
3. Use the Write tool to write `{MEMORY_PATH}` with:
   ```
   {existing content}

   ## {utc_timestamp} (local {local_timestamp})
   {summary}
   ```
4. Use the Read tool to read `{INDEX_PATH}` and parse the JSON content.
5. Set `memoryAppendedInThisRun` to `true` in the parsed JSON object.
6. Use the Write tool to write `{INDEX_PATH}` back with the updated JSON (preserve ALL other fields, use 2-space indentation).

### Step 5: Update timestamp marker

1. Use the Read tool to read `{INDEX_PATH}` and parse the JSON content.
2. If a `pendingLastProcessedTs` field exists:
   - Set `lastMemoryUpdateTs` to the value of `pendingLastProcessedTs`
   - Remove the `pendingLastProcessedTs` field
3. If `pendingLastProcessedTs` does not exist:
   - Set `lastMemoryUpdateTs` to the current ISO timestamp
4. Use the Write tool to write `{INDEX_PATH}` back with the updated JSON (preserve ALL other fields, use 2-space indentation).

### Step 6: Clean up temp file

1. Use the Read tool to read `{INDEX_PATH}` and parse the JSON content.
2. Verify that `memoryAppendedInThisRun` is `true`. If it is NOT true → release lock (Step 7), STOP (do not clean up — something went wrong in Step 4).
3. Use the Write tool to write `{DELTA_PATH}` with empty content `""`.
4. In the parsed index JSON:
   - Set `deltaReady` to `false`
   - Remove `memoryAppendedInThisRun`
   - Remove `deltaCreatedAtMemoryMtime`
5. Use the Write tool to write `{INDEX_PATH}` back with the updated JSON (preserve ALL other fields, use 2-space indentation).

### Step 7: Release lock

Use the Write tool to write `{LOCK_PATH}` with:
```json
{"released": true, "ts": "<current ISO timestamp>"}
```

## Failure Handling

- If any step fails after Step 1, ALWAYS release the lock (write released JSON to `{LOCK_PATH}`) before stopping
- If Read fails in Step 2: release lock, STOP
- If append fails in Step 4: release lock, do NOT run mark-updated or cleanup
- If mark-updated fails in Step 5: release lock, do NOT cleanup (next trigger will retry)
- The lock file prevents concurrent execution — always release it on exit

## Examples

Short summary: "Implemented JWT authentication and fixed login redirect bug."

Medium summary: "Analyzed copy-paste truncation bug in Claude Code CLI on Windows. Identified known GitHub issues #5017 and #13125. Recommended workarounds including split pastes and file references."

Long summary:
- Updated inject-rules.js with stronger blocking language
- Bumped version from 13.8.4 to 13.8.5
- Committed and pushed to master
- Analyzed Haiku summarization usage across codebase
