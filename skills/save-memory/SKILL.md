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
/memory-keeper:save-memory
```

## Actions

1. **Save to memory.md:**
```bash
"{NODE_PATH}" -e "const fs=require('fs');const d=new Date();const p=n=>String(n).padStart(2,'0');const ts=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes());fs.appendFileSync('{PROJECT_DIR}/.claude/memory/memory.md','\\n## '+ts+'\\n'+'[Summary of current session progress]'+'\\n')"
```

2. **Create session file:**
```bash
"{NODE_PATH}" -e "const fs=require('fs');const path=require('path');const d=new Date();const p=n=>String(n).padStart(2,'0');const ts=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes());const dir='{PROJECT_DIR}/.claude/memory/sessions';if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,ts+'.md'),'# Session '+ts+'\\n\\n## Summary\\n[What has been accomplished so far]\\n\\n## Decisions\\n- [type] Decision: Reason\\n  - files: affected files\\n  - concepts: relevant concepts\\n\\n## Patterns\\n- [type] Pattern observed\\n  - concepts: tags\\n\\n## Issues\\n- [type] Issue: open|resolved\\n  - files: affected files\\n')"
```

## Notes

- Uses same format as auto-save
- Does NOT reset counter (auto-save will still trigger normally)
- Use when you want to checkpoint progress mid-session
