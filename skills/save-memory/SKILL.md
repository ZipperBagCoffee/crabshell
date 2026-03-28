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

1. **Save to logbook.md:**
   Generate a timestamp and summary, then use the Write tool or the append-memory.js script:
   ```bash
   "{NODE_PATH}" -e "const fs=require('fs');const d=new Date();const p=n=>String(n).padStart(2,'0');const ts=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes());fs.appendFileSync('{PROJECT_DIR}/.crabshell/memory/logbook.md','\\n## '+ts+'\\n')"
   ```
   Then use the Read tool to read `{PROJECT_DIR}/.crabshell/memory/logbook.md`, append the session summary using the Edit tool.

## Notes

- Uses same format as auto-save
- Does NOT reset counter (auto-save will still trigger normally)
- Use when you want to checkpoint progress mid-session
