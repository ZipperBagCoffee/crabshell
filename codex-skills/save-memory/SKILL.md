---
name: save-memory
description: Save an explicit Codex session note to Crabshell memory. Use when the user asks to remember, save context, or persist decisions.
---

# Save Memory

Summarize only durable context: decisions, changed files, unresolved issues,
verification results, and user preferences. Resolve `{SKILL_DIR}` to the
directory containing this `SKILL.md` and `{PROJECT_ROOT}` to the active project
root, then run:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" save --title="Codex session note" --message="..." --project-dir="{PROJECT_ROOT}"
```

For longer notes, pipe the note on stdin:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" save --title="Codex session note" --project-dir="{PROJECT_ROOT}"
```

The script appends to `.crabshell/memory/logbook.md` and resets the Crabshell counter.
