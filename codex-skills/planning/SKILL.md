---
name: planning
description: Crabshell no longer creates separate plan documents. Use when asked to plan work — the plan goes into the discussion's Plan section, the user confirms it, then tickets.
---

# Planning

New plans go into the discussion's `## Plan` section (pass it with `--how` when creating the discussion): approach, each file → what changes, order, rejected alternatives and why, risks, the evidence inspected, an intent check against the Intent Anchor, and the user's confirmation. Then create tickets with `--parent` naming that discussion and `--details` carrying each ticket's part of the plan (see the ticketing skill).

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root. If no discussion exists yet, create one:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" discussion "topic" --intent="..." --context="..." --how="..." --project-dir="{PROJECT_ROOT}"
```

Existing P documents stay readable and searchable; append to their Log sections when work continues on them.
