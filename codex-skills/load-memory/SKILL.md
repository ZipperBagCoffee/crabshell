---
name: load-memory
description: Load Crabshell project memory into the current Codex conversation. Use when the user asks to load memory, resume context, or inspect saved project notes.
---

# Load Memory

Run from the project root:

```bash
node scripts/codex-memory.js load
```

Read the output and use it as project context. Do not claim the memory was loaded unless the command produced the relevant memory text or explicitly reported that no memory exists.

Useful options:

```bash
node scripts/codex-memory.js load --tail-lines=120
node scripts/codex-memory.js status
```
