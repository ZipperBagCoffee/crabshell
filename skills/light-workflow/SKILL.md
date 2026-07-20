---
name: light-workflow
description: "Run a traceable one-pass task with an internal task contract, optional risk-based delegation, parent-owned behavioral verification, and a W worklog. Use for a stable standalone task; use regressing when evidence is expected to change the plan across iterations."
---

# Light Workflow

Use one five-stage flow:

`Understand internally -> Inspect -> Implement -> Verify behavior -> Report`

The W document is the durable workflow state. User-facing replies are natural summaries, not copies of the internal contract or role names.

## Start the W document

Before implementation, create `.crabshell/worklog/WNNN-*.md` and its index entry with the project document engine when available:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-docs.js" worklog "task title" --project-dir="${CLAUDE_PROJECT_DIR}"
```

Complete the W document's internal task contract before changing product files:

- `original_request`
- `required_outcomes`
- `non_goals`
- `named_references`
- `allowed_changes`
- `forbidden_side_effects`
- `observable_success`
- `blocking_unknowns`

Do not print these fields in every response. If `blocking_unknowns` is empty, inspect the repository and proceed. Ask only when a wrong choice would require a destructive or irreversible action, a write outside the authorized workspace, an external installation, or an undiscoverable product decision.

If an existing discussion governs the task, use its D/P/T regressing workflow instead of creating a separate W document. Choose by iteration need and decision risk, never by file, token, agent, or reviewer counts.

## Stage 1 - Understand internally

- Build the task contract from the user's actual words. A correction overrides an earlier inference while unaffected constraints remain.
- Separate required behavior from values that merely appear in an example.
- Preserve every stated quantity, named reference, non-goal, and forbidden side effect.
- Write the concrete contract to the W document before reporting progress.

## Stage 2 - Inspect

- Open every named authoritative reference before implementation.
- Trace `source input -> consuming path -> observable result`.
- Inspect connected callers, current tests, project conventions, and the diff baseline.
- Use read-only exploration by default. Repository evidence should settle normal implementation choices without a user question.

## Stage 3 - Implement

The parent may implement directly. Delegate only when a bounded independent unit or a distinct high-risk concern makes delegation useful.

Every worker prompt must include:

- the relevant original-request sentence;
- exact task and non-goal;
- authoritative references to open;
- allowed read/write scope;
- expected observable result;
- direct verification to run;
- a short `claim / evidence / gap` return contract.

Exploration and review are read-only unless the prompt explicitly grants a write scope. Workers do not fan out. Do not require a Work Agent/Review Agent pair, repeat the same checklist across reviewers, or use agent count as progress evidence. When multiple reviewers are useful, give each a different risk such as security, shared-contract compatibility, data loss, or user-visible behavior.

## Stage 4 - Verify behavior

For every observable success condition:

1. Predict the result before executing the check.
2. Run the most direct practical user surface.
3. Record the actual output and compare it with the prediction.
4. Inspect the final diff for unintended changes and connected regressions.

The parent must personally reopen decisive named references, inspect the final diff, and rerun or directly inspect the decisive execution output. A worker's `done`, a reviewer's `PASS`, a reviewer count, a marker, or a spot-check is not a completion condition.

If evidence fails, keep the confirmed work, update the W experiment log, and repair only the failed scope unless the failure invalidates the plan. Use regressing when repeated evidence changes the intended approach.

## Stage 5 - Report

Complete these W sections before the final response:

- Task Contract
- Problem
- Approach
- Files Changed
- Verification, with prediction/observation/gap/result
- Experiment Log
- User Testing Needed
- Result

Then change the W and index status to `done` only when every required outcome has decisive evidence and no blocking unknown remains.

Report naturally in this order:

1. conclusion;
2. actual changes or observations;
3. decisive evidence;
4. remaining limitation, only if one exists.

Do not require `[의도]`, `[이해]`, `[설명]`, IA/WA/RA/UVLS, a phase transcript, or caveman-style fragments in user-facing output. A short task normally needs only a few natural sentences plus any verification table required by project rules.
