---
name: regressing
description: Run a Codex-compatible D/P/T iterative improvement workflow. Use when the task needs repeated plan-execute-verify cycles rather than a one-shot worklog.
---

# Regressing

Codex does not have Claude's automatic regressing hooks, so run this as an explicit document workflow:

1. Create one D document for the overall intent:

```bash
node scripts/codex-docs.js discussion "topic" --intent="..." --context="Regressing session"
```

2. For each cycle, create a P document for the current improvement target:

```bash
node scripts/codex-docs.js plan "cycle 1 plan" --related="[[D001-topic|D001]]"
```

3. Create one or more T documents for executable work:

```bash
node scripts/codex-docs.js ticket "ticket title" --plan="[[P001-topic|P001]]"
```

4. Execute, verify, then write the verification gaps and next direction back into the ticket or plan before starting another cycle.

Do not pre-partition future cycles. Each cycle should respond to the previous cycle's verification results.
