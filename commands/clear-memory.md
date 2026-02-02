---
description: Clear old session memories (keeps recent ones)
allowed-tools: Bash
---

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

Find the plugin path:
```bash
ls ~/.claude/plugins/cache/memory-keeper-marketplace/memory-keeper/*/scripts/counter.js
```

## Options

Based on $ARGUMENTS:
- "old": Compress old sessions (30+ days) - default
- "all": Delete ALL session files (ask for confirmation first)

## Commands

For "old" option (compress 30+ day files):
```bash
node "{PLUGIN_PATH}/scripts/counter.js" compress
```

For "all" option (DESTRUCTIVE - ask confirmation first):
```bash
rm -rf .claude/memory/sessions/*.l1.jsonl
```

Show what will be deleted and ask for confirmation before proceeding.
