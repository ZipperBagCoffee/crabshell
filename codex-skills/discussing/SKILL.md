---
name: discussing
description: Create a Crabshell D discussion document from Codex. Use for design discussion, decisions, and intent anchors.
---

# Discussing

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root. Run the bundled script
by its absolute path with that project as the explicit target:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" discussion "topic" --intent="..." --context="..." --how="..." --project-dir="{PROJECT_ROOT}"
```

Use D documents to capture intent, open questions, tradeoffs, decisions and — before any ticket — how the work will be built. `--how` fills the `## Plan` section: approach, each file → what changes, order, rejected alternatives and why, risks, the evidence inspected, an intent check against the Intent Anchor, and the user's confirmation. Without `--how` the section starts as a placeholder; fill it (it may be revised until the first ticket exists, later changes are `Plan revision` log entries) and get the user's confirmation before creating tickets — the ticket command refuses a discussion with no plan. Tickets name the discussion as their parent (`--parent="D001"`, IDs such as `D001_T001`).
