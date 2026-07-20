# Implement, Verify, and Report

This reference expands stages 3-5 of [SKILL.md](SKILL.md). The parent owns implementation boundaries and the final completion decision.

## Implement

Make only changes allowed by the W task contract. If the implementation exposes a materially different product choice or forbidden side effect, update the contract and stop only when that produces a blocking unknown. Do not stop merely because the observed file count differs from an estimate.

Delegation is optional. Use it for bounded independent work or distinct high-risk review, and do not require a mirrored reviewer for every implementation worker.

## Verify behavior

For each required outcome, write the prediction before observation, execute the closest practical user surface, record the actual output, and compare the two. Text existence is structural evidence, not runtime proof.

The parent must directly:

- reopen decisive named references;
- inspect the final diff and connected callers;
- rerun or inspect the decisive command/result;
- compare forbidden side effects with actual state;
- reject child `done`/`PASS` claims that conflict with execution.

Review is selected for risk. Shared contracts, security boundaries, data loss, irreversible changes, and user-visible behavior may justify an independent read-only review. Multiple reviewers receive different risks rather than duplicate checklists.

## Failure handling

Record failed attempts and observed causes in the W experiment log. Repair the failed scope when the contract remains valid. If evidence changes the approach or success condition, move the task to regressing rather than accumulating ad hoc phases.

## Report

Finish the W document before the conversation summary. Lead with the outcome, then actual changes/observations, decisive evidence, and any real remaining limitation. Keep workflow field names and role acronyms out of the user-facing response.
