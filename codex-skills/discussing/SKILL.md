---
name: discussing
description: Create a Crabshell D discussion document from Codex. Use for design discussion, decisions, and intent anchors.
---

# Discussing

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root. Run the bundled script
by its absolute path with that project as the explicit target:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" discussion "topic" --intent="..." --context="..." --how="..." --reader="..." --values="..." --structure="..." --start-state="..." --user-burden="..." --design-review="..." --project-dir="{PROJECT_ROOT}"
```

A D document records intent, open questions, tradeoffs, decisions and, before any ticket, how the work will be built.

- `--how` fills `## Plan`: approach, each file → what changes, order, rejected alternatives and why, risks, the evidence inspected, an intent check against the Intent Anchor, and the user's confirmation.
- `--reader` writes `**Reader Structure:**`: what a person will do and every visible text (use the structuring skill), or `none: <reason>`.
- `--values`, `--structure`, `--start-state`, `--user-burden` and `--design-review` write the design lines the ticket command requires. `none: <reason>` counts where a line does not apply.
  - **Values:** every name, list and number put into code, and its source.
  - **Structure:** which modules and functions change, with no special case or second copy.
  - **Start state:** an existing user's project the day after the update.
  - **User burden:** what the user has to do.
  - **Design review:** a reviewer of the same or higher tier who did not write the plan reads only the plan and records findings → fixes.

Without `--how`, `## Plan` starts as a placeholder; fill it. The ticket command refuses a discussion with no plan. After the design review, show the plan to the user and get their confirmation before creating tickets. The plan may be revised until the first ticket exists; later changes are `Plan revision` log entries. Tickets name the discussion as parent (`--parent="D001"`, IDs such as `D001_T001`).
