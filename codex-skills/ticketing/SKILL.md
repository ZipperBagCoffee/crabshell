---
name: ticketing
description: Create a Crabshell T ticket document from Codex. Use for session-sized executable work tied to a plan.
---

# Ticketing

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root. Run the bundled script
by its absolute path with that project as the explicit target:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" ticket "ticket title" --intent="..." --context="..." --ac="- Acceptance criterion" --plan="[[P001-topic|P001]]" --project-dir="{PROJECT_ROOT}"
```

The `--plan` value is used to create the native Crabshell ticket ID format, such as `P001_T001`.

Keep tickets small enough to complete and verify in one session.
