---
description: Search through past session memories
allowed-tools: Bash, Read, Glob
---

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

Find the plugin path:
```bash
ls ~/.claude/plugins/cache/memory-keeper-marketplace/memory-keeper/*/scripts/counter.js
```

## Search Command

Search through project memory for: $ARGUMENTS

```bash
node "{PLUGIN_PATH}/scripts/counter.js" search-memory "$ARGUMENTS"
```

For deep search (includes L1 sessions):
```bash
node "{PLUGIN_PATH}/scripts/counter.js" search-memory "$ARGUMENTS" --deep
```

## Manual Search

1. Search memory.md:
   ```bash
   grep -i "$ARGUMENTS" .claude/memory/memory.md 2>/dev/null || echo "No matches in memory.md"
   ```

2. Search L3 summaries:
   ```bash
   grep -r -i "$ARGUMENTS" .claude/memory/*.summary.json 2>/dev/null || echo "No matches in summaries"
   ```

3. Search L1 sessions:
   ```bash
   grep -r -i "$ARGUMENTS" .claude/memory/sessions/*.l1.jsonl 2>/dev/null || echo "No matches in sessions"
   ```

Return matching excerpts with dates and context.
