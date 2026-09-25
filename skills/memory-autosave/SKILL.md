---
name: memory-autosave
description: "Auto-executes when the [CRABSHELL_SAVE] trigger is detected in hook output. Saves session memory following a numbered step sequence. Not user-invocable — triggered automatically by the plugin system."
user-invocable: false
---

## Node.js Path
Use the Node.js absolute path from your context's "Node.js Path" section (injected by the plugin on every prompt).
If not available in context, fall back to `node`.

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

From "Base directory for this skill:" above, derive the scripts path:
- Remove `/skills/memory-autosave` from the end
- Add `/scripts/` to get the scripts directory

Example: if Base directory is `~/.claude/plugins/cache/.../skills/memory-autosave`, then Scripts path is derived by removing `/skills/memory-autosave` and appending `/scripts/`.

Use this full path when running node commands below.

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

# Memory Save Skill

This skill activates when `[CRABSHELL_SAVE]` appears in conversation.

## Memory Structure

```
.crabshell/memory/
  project.md        <- Project overview (per-prompt injected)
  logbook.md        <- Rolling session log (last 50 lines loaded)
  sessions/         <- L1 session transcripts (auto-generated)
  logs/             <- Debug and error logs
```

## Trigger Message

```
═══════════════════════════════════════════════════════════════
[CRABSHELL_SAVE] AUTO-SAVE TRIGGERED - N tool uses reached
═══════════════════════════════════════════════════════════════
```

## Required Actions

### Step 1: Save to logbook.md
Write the summary to its own file in the memory folder and append it with append-memory.js — it takes the memory locks and writes the `## UTC (local …)` header, so never append to logbook.md directly:
1. Use the Write tool to save a 1-2 sentence session summary to `{PROJECT_DIR}/.crabshell/memory/autosave-summary-{YYYYMMDD-HHMMSS}.txt` (a new name each time, so concurrent sessions do not overwrite each other)
2. Run:
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/append-memory.js" --project-dir="{PROJECT_DIR}" --summary-file="{PROJECT_DIR}/.crabshell/memory/autosave-summary-{YYYYMMDD-HHMMSS}.txt"
```
If it fails with `A prepared delta job exists`, run the memory-delta skill first (it finalizes that pending summary), then run the command again. If `append-memory.js` cannot run at all, leave the summary file in place and report that the save did not happen.

## Session End (Stop Hook)

Additional step (use full path from above):
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" compress --project-dir="{PROJECT_DIR}"
```

## Optional: Update Hierarchical Memory

If major project understanding changed, update stable memory files (use full path):
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" memory-set project "Updated project description..." --project-dir="{PROJECT_DIR}"
```

**When to update:**
- `project.md`: New project scope, goals, or tech stack

**View current memory:**
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" memory-list --project-dir="{PROJECT_DIR}"
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" memory-get project --project-dir="{PROJECT_DIR}"
```

## Critical

- **DO NOT SKIP** the logbook.md append step
- Counter resets automatically (no manual reset needed)

See [Architecture](../../docs/ARCHITECTURE.md) for full details.
