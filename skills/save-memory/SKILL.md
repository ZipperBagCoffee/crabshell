---
name: save-memory
description: "Manually saves the current session context to memory files on demand. Use when explicitly asked to save progress, or when important decisions need to be preserved immediately rather than waiting for auto-save. Invoke with /save-memory. Not for routine saves — the memory-delta skill handles those when a hook notice asks for it."
---

## Paths

- `{NODE_PATH}`: the absolute path in your context's "Node.js Path" section; without one, use `node`.
- `{SCRIPTS_PATH}`: this skill's base directory without `/skills/save-memory`, plus `/scripts/`. The scripts are in the plugin, not the project.
- `{PROJECT_DIR}`: the path after `Project root:` in the Project Root Anchor section; without one, use the current working directory.

# Save Memory

Usage: `/crabshell:save-memory`

1. Write the session summary with the Write tool to `{PROJECT_DIR}/.crabshell/memory/manual-summary-{YYYYMMDD-HHMMSS}.txt`. Use a new name each time.
2. Append it with append-memory.js:
   ```bash
   "{NODE_PATH}" "{SCRIPTS_PATH}/append-memory.js" --project-dir="{PROJECT_DIR}" --summary-file="{PROJECT_DIR}/.crabshell/memory/manual-summary-{YYYYMMDD-HHMMSS}.txt"
   ```
   Never append to logbook.md directly; append-memory.js takes the memory locks and writes the `## UTC (local …)` header.
3. If it fails with `A prepared delta job exists`, run the memory-delta skill first, then run the command again.

Use it to checkpoint progress mid-session. This save does not reset the counter; the interval save still runs.
