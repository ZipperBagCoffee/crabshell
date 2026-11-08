---
name: knowledge
description: Create a Crabshell K knowledge page from Codex. Use for verified facts and operational tips discovered through project work.
---

# Knowledge

`{SKILL_DIR}` is the folder holding this `SKILL.md`; `{PROJECT_ROOT}` is the absolute active project root.
Run the bundled script by its absolute path, with that project as the explicit target:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" knowledge "title" --category="fact|tip" --what="..." --when="..." --source="..." --tags="tag1,tag2" --project-dir="{PROJECT_ROOT}"
```

The script creates `.crabshell/knowledge/K{NNN}-*.md` and appends to `.crabshell/knowledge/INDEX.md`.
Defaults: `category=fact`, `source=observation`, `what`/`when`=`TBD.` if omitted.

K-pages are append-only. Never edit an existing K-page; create a new one when a fact has changed.

Before creating a K-page, check that its "What" is a fact about how something behaves; that belongs in knowledge/. A behavioral rule for the assistant belongs in CLAUDE.md.
If it overlaps with the rule keywords (scope, verification, understanding, sycophancy, pressure, guard, hook, bailout, prohibited), confirm with the user before going on.
