---
name: memory-delta
description: Auto-execute when "[MEMORY_KEEPER_DELTA]" trigger detected
---

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

From "Base directory for this skill:" above, derive the scripts path:
- Remove `/skills/memory-delta` from the end
- Add `/scripts/` to get the scripts directory

Example:
- Base: `~/.claude/plugins/cache/memory-keeper-marketplace/memory-keeper/13.8.3/skills/memory-delta`
- Scripts: `~/.claude/plugins/cache/memory-keeper-marketplace/memory-keeper/13.8.3/scripts/`

Use this full path when running node commands below.

## Trigger Condition

Auto-invoked when hook outputs `[MEMORY_KEEPER_DELTA] file=delta_temp.txt`.

## Execution Steps

1. **Verify file exists first** (DO NOT SKIP):
   ```bash
   cat .claude/memory/delta_temp.txt | head -5
   ```
   If file not found or empty, STOP HERE - do not proceed.

2. **Call Haiku agent for summarization**:
   Use **absolute path** (get from pwd):
   ```
   Task tool:
   - subagent_type: "memory-keeper:delta-summarizer"
   - model: "haiku"
   - prompt: "Read {PWD}/.claude/memory/delta_temp.txt and summarize (1 sentence per ~200 words)."
   ```
   Replace {PWD} with the actual current working directory (absolute path).

3. **Validate Haiku response**:
   - If response starts with "ERROR:" → STOP, do not proceed
   - If response is empty or says "file not found" → STOP, do not proceed
   - Only continue if you have actual summary content

4. **Get current timestamps (UTC + local)**:
   ```bash
   date -u +"%Y-%m-%d_%H%M"   # UTC (main)
   date +"%m-%d_%H%M"         # local (sub)
   ```

5. **Append summary to memory.md**:
   Format: `## {UTC_TIMESTAMP} (local {LOCAL_TIMESTAMP})`
   ```bash
   printf '\n## %s (local %s)\n%s\n' "{utc_timestamp}" "{local_timestamp}" "{haiku_summary}" >> .claude/memory/memory.md
   ```

6. **Update timestamp marker** (use full path from above):
   ```bash
   node "{SCRIPTS_PATH}/extract-delta.js" mark-updated
   ```

7. **Delete temp file** (use full path from above):
   ```bash
   node "{SCRIPTS_PATH}/extract-delta.js" cleanup
   ```

## Failure Handling

- If file doesn't exist in step 1: STOP immediately
- If Haiku returns ERROR or empty: STOP, don't update/cleanup
- If Task tool fails: Don't update timestamp, don't delete temp file
- Next trigger will retry with accumulated content (temp file overwritten)
