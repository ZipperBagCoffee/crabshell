---
name: memory-save
description: Execute when you see "[MEMORY_KEEPER]" in hook output. Follow the numbered steps exactly to save session memory.
---

## Node.js Path
Use the Node.js absolute path from your context's "Node.js Path" section (injected by the plugin on every prompt).
If not available in context, fall back to `node`.

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

From "Base directory for this skill:" above, derive the scripts path:
- Remove `/skills/memory-save` from the end
- Add `/scripts/` to get the scripts directory

Example:
- Base: `~/.claude/plugins/cache/memory-keeper-marketplace/memory-keeper/13.8.3/skills/memory-save`
- Scripts: `~/.claude/plugins/cache/memory-keeper-marketplace/memory-keeper/13.8.3/scripts/`

Use this full path when running node commands below.

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

# Memory Save Skill (v13.1.0)

This skill activates when `[MEMORY_KEEPER]` appears in conversation.

## Memory Structure

```
.claude/memory/
  project.md        <- Project overview (stable)
  architecture.md   <- Architecture decisions (stable)
  conventions.md    <- Coding conventions (stable)
  memory.md         <- Rolling session log (last 50 lines loaded)
  sessions/         <- L1 session transcripts (auto-generated)
  logs/             <- Debug and error logs
```

## Trigger Message

```
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER] AUTO-SAVE TRIGGERED - N tool uses reached
═══════════════════════════════════════════════════════════════
```

## Required Actions

### Step 1: Save to memory.md
```bash
printf '\n## %s\n%s\n' "$(date +%Y-%m-%d_%H%M)" "[1-2 sentence summary]" >> "{PROJECT_DIR}/.claude/memory/memory.md"
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
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" memory-set architecture "Updated architecture..." --project-dir="{PROJECT_DIR}"
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" memory-set conventions "Updated conventions..." --project-dir="{PROJECT_DIR}"
```

**When to update:**
- `project.md`: New project scope, goals, or tech stack
- `architecture.md`: New architecture decisions or patterns
- `conventions.md`: New coding standards or workflows

**View current memory:**
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" memory-list --project-dir="{PROJECT_DIR}"
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" memory-get project --project-dir="{PROJECT_DIR}"
```

## Critical

- **DO NOT SKIP** the memory.md append step
- Counter resets automatically (no manual reset needed)

See [Architecture](../../docs/ARCHITECTURE.md) for full details.
