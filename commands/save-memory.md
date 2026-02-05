---
description: Manually save current session context to memory
allowed-tools: Bash, Read, Write
---

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

Find the plugin path:
```bash
ls ~/.claude/plugins/cache/memory-keeper-marketplace/memory-keeper/*/scripts/counter.js
```

Use the full path when running node commands.

## Quick Save

Trigger auto-save:
```bash
node "{PLUGIN_PATH}/scripts/counter.js" check
```

## Manual Save

Append directly to memory.md (works from any project):
```bash
TS_UTC=$(date -u +%Y-%m-%d_%H%M) && TS_LOCAL=$(date +%m-%d_%H%M) && printf '\n## %s (local %s)\n%s\n' "$TS_UTC" "$TS_LOCAL" "[Your summary here]" >> .claude/memory/memory.md
```

## What to Record

- What was accomplished
- Key decisions made
- Issues found/resolved
- Files changed
