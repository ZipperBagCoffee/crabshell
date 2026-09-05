---
name: planning
description: Create a Crabshell P plan document from Codex. Use when a task needs an implementation plan before tickets.
---

# Planning

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root. Run the bundled script
by its absolute path with that project as the explicit target:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" plan "plan title" --intent="..." --context="..." --ac="- Acceptance criterion" --related="[[D001-topic|D001]]" --project-dir="{PROJECT_ROOT}"
```

After creating the plan, edit the generated P document with concrete steps, acceptance criteria, and verification commands.
