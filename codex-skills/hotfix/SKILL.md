---
name: hotfix
description: One-pass work goes through a discussion whose Plan the user confirms, then one ticket, then the change (Crabshell no longer creates H hotfix documents).
---

# Hotfix

One-pass work goes through a discussion with one ticket: plan first, then build. Do not change files before both documents exist.

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root.

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" discussion "what to fix" --intent="..." --context="..." --how="file → what changes; risk and how it is checked" --project-dir="{PROJECT_ROOT}"
node "{SKILL_DIR}/scripts/codex-docs.js" ticket "what to fix" --parent="D001" --details="..." --ac="- ..." --project-dir="{PROJECT_ROOT}"
```

Before the ticket, show the plan to the user and record their confirmation; for a one-line fix, one sentence is enough. Use the discussion ID the first command printed as `--parent`; in a new project it is D001. Then apply and verify the change. Write the verification and the Intent Fidelity row (the fix against the problem and the plan) into the ticket. Set the ticket to `verified` and the discussion to `concluded`. Existing H documents stay readable and searchable; append to their Log when work continues on them.
