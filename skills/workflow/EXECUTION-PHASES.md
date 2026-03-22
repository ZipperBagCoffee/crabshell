# Execution Phases (Phases 8-11)

> Detailed phase definitions for the implementation, verification, and reporting stages of the Agent Orchestration Workflow.
> For the main workflow overview, see [SKILL.md](SKILL.md).

---

### Phase 8: Implement (Work Agent)

Execute plan exactly. No improvisation.

**If reality differs from plan → STOP.** This is a plan-reality gap. Return to Phase 5-7 for revision.
**"Different from plan but better" → Stop. Revise plan. Get approval. Then implement.**

**Runtime Verification (mandatory):**
After implementation, verify that your changes will actually work when deployed/applied in practice.

**Verification Priority:**
1. **Can you directly execute/trigger this and observe the result? → Do it.** Attach the output as evidence (execution log, screenshot, diff, test result). This is the gold standard.
2. **Direct execution impractical?** → Trace the path using the procedure below: trigger → path → conditions → result.
3. **Whatever method used, observation evidence is required.** A claim of "verified" or "confirmed" without attached evidence is not verification.

**Path-tracing procedure (method 2, or supplement to method 1):**
1. Identify the trigger (what causes this change to take effect? User action, system event, someone reading this document, a function call, etc.)
2. Trace the full path from trigger to intended result — step by step, through the actual system
3. Identify all conditions that must be true for the intended result to occur
4. Check: are those conditions actually met in the real context?
5. If any condition fails or the result is unreachable → this is an implementation gap. STOP and report.

Format:
```
Trigger: [what initiates this]
→ [step 1]: [what happens]
→ [step 2]: [what happens]
→ ...
→ Result: [intended observable effect]
Conditions: [what must be true for this to work]
Verdict: WORKS / BROKEN — [reason]
```

This is not optional. If you can verify it, you must. "Can verify but didn't" = violation.

### Internal Iteration Protocol (Work Agent)

When an implementation attempt fails at the execution level (syntax error, runtime error, simple typo):

1. **Log the failure:** Record what was tried and why it failed
2. **Classify the failure:**
   - **Execution-level** (syntax error, missing import, typo, runtime exception) → iterate internally
   - **Plan-level** (different approach needed, architectural change, scope change) → STOP and report to Orchestrator
3. **Re-attempt** with the execution-level fix (max 3 internal iterations)
4. **If still failing after 3 attempts** → STOP and report to Orchestrator with all attempt logs

**Boundary rule:** "I need to try a different approach" = plan-level = STOP. "I need to fix this typo/import/syntax" = execution-level = iterate.

**All internal iterations must be logged** for post-hoc review by Review Agent in Phase 9. Format:
```
Internal Iteration Log:
| # | What failed | Classification | Fix applied | Result |
|---|-------------|---------------|-------------|--------|
| 1 | [error] | execution-level | [fix] | PASS/FAIL |
```

### Phase 9: Verify (Review Agent)

For each criterion:
1. Read actual implementation
2. **Runtime Verification** — independently verify the implementation will work in practice (do NOT trust Work Agent's results):
   a. Identify the trigger (what causes this to take effect?)
   b. Follow the full path through the actual system (read the files, trace the flow)
   c. At each step: what state exists? what conditions are checked? what happens next?
   d. Does the path reach the intended result?
   e. Produce verification in same format as Phase 8
3. Compare your trace against Work Agent's trace — discrepancies = findings
4. Predict observable behavior based on YOUR trace
5. Compare against criterion
6. Verdict: PASS or FAIL with explanation

**Observation Evidence Gate:**
- Does the Work Agent's verification include observation evidence (execution output, diff, log, test result)?
- If YES: evaluate the evidence — is it authentic, relevant, and sufficient?
- If NO (only text claims like "verified", "confirmed", "works correctly" without attached evidence): **automatic FAIL.** Request re-verification with observation evidence.

**Rules:**
- "File contains X" is NEVER valid verification. Predict behavior.
- Only PASS / FAIL. No "mostly works."
- Cannot predict behavior → say CANNOT VERIFY explicitly
- If reference exists, structural comparison is MANDATORY:
  1. Read reference structure (layout, components, ordering)
  2. Read implementation structure
  3. Compare: structurally identical?
  4. List EVERY structural difference
  5. Verdict: MATCHES / DIFFERS (with specific diff list)

### Phase 9.5: Cross-Review

Same procedure as Phase 3.5. See [ANALYSIS-PHASES.md — Phase 3.5](ANALYSIS-PHASES.md#phase-35--65--95-cross-review-blocking-gate).

### Phase 10: Meta-Verify (Orchestrator as Intent Guardian)

**Input:** Verification results + Cross-Review Report (if 2+ reviewers)

1. Did reviewer predict behavior for each PASS (not just "matches")?
2. **Spot-check** (same scaling as Phase 4) — read actual code yourself. **NON-NEGOTIABLE.**
3. If Cross-Review Report exists: resolve all Contested Findings — these are your highest-priority items
4. If spot-check contradicts reviewer → both verification and implementation suspect
5. If reviewer gave vague PASS → reject, re-launch with specific instructions
6. **Runtime Verification** — the most critical check:
   - Did Review Agent produce runtime verification for each criterion?
   - Does the verification show the implementation will actually work when deployed/applied?
   - **Does the verification report contain observation evidence (execution output, diff, log)?** If text-only claims without evidence → reject, re-launch with explicit instruction to provide observation evidence.
   - Spot-check at least 1 verification: trace the path yourself through the actual system
   - If Review Agent skipped runtime verification → reject, re-launch
   - If result is BROKEN → implementation failed regardless of other checks
7. **Final Intent Comparison Protocol** — for the implemented result:
   - Re-read Intent Anchor (list IA-1 through IA-N)
   - For each IA item: `IA-N → SATISFIED/VIOLATED — [evidence from implementation]`
   - Any VIOLATED → return to appropriate phase
8. **Self-enforcement Checklist** (same as Phase 4 — MUST complete before proceeding to Report)
9. On failure, return to appropriate phase:
   - Implementation wrong → Phase 8
   - Plan was flawed → Phase 5
   - Analysis was wrong → Phase 2

### Partial Failure Protocol (Graceful Degradation)

When Phase 10 detects partial failure (some criteria PASS, some FAIL):

1. **Separate results:** Identify which criteria PASSED and which FAILED
2. **Accept passed criteria** — these results are confirmed and not re-verified (unless rework could affect them)
3. **Scope the rework** — "Phase 8 re-run for criteria X and Y only"
4. **Re-run targets only failed criteria** (not the entire phase)
5. **Regression check** — if rework could affect previously passed criteria, flag them for re-verification

**Critical distinction:**
- **Verification verdicts** remain strictly PASS/FAIL (Anti-Pattern #9 unchanged)
- **Work product preservation** allows partial progress — passed work is kept, only failed parts are reworked
- "Graceful degradation" applies to work scope, NEVER to verdict quality

### Phase 11: Report (Orchestrator)

```
## Changes Made
[Files and modifications]

## Verification Results
Per criterion: description, reviewer verdict, my spot-check

## Regression Check Results
Per behavior: description, verdict

## Experiment Log (if phase rework occurred)
| Attempt | Phase | What was tried | Result | Why it failed |
|---------|-------|----------------|--------|---------------|
| [N] | [phase#] | [approach description] | FAIL/PASS | [root cause] |

Note: Only populated when Phase 10 → Phase 8/5/2 rework occurred. Empty if workflow proceeded without rework.

## User Testing Needed
[What cannot be verified statically]

## Post-Workflow Documentation
- [ ] Ticket updated: `/ticketing P{NNN}_T{NNN}` (if executing from ticket)
- [ ] Other documents updated: `/discussing`, `/researching`, `/planning` (as needed)
```

Final gap check: "Is this the intended result?"

### Post-Workflow: Document (mandatory)

After workflow completion, document the work using the appropriate skill:

- `/ticketing P{NNN}_T{NNN}` — update ticket with work log entry (if executing from a ticket)
- `/discussing "topic"` — record decisions or dialogue outcomes
- `/researching "topic"` — record investigation findings or analysis results
- `/planning "topic"` — record if a new plan was derived

At minimum, the relevant ticket's work log (`/ticketing` update) MUST be updated.
