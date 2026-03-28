---
description: Clear old session memories (keeps recent ones)
allowed-tools: Bash
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

## Options

Based on $ARGUMENTS:
- "old": Compress old sessions (30+ days) - default
- "all": Delete ALL session files (ask for confirmation first)

## Commands

For "old" option (compress 30+ day files):
```bash
"{NODE_PATH}" "{PLUGIN_PATH}/scripts/counter.js" compress
```

For "all" option (DESTRUCTIVE - ask confirmation first):
```bash
rm -rf .crabshell/memory/sessions/*.l1.jsonl
```

Show what will be deleted and ask for confirmation before proceeding.
