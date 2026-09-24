---
name: discussing
description: Create a Crabshell D discussion document from Codex. Use for design discussion, decisions, and intent anchors.
---

# Discussing

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root. Run the bundled script
by its absolute path with that project as the explicit target:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" discussion "topic" --intent="..." --context="..." --project-dir="{PROJECT_ROOT}"
```

Use D documents to capture intent, open questions, tradeoffs, decisions and the plan (as log entries) before tickets. Tickets name the discussion as their parent (`--parent="D001"`, IDs such as `D001_T001`).
