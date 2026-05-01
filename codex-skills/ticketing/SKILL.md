---
name: ticketing
description: Create a Crabshell T ticket document from Codex. Use for session-sized executable work tied to a plan.
---

# Ticketing

Run:

```bash
node scripts/codex-docs.js ticket "ticket title" --intent="..." --context="..." --ac="- Acceptance criterion" --plan="[[P001-topic|P001]]"
```

The `--plan` value is used to create the native Crabshell ticket ID format, such as `P001_T001`.

Keep tickets small enough to complete and verify in one session.
