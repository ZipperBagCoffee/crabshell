---
description: Search through past session memories
allowed-tools: Bash, Read, Glob
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

## Search Command

Search through project memory for: $ARGUMENTS

```bash
"{NODE_PATH}" "{PLUGIN_PATH}/scripts/counter.js" search-memory "$ARGUMENTS"
```

For deep search (includes L1 sessions):
```bash
"{NODE_PATH}" "{PLUGIN_PATH}/scripts/counter.js" search-memory "$ARGUMENTS" --deep
```

## Manual Search

1. Search logbook.md:
   ```bash
   grep -i "$ARGUMENTS" .crabshell/memory/logbook.md 2>/dev/null || echo "No matches in logbook.md"
   ```

2. Search L3 summaries:
   ```bash
   grep -r -i "$ARGUMENTS" .crabshell/memory/*.summary.json 2>/dev/null || echo "No matches in summaries"
   ```

3. Search L1 sessions:
   ```bash
   grep -r -i "$ARGUMENTS" .crabshell/memory/sessions/*.l1.jsonl 2>/dev/null || echo "No matches in sessions"
   ```

Return matching excerpts with dates and context.
