---
name: knowledge
description: Create a Crabshell K knowledge page from Codex. Use for verified facts and operational tips discovered through project work.
---

# Knowledge

Run:

```bash
node scripts/codex-docs.js knowledge "title" --category="fact|tip" --what="..." --when="..." --source="..." --tags="tag1,tag2"
```

The script creates `.crabshell/knowledge/K{NNN}-*.md` and appends to `.crabshell/knowledge/INDEX.md`.

K-pages are append-only: do not edit existing K-pages — create a new one if a fact has changed. Defaults: `category=fact`, `source=observation`, `what`/`when`=`TBD.` if omitted.

Before creating a K-page, check that the "What" content is a fact about how something behaves (belongs in knowledge/) rather than a behavioral rule for the assistant (belongs in CLAUDE.md). If it overlaps with rule keywords (scope, verification, understanding, sycophancy, pressure, guard, hook, bailout, prohibited), confirm with the user before proceeding.
