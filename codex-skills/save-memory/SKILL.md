---
name: save-memory
description: Save an explicit Codex session note to Crabshell memory. Use when the user asks to remember, save context, or persist decisions.
---

# Save Memory

Summarize only durable context: decisions, changed files, unresolved issues, verification results and user preferences.
`{SKILL_DIR}` is the folder holding this `SKILL.md`; `{PROJECT_ROOT}` is the active project root. Run:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" save --title="Codex session note" --message="..." --project-dir="{PROJECT_ROOT}"
```

For a longer note, pipe it on stdin:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" save --title="Codex session note" --project-dir="{PROJECT_ROOT}"
```

The script appends to `.crabshell/memory/logbook.md` and resets the Crabshell counter.
If it reports that memory is busy (exit 1, nothing written), run the same command again. Do not report the note as saved.
