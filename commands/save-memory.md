---
description: Manually save current session context to memory
allowed-tools: Bash, Read, Write
---

## Node.js Path
Use the Node.js absolute path from your context's "Node.js Path" section (injected by the plugin on every prompt).
If not available in context, fall back to `node`.

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

Find the plugin path:
```bash
ls ~/.claude/plugins/cache/crabshell-marketplace/crabshell/*/scripts/counter.js
```

Use the full path when running node commands.

## Quick Save

Trigger auto-save:
```bash
"{NODE_PATH}" "{PLUGIN_PATH}/scripts/counter.js" check
```

## Manual Save

Append directly to logbook.md (works from any project):
```bash
TS_UTC=$(date -u +%Y-%m-%d_%H%M) && TS_LOCAL=$(date +%m-%d_%H%M) && printf '\n## %s (local %s)\n%s\n' "$TS_UTC" "$TS_LOCAL" "[Your summary here]" >> .crabshell/memory/logbook.md
```

## What to Record

- What was accomplished
- Key decisions made
- Issues found/resolved
- Files changed
