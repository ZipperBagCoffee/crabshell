---
name: clear-memory
description: "Archives or clears old memory session files to manage storage. Use when memory files accumulate and need cleanup, compression, or archival. Invoke with /clear-memory."
---

## Paths

- `{NODE_PATH}`: the absolute path in your context's "Node.js Path" section; without one, use `node`.
- `{SCRIPTS_PATH}`: this skill's base directory without `/skills/clear-memory`, plus `/scripts/`. The scripts are in the plugin, not the project.
- `{PROJECT_DIR}`: the path after `Project root:` in the Project Root Anchor section; without one, use the current working directory.

# Clear Memory

Usage: `/crabshell:clear-memory [all|old]`

## Archive old files (recommended)

```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" compress --project-dir="{PROJECT_DIR}"
```

`compress` moves session files older than 30 days into monthly archives and deletes nothing:
```
sessions/2025-10-15_0300.md -> sessions/archive/2025-10.md
```
Archived files stay readable in `sessions/archive/`. Run `compress` monthly.

## Clear everything (manual)

**WARNING: Destructive operation.** Before major changes, back up first.

```bash
# Remove all session files (use Node to avoid sensitive file permission prompts)
"{NODE_PATH}" -e "const fs=require('fs'),p=require('path'),d='{PROJECT_DIR}/.crabshell/memory/sessions';fs.readdirSync(d).filter(f=>f.endsWith('.md')||f.endsWith('.jsonl')).forEach(f=>fs.unlinkSync(p.join(d,f)));console.log('sessions cleared')"

# Optionally clear logbook.md
"{NODE_PATH}" -e "try{require('fs').unlinkSync('{PROJECT_DIR}/.crabshell/memory/logbook.md');console.log('logbook.md deleted')}catch(e){console.log('not found')}"
```
