---
name: hotfix
description: Record directly-performed work in a Crabshell H hotfix document. Use for any task done in one pass that does not need a D/P/T workflow.
---

# Hotfix

After applying and verifying a direct fix or small task, create the hotfix record.
Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root. Run the bundled script
by its absolute path with that project as the explicit target:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" hotfix "title" --problem="..." --fix="..." --verification="..." --project-dir="{PROJECT_ROOT}"
```

The script creates `.crabshell/hotfix/HNNN-*.md` and appends to `.crabshell/hotfix/INDEX.md`.
