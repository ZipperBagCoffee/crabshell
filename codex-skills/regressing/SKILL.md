---
name: regressing
description: Run a Codex-compatible D-T iterative improvement workflow (the discussion carries each cycle's plan). Use when the task needs repeated plan-execute-verify cycles rather than a one-shot worklog.
---

# Regressing

Codex does not have Claude's automatic regressing hooks, so run this as an explicit document workflow:

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the absolute active project root. Run each bundled command
by its absolute path with that project as the explicit target.

1. Create one D document for the overall intent:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" discussion "topic" --intent="..." --context="Regressing session" --project-dir="{PROJECT_ROOT}"
```

Then add a `## Convergence Criteria` section to the D document. Every item must be objectively checkable by reading project documents or running a command (document status, command exit code, numeric threshold) — subjective wording ("no new issues found") is invalid.

1b. Print this ready-to-paste goal-mode line for the user (Codex CLI 0.128.0+; fill in the real D file and cap):

```
/goal Crabshell regressing {D-ID}: every item under "## Convergence Criteria" in .crabshell/discussion/{D-file}.md is met and its frontmatter status is "concluded", or the D Final Report records the cycle cap {N} as reached. Judge only by reading that document.
```

Goal mode keeps Codex looping plan-execute-verify cycles until its evaluator confirms the D is concluded. Starting it is the user's choice; without it, continue cycles manually per step 4. Because the evaluator judges only by reading the D document, write each cycle's results into the documents before ending a cycle.

2. For each cycle, append a "Cycle N plan" entry to the D document's log with the same fields as a discussion's `## Plan`: context from the previous cycle, approach, each file → what changes, order, rejected alternatives and why, risks, the evidence you inspected, and an intent check against the Intent Anchor (approve or reject). There is no separate plan document.

3. Create one or more tickets under the discussion:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" ticket "ticket title" --parent="D001" --details="this ticket's part of the cycle plan" --project-dir="{PROJECT_ROOT}"
```

Ticket IDs continue within the discussion (`D001_T001`, `D001_T002`, …) across cycles; the D log's cycle entries record which tickets belong to which cycle.

4. Execute, verify, then compare the result with the discussion: fill each ticket's `## Intent Fidelity` table (one row per Intent Anchor item and cycle-plan decision it touches — result, deviation none/partial/departed, evidence, reason or user approval). A ticket can pass its own checks and still drift from the discussion; a departure without the user's approval keeps it from verified. Write the verification gaps, every partial or departed row, and the next direction into the ticket and into the next cycle's plan entry in the D log before starting another cycle.

Do not pre-partition future cycles. Each cycle should respond to the previous cycle's verification results.
