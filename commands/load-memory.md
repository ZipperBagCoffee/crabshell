---
description: Load and summarize recent session memories
allowed-tools: Bash, Read, Glob
---

Read session files from .claude/memory/

1. Read memory.md for rolling summary:
   ```bash
   cat .claude/memory/memory.md
   ```

2. List L3 summaries:
   ```bash
   ls -lt .claude/memory/*.summary.json 2>/dev/null | head -5
   ```

3. List recent L1 sessions:
   ```bash
   ls -lt .claude/memory/sessions/*.l1.jsonl 2>/dev/null | head -5
   ```

Provide a brief context restoration - summarize what was worked on, pending TODOs, key decisions.
