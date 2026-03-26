---
name: memory-delta
description: "Auto-executes when the [MEMORY_KEEPER_DELTA] trigger is detected. Launches delta-processor background agent to summarize and append to memory.md without blocking. Not user-invocable — triggered automatically."
---

## Node.js Path
Use the Node.js absolute path from your context's "Node.js Path" section (injected by the plugin on every prompt).
If not available in context, fall back to `node`.

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

From "Base directory for this skill:" above, derive the scripts path:
- Remove `/skills/memory-delta` from the end
- Add `/scripts/` to get the scripts directory

Example: if Base directory is `~/.claude/plugins/cache/.../skills/memory-delta`, then Scripts path is derived by removing `/skills/memory-delta` and appending `/scripts/`.

Use this full path when running node commands below.

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

## Trigger Condition

Auto-invoked when EITHER:
1. Hook stderr outputs: `[MEMORY_KEEPER_DELTA] file=delta_temp.txt`
2. Context contains: `[MEMORY_KEEPER_DELTA]` trigger pattern

If you see `[MEMORY_KEEPER_DELTA]` anywhere in your context, execute this skill immediately.

## Execution Steps

1. **Verify file exists first** (DO NOT SKIP):
   ```bash
   cat "{PROJECT_DIR}/.claude/memory/delta_temp.txt" | head -5
   ```
   If file not found or empty, STOP HERE - do not proceed.

2. **Check processing lock** (race condition prevention):
   ```bash
   cat "{PROJECT_DIR}/.claude/memory/delta_processing.lock" 2>/dev/null
   ```
   - If lock file exists AND is less than 5 minutes old → STOP (another processor is running). Log: "Delta processing already in progress, skipping."
   - If lock file exists AND is older than 5 minutes → stale lock, proceed (will be overwritten by agent).
   - If lock file does not exist → proceed.

   To check lock age:
   ```bash
   find "{PROJECT_DIR}/.claude/memory/" -name "delta_processing.lock" -mmin -5 2>/dev/null
   ```
   If this returns the file path, the lock is fresh — STOP. If empty output, proceed.

3. **Call delta-processor background agent**:
   Use the `delta-processor` agent (defined in `agents/delta-processor.md`).
   Call with `run_in_background: true`.

   Prompt (replace all placeholders with actual resolved paths):
   ```
   Process the delta file and append summary to memory.md.

   DELTA_PATH: {PROJECT_DIR}/.claude/memory/delta_temp.txt
   MEMORY_PATH: {PROJECT_DIR}/.claude/memory/memory.md
   NODE_PATH: {NODE_PATH}
   SCRIPTS_PATH: {SCRIPTS_PATH}
   PROJECT_DIR: {PROJECT_DIR}
   LOCK_PATH: {PROJECT_DIR}/.claude/memory/delta_processing.lock
   ```

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
   Prompt: "Read {PROJECT_DIR}/.claude/memory/delta_temp.txt and summarize (1 sentence per ~200 words)."

**Fallback Step 3**: Validate response:
   - If response starts with "ERROR:" → STOP
   - If response is empty → STOP

**Fallback Step 4**: Append summary to memory.md:
   ```bash
   "{NODE_PATH}" -e "const fs=require('fs');const d=new Date();const p=n=>String(n).padStart(2,'0');const u=d.getUTCFullYear()+'-'+p(d.getUTCMonth()+1)+'-'+p(d.getUTCDate())+'_'+p(d.getUTCHours())+p(d.getUTCMinutes());const l=p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes());fs.appendFileSync('{PROJECT_DIR}/.claude/memory/memory.md','\\n## '+u+' (local '+l+')\\n'+'{SUMMARY}'+'\\n')"
   ```

   **WARNING: Do NOT modify this command. Copy EXACTLY as written.**
   - The date format uses single `%` (e.g. `%Y`), NOT `%%Y`

**Fallback Step 5**: Update timestamp marker:
   ```bash
   "{NODE_PATH}" "{SCRIPTS_PATH}/extract-delta.js" mark-updated --project-dir="{PROJECT_DIR}"
   ```

**Fallback Step 6**: Delete temp file:
   ```bash
   "{NODE_PATH}" "{SCRIPTS_PATH}/extract-delta.js" cleanup --project-dir="{PROJECT_DIR}"
   ```

## Failure Handling

- If file doesn't exist in step 1: STOP immediately
- If lock is fresh in step 2: STOP (another processor running)
- If background agent call fails in step 3: Use Foreground Fallback above
- If fallback also fails: Don't update timestamp, don't delete temp file
- Next trigger will retry with accumulated content (temp file overwritten)
