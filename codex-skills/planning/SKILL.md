---
name: planning
description: Create a Crabshell P plan document from Codex. Use when a task needs an implementation plan before tickets.
---

# Planning

Run:

```bash
node scripts/codex-docs.js plan "plan title" --intent="..." --context="..." --ac="- Acceptance criterion" --related="[[D001-topic|D001]]"
```

After creating the plan, edit the generated P document with concrete steps, acceptance criteria, and verification commands.
