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

Then add a `## Convergence Criteria` section to the D document. Every item must be objectively checkable by reading project documents or running a command (document status, command exit code, numeric threshold) — subjective wording ("no new issues found") is invalid.

1b. Print this ready-to-paste goal-mode line for the user (Codex CLI 0.128.0+; fill in the real D file and cap):

```
/goal Crabshell regressing {D-ID}: every item under "## Convergence Criteria" in .crabshell/discussion/{D-file}.md is met and its frontmatter status is "concluded", or the D Final Report records the cycle cap {N} as reached. Judge only by reading that document.
```

Goal mode keeps Codex looping plan-execute-verify cycles until its evaluator confirms the D is concluded. Starting it is the user's choice; without it, continue cycles manually per step 4. Because the evaluator judges only by reading the D document, write each cycle's results into the documents before ending a cycle.

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
