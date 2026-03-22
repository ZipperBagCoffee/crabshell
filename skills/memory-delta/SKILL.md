---
name: memory-delta
description: "Auto-executes when the [MEMORY_KEEPER_DELTA] trigger is detected, summarizing recent conversation deltas and appending to memory.md. Calls Haiku agent for proportional summarization. Not user-invocable — triggered automatically."
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

2. **Call delta-summarizer agent**:
   Use the `delta-summarizer` agent (defined in `agents/delta-summarizer.md`).
   Prompt: "Read {PROJECT_DIR}/.claude/memory/delta_temp.txt and summarize (1 sentence per ~200 words)."
   Replace {PROJECT_DIR} with the actual project root (absolute path).

3. **Validate Haiku response**:
   - If response starts with "ERROR:" → STOP, do not proceed
   - If response is empty or says "file not found" → STOP, do not proceed
   - Only continue if you have actual summary content

4. **Append summary to memory.md with dual timestamps**:
   Run this single command (replace {SUMMARY} with Haiku's response):
   ```bash
   TS_UTC=$(date -u +%Y-%m-%d_%H%M) && TS_LOCAL=$(date +%m-%d_%H%M) && printf '\n## %s (local %s)\n%s\n' "$TS_UTC" "$TS_LOCAL" "{SUMMARY}" >> "{PROJECT_DIR}/.claude/memory/memory.md"
   ```

   **WARNING: Do NOT modify this command. Copy EXACTLY as written.**
   - The date format uses single `%` (e.g. `%Y`), NOT `%%Y`
   - `%%` in date means "literal %" which outputs format strings instead of dates

   Example output: `## 2026-02-01_1727 (local 02-01_0927)`

5. **Update timestamp marker** (use full path from above):
   ```bash
   "{NODE_PATH}" "{SCRIPTS_PATH}/extract-delta.js" mark-updated --project-dir="{PROJECT_DIR}"
   ```

6. **Delete temp file** (use full path from above):
   ```bash
   "{NODE_PATH}" "{SCRIPTS_PATH}/extract-delta.js" cleanup --project-dir="{PROJECT_DIR}"
   ```

## Failure Handling

- If file doesn't exist in step 1: STOP immediately
- If Haiku returns ERROR or empty: STOP, don't update/cleanup
- If agent call fails: Don't update timestamp, don't delete temp file
- Next trigger will retry with accumulated content (temp file overwritten)
