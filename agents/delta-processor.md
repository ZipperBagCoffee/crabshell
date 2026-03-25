---
name: delta-processor
description: Background agent that processes memory delta files (summarize + validate + append + mark-updated + cleanup)
background: true
tools: Read, Bash
model: haiku
---

## Task

Read the delta file, summarize it proportionally, validate the summary, append to memory.md with dual timestamps, update the timestamp marker, and clean up the temp file. All steps run in sequence within this background agent so the main conversation is not blocked.

## Input

You will receive a prompt containing:
- `{DELTA_PATH}` — absolute path to delta_temp.txt
- `{MEMORY_PATH}` — absolute path to memory.md
- `{NODE_PATH}` — absolute path to node executable
- `{SCRIPTS_PATH}` — absolute path to scripts directory
- `{PROJECT_DIR}` — absolute path to project root
- `{LOCK_PATH}` — absolute path to delta_processing.lock

## Execution Steps

### Step 1: Acquire lock

```bash
echo "$$" > "{LOCK_PATH}"
```

If the lock file already exists, check if it is stale (older than 5 minutes). If stale, overwrite it. If fresh, STOP — another processor is running.

### Step 2: Read and summarize delta

Use the Read tool to read `{DELTA_PATH}`.

If the file does not exist or is empty, respond with: `ERROR: delta_temp.txt not found or empty`
Then delete the lock file and STOP.

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

- If summary starts with "ERROR:" → delete lock file, STOP
- If summary is empty → delete lock file, STOP
- Only continue if you have actual summary content

### Step 4: Append summary to memory.md

Run this single command (replace {SUMMARY} with the summary text from Step 2):

```bash
TS_UTC=$(date -u +%Y-%m-%d_%H%M) && TS_LOCAL=$(date +%m-%d_%H%M) && printf '\n## %s (local %s)\n%s\n' "$TS_UTC" "$TS_LOCAL" "{SUMMARY}" >> "{MEMORY_PATH}"
```

**WARNING: Do NOT modify this command. Copy EXACTLY as written.**
- The date format uses single `%` (e.g. `%Y`), NOT `%%Y`

### Step 5: Update timestamp marker

```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/extract-delta.js" mark-updated --project-dir="{PROJECT_DIR}"
```

### Step 6: Clean up temp file

```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/extract-delta.js" cleanup --project-dir="{PROJECT_DIR}"
```

### Step 7: Release lock

```bash
rm -f "{LOCK_PATH}"
```

## Failure Handling

- If any step fails after Step 1, ALWAYS delete the lock file before stopping
- If Read fails in Step 2: delete lock, STOP
- If append fails in Step 4: delete lock, do NOT run mark-updated or cleanup
- If mark-updated fails in Step 5: delete lock, do NOT cleanup (next trigger will retry)
- The lock file prevents concurrent execution — always release it on exit

## Examples

Short summary: "Implemented JWT authentication and fixed login redirect bug."

Medium summary: "Analyzed copy-paste truncation bug in Claude Code CLI on Windows. Identified known GitHub issues #5017 and #13125. Recommended workarounds including split pastes and file references."

Long summary:
- Updated inject-rules.js with stronger blocking language
- Bumped version from 13.8.4 to 13.8.5
- Committed and pushed to master
- Analyzed Haiku summarization usage across codebase
