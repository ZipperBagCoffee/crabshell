---
name: memory-autosave
description: "Auto-executes when the [MEMORY_KEEPER_SAVE] trigger is detected in hook output. Saves session memory following a numbered step sequence. Not user-invocable — triggered automatically by the plugin system."
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

This skill activates when `[MEMORY_KEEPER_SAVE]` appears in conversation.

## Memory Structure

```
.claude/memory/
  project.md        <- Project overview (per-prompt injected)
  memory.md         <- Rolling session log (last 50 lines loaded)
  sessions/         <- L1 session transcripts (auto-generated)
  logs/             <- Debug and error logs
```

## Trigger Message

```
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER_SAVE] AUTO-SAVE TRIGGERED - N tool uses reached
═══════════════════════════════════════════════════════════════
```

## Required Actions

### Step 1: Save to memory.md
```bash
"{NODE_PATH}" -e "const fs=require('fs');const d=new Date();const p=n=>String(n).padStart(2,'0');const ts=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes());fs.appendFileSync('{PROJECT_DIR}/.claude/memory/memory.md','\\n## '+ts+'\\n'+'[1-2 sentence summary]'+'\\n')"
```

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

- **DO NOT SKIP** the memory.md append step
- Counter resets automatically (no manual reset needed)

See [Architecture](../../docs/ARCHITECTURE.md) for full details.
