---
name: load-memory
description: "Loads full hierarchical memory context including project info, L3 summaries, and rolling memory. Use after session restart, context compaction, or when memory context feels incomplete or stale. Invoke with /load-memory."
---

## Paths

- `{NODE_PATH}`: the absolute path in your context's "Node.js Path" section; without one, use `node`.
- `{SCRIPTS_PATH}`: this skill's base directory without `/skills/load-memory`, plus `/scripts/`. The scripts are in the plugin, not the project.
- `{PROJECT_DIR}`: the path after `Project root:` in the Project Root Anchor section; without one, use the current working directory.

# Load Memory

Usage: `/crabshell:load-memory`

Run:
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/load-memory.js" --project-dir="{PROJECT_DIR}"
```

It prints `project.md` if it exists, the L3 JSON summaries of rotated memory archives, and the last 50 lines of `logbook.md`.

Memory loads by itself at session start; this reloads it without a restart. Use it after editing memory files by hand, when context seems stale, or to verify what memory is currently loaded.
