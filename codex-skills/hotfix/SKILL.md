---
name: hotfix
description: Record directly-performed one-pass work as a discussion with one ticket (Crabshell no longer creates H hotfix documents).
---

# Hotfix

One-pass work is recorded as a discussion with one ticket. After applying and verifying the change, create both:

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root.

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" discussion "what changed" --intent="..." --context="..." --project-dir="{PROJECT_ROOT}"
node "{SKILL_DIR}/scripts/codex-docs.js" ticket "what changed" --parent="D001" --ac="- ..." --project-dir="{PROJECT_ROOT}"
```

Use the discussion ID the first command printed as `--parent` (D001 in a new project). Write the problem, the fix and its verification into the ticket, set the ticket to `verified` and the discussion to `concluded`. Existing H documents stay readable and searchable; append to their Log sections if work continues on them.
