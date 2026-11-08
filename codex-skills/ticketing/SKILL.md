---
name: ticketing
description: Create a Crabshell T ticket document from Codex. Use for session-sized executable work tied to a discussion.
---

# Ticketing

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root. Run the bundled script
by its absolute path with that project as the explicit target:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" ticket "ticket title" --intent="..." --context="..." --details="..." --ac="- Acceptance criterion" --parent="D001" --project-dir="{PROJECT_ROOT}"
```

A discussion `--parent` such as `D001` makes the ticket ID `D001_T001`. A ticket of an existing plan takes `--parent="P001"` or the older `--plan` and gets `P001_T001`.

A ticket under a discussion needs the discussion's `## Plan` first. The command refuses a discussion with no plan, no `**Reader Structure:**` line, or empty design lines: **Values:**, **Structure:**, **Start state:**, **User burden:**, **Design review:**. `none: <reason>` counts as filled. It also needs `--details` with this ticket's part of the plan: each file → function/section → what changes, specific enough to build from the ticket alone.

After the last edit, run the project's checks once (`node .crabshell/verification/run-verify.js --changed` or the project's equivalent) and record the command and result. Later steps read that result instead of running the checks again.

Before setting the ticket to verified, fill:
- `## Reader Check`: who tried the result, or "not confirmed"; how a correction spread, or "none".
- `## Intent Fidelity`: one row per Intent Anchor item and Plan decision the ticket touches, as `| Discussion item (IA-n / Plan decision) | Result | Deviation (none/partial/departed) | Evidence | Reason / user approval |`. A departure without the user's approval means the ticket is not verified.

Keep each ticket small enough to complete and verify in one session.
