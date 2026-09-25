---
name: save-memory
description: "Manually saves the current session context to memory files on demand. Use when explicitly asked to save progress, or when important decisions need to be preserved immediately rather than waiting for auto-save. Invoke with /save-memory. Not for routine saves — memory-autosave handles those automatically via triggers."
---

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

# Save Memory

Force immediate save of session memory.

## Usage

```
/crabshell:save-memory
```

## Actions

1. **Save to logbook.md** through append-memory.js — it takes the memory locks and writes the `## UTC (local …)` header, so never append to logbook.md directly:
   - Use the Write tool to save the session summary to `{PROJECT_DIR}/.crabshell/memory/manual-summary-{YYYYMMDD-HHMMSS}.txt` (a new name each time, so concurrent sessions do not overwrite each other).
   - Run (the scripts folder is the plugin's `scripts/`, next to this skill's `skills/` folder):
   ```bash
   "{NODE_PATH}" "{SCRIPTS_PATH}/append-memory.js" --project-dir="{PROJECT_DIR}" --summary-file="{PROJECT_DIR}/.crabshell/memory/manual-summary-{YYYYMMDD-HHMMSS}.txt"
   ```
   - If it fails with `A prepared delta job exists`, run the memory-delta skill first (it finalizes that pending summary), then run the command again.

## Notes

- Uses same format as auto-save
- Does NOT reset counter (auto-save will still trigger normally)
- Use when you want to checkpoint progress mid-session
