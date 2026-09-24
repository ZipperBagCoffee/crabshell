---
name: planning
description: Crabshell no longer creates separate plan documents. Use when asked to plan work — the plan goes into the discussion, then tickets.
---

# Planning

New plans go into the discussion: append a plan entry (intent, scope, steps, the evidence inspected, an intent check) to the D document's log, then create tickets with `--parent` naming that discussion (see the ticketing skill).

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root. If no discussion exists yet, create one:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" discussion "topic" --intent="..." --context="..." --project-dir="{PROJECT_ROOT}"
```

Existing P documents stay readable and searchable; append to their Log sections when work continues on them.
