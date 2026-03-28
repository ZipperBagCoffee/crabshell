---
name: load-memory
description: "Loads full hierarchical memory context including project info, L3 summaries, and rolling memory. Use after session restart, context compaction, or when memory context feels incomplete or stale. Invoke with /load-memory."
---

## Node.js Path
Use the Node.js absolute path from your context's "Node.js Path" section (injected by the plugin on every prompt).
If not available in context, fall back to `node`.

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

From "Base directory for this skill:" above, derive the scripts path:
- Remove `/skills/load-memory` from the end
- Add `/scripts/` to get the scripts directory

Example: if Base directory is `~/.claude/plugins/cache/.../skills/load-memory`, then Scripts path is derived by removing `/skills/load-memory` and appending `/scripts/`.

Use this full path when running node commands below.

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

# Load Memory

Reload memory context into current session.

## Usage

```
/crabshell:load-memory
```

## Actions

Run the load-memory script (use full path from above):
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/load-memory.js" --project-dir="{PROJECT_DIR}"
```

This will output the current memory state to context:

1. **Hierarchical Memory** (if exists):
   - `project.md` - Project overview (per-prompt injected by inject-rules.js)

2. **L3 Summaries**:
   - JSON summaries of rotated memory archives

3. **Rolling Memory**:
   - Last 50 lines of `logbook.md`

## When to Use

- After manually editing memory files
- To refresh context if it seems stale
- To verify what memory is currently loaded

## Notes

- Memory is automatically loaded on session start
- This command reloads without restarting session
