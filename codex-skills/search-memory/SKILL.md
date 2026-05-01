---
name: search-memory
description: Search Crabshell memory and archived session context. Use when the user asks what happened before or asks to find prior decisions.
---

# Search Memory

Run:

```bash
node scripts/codex-memory.js search "query"
```

For detailed L1 session search:

```bash
node scripts/codex-memory.js search "query" --deep
```

Report matches with source names and line numbers when present. If there are no matches, say that the memory search found no matches.
