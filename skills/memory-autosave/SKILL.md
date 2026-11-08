---
name: memory-autosave
description: "Auto-executes when the [CRABSHELL_SAVE] trigger is detected in hook output. Saves session memory following a numbered step sequence. Not user-invocable — triggered automatically by the plugin system."
user-invocable: false
---

## Paths

- `{NODE_PATH}`: the absolute path in your context's "Node.js Path" section; without one, use `node`.
- `{SCRIPTS_PATH}`: this skill's base directory without `/skills/memory-autosave`, plus `/scripts/`. The scripts are in the plugin, not the project.
- `{PROJECT_DIR}`: the path after `Project root:` in the Project Root Anchor section; without one, use the current working directory.

# Memory Save

## Trigger Message

Run this when `[CRABSHELL_SAVE]` appears in conversation. Do not skip the logbook.md append.

1. Write a 1-2 sentence session summary with the Write tool to `{PROJECT_DIR}/.crabshell/memory/autosave-summary-{YYYYMMDD-HHMMSS}.txt`. Use a new name each time.
2. Append it with append-memory.js:
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/append-memory.js" --project-dir="{PROJECT_DIR}" --summary-file="{PROJECT_DIR}/.crabshell/memory/autosave-summary-{YYYYMMDD-HHMMSS}.txt"
```
   Never append to logbook.md directly; append-memory.js takes the memory locks and writes the `## UTC (local …)` header.
3. If it fails with `A prepared delta job exists`, run the memory-delta skill first, then run the command again.
   If `append-memory.js` cannot run at all, leave the summary file in place and report that the save did not happen.

The counter resets on its own; no manual reset is needed.

## Session end (Stop hook)

Also run:
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" compress --project-dir="{PROJECT_DIR}"
```

## Optional: update project.md

If the project's scope, goals or tech stack changed, update `project.md`:
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" memory-set project "Updated project description..." --project-dir="{PROJECT_DIR}"
```

View current memory:
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" memory-list --project-dir="{PROJECT_DIR}"
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" memory-get project --project-dir="{PROJECT_DIR}"
```
