---
name: save-memory
description: Save an explicit Codex session note to Crabshell memory. Use when the user asks to remember, save context, or persist decisions.
---

# Save Memory

Summarize only durable context: decisions, changed files, unresolved issues, verification results, and user preferences. Then run:

```bash
node scripts/codex-memory.js save --title="Codex session note" --message="..."
```

For longer notes, pipe the note on stdin:

```bash
node scripts/codex-memory.js save --title="Codex session note"
```

The script appends to `.crabshell/memory/logbook.md` and resets the Crabshell counter.
