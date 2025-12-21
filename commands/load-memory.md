---
description: Load and summarize recent session memories
allowed-tools: Bash, Read, Glob
---

Read session files from .claude/memory/

1. Read memory.md for rolling summary:
   ```bash
   cat .claude/memory/memory.md
   ```

2. Read facts.json for structured data:
   ```bash
   cat .claude/memory/facts.json
   ```

3. List recent sessions:
   ```bash
   ls -lt .claude/memory/sessions/*.md 2>/dev/null | head -5
   ```

Provide a brief context restoration - summarize what was worked on, pending TODOs, key decisions.
