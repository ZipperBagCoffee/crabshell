---
name: clear-memory
description: Clean up old memory files
---

## Node.js Path
Use the Node.js absolute path from your context's "Node.js Path" section (injected by the plugin on every prompt).
If not available in context, fall back to `node`.

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

From "Base directory for this skill:" above, derive the scripts path:
- Remove `/skills/clear-memory` from the end
- Add `/scripts/` to get the scripts directory

Example:
- Base: `~/.claude/plugins/cache/memory-keeper-marketplace/memory-keeper/13.8.3/skills/clear-memory`
- Scripts: `~/.claude/plugins/cache/memory-keeper-marketplace/memory-keeper/13.8.3/scripts/`

Use this full path when running node commands below.

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

# Clear Memory

Clean up old session files.

## Usage

```
/memory-keeper:clear-memory [all|old]
```

## Actions

### Archive old files (recommended):
Use full path from above:
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" compress --project-dir="{PROJECT_DIR}"
```

This archives session files older than 30 days into monthly archives:
```
sessions/2025-10-15_0300.md -> sessions/archive/2025-10.md
```

### Clear everything (manual):

**WARNING: Destructive operation**

```bash
# Remove all session files
rm -rf "{PROJECT_DIR}/.claude/memory/sessions/"*.md
rm -rf "{PROJECT_DIR}/.claude/memory/sessions/"*.jsonl

# Optionally clear memory.md
rm "{PROJECT_DIR}/.claude/memory/memory.md"
```

## Recommendations

1. **Regular maintenance**: Run `compress` monthly
2. **Before major changes**: Create backup first

## Notes

- `compress` is non-destructive (archives, doesn't delete)
- Archived files can be manually reviewed in `sessions/archive/`
