---
name: light-workflow
description: Run a traceable one-pass Codex task with an internal task contract, optional risk-based delegation, parent-owned behavioral verification, and a Crabshell W worklog.
---

# Light Workflow

Use this five-stage flow:

`Understand internally -> Inspect -> Implement -> Verify behavior -> Report`

Resolve `{SKILL_DIR}` to this `SKILL.md` directory and `{PROJECT_ROOT}` to the active consumer project. Before implementation, create the W document with the installed wrapper:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" worklog "task title" --project-dir="{PROJECT_ROOT}"
```

Complete the W document's internal task contract: `original_request`, `required_outcomes`, `non_goals`, `named_references`, `allowed_changes`, `forbidden_side_effects`, `observable_success`, and `blocking_unknowns`. Do not print this contract on every turn. If no blocking unknown exists, inspect and proceed without asking. Ask only for destructive/irreversible action, outside-workspace write, external installation, or a product decision that evidence cannot resolve.

Open named references first and trace source input through its consumer to the observable result. The parent may implement directly. Delegate only bounded independent work or a distinct high-risk concern; do not require agent/reviewer counts. A worker prompt includes the relevant original sentence, exact task/non-goal, references, read/write scope, expected observation, verification, and claim/evidence/gap return. Exploration and review default to read-only, and workers do not fan out.

For every required outcome, predict, execute the closest practical user surface, record the observation, and compare the gap. The parent personally reopens decisive references, inspects the final diff, and reruns or inspects decisive execution output. Child `done`/`PASS`, reviewer count, markers, and spot-checks are not completion evidence.

Before the final response, complete the W Task Contract, Problem, Approach, Files Changed, Verification, Experiment Log, User Testing Needed, and Result sections; then set the W and index status to `done`. Report conclusion first in natural language, followed by actual changes/observations, decisive evidence, and any remaining limitation. Do not expose internal role acronyms or phase narration. End the user-facing response with the shared `[의도]`, `[이해]`, `[설명]` block required by the current turn contract.
