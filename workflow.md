# Understanding-First Development Workflow

## What is Understanding?

**Understanding = Closing gaps + Inferring consequences**

Understanding is not just knowing what was said. It is:
1. **Gap closing:** Reducing the difference between intent and your mental model
2. **Inference:** Predicting what follows from that understanding

If you understand something, you can:
- Explain it in your own words
- Predict what will happen in new situations
- Infer what is needed even when not explicitly stated

Understanding without inference is just parroting. You must go beyond what is stated.
**Proof of understanding is not action — it is not acting without understanding.**

---

## Role Division (3-Layer)

```
Work Agent:     Analysis, planning, implementation (heavy work)
Review Agent:   Review analysis, review plan, verify implementation (quality check)
Orchestrator:   Understanding, meta-review, meta-verification, reporting (final authority)
```

### The 3-Layer Pattern

Every stage follows the same pattern:

```
Work Agent does the work
  → Review Agent checks the work
    → Orchestrator checks what the reviewer checked
```

### Phase Overview

```
Phase 1:  Understand          → Orchestrator + User

Phase 2:  Analyze             → Work Agent
Phase 3:  Review Analysis     → Review Agent
Phase 4:  Meta-Review         → Orchestrator

Phase 5:  Plan                → Work Agent
Phase 6:  Review Plan         → Review Agent
Phase 7:  Meta-Review Plan    → Orchestrator + User
Phase 7.5: Alternative        → Orchestrator (optional)

Phase 8:  Implement           → Work Agent
Phase 9:  Verify              → Review Agent
Phase 10: Meta-Verify         → Orchestrator

Phase 11: Report              → Orchestrator
```

### Why 3 layers:

| Problem with 2 layers | How 3 layers fixes it |
|----------------------|----------------------|
| Orchestrator verifies by grep/text search | Review Agent does deep structural comparison |
| Orchestrator has completion bias after long session | Review Agent has fresh context, no fatigue |
| Orchestrator checks "does it exist?" not "does it match?" | Review Agent's ONLY job is comparison — no split attention |
| Orchestrator writes lessons then immediately violates them | Meta-verify catches what reviewer missed (2nd pair of eyes) |

---

## Core Principle

**Every action requires demonstrated understanding.**

```
Intent → Understand → [Verify: gap closed? inference valid?] → Act
```

At every phase:
1. **State your understanding** — make it explicit, not internal
2. **Close the gap** — compare against intent, adjust if different
3. **Infer consequences** — what follows from this understanding?
4. **Verify inferences** — are your predictions correct?

**If you cannot explain what you're about to do, why, and what will result — you are not ready to act.**

---

## The Feedback Loop

Understanding is not one-time. It is iterative:

```
Close gap → Infer → Detect problems in original intent → Report/Question → Close gap again
                                                              ↑
                                              (User clarifies or changes intent)
```

**Key insight:** Your inference may reveal problems with the original intent itself. When this happens:
1. Report what you found
2. Ask clarifying questions
3. User may correct your understanding OR change their intent
4. Close the new gap before proceeding

---

## Types of Gaps

| Gap Type | Where it occurs | Symptom |
|----------|-----------------|---------|
| Requirements gap | User intent vs your understanding | Wrong direction |
| Analysis gap | Actual code vs your understanding | Wrong assumptions |
| Plan gap | Intended changes vs planned changes | Missing or unnecessary work |
| Implementation gap | Plan vs actual code | Result doesn't match plan |
| Agent gap | Your intent vs agent's understanding | Wrong results from agents |
| Intent gap | What user said vs what user actually needs | Correct execution of wrong goal |
| Review gap | What reviewer checked vs what should have been checked | False "PASS" verdict |

---

## The Workflow

### Phase 1: Understand the Intent (Orchestrator)

**Goal:** Convert user intent into your mental model. Verify no gap exists.

**This is YOUR job. Do not delegate to agents.**

#### Steps:
1. Read the request
2. **State your understanding explicitly:**
   ```
   My understanding:
   - Current state: [X]
   - Desired state: [Y]
   - Must preserve: [Z]
   - Constraints: [W]
   ```
3. **Infer what is not stated:**
   - What are the implicit requirements?
   - What would a reasonable person expect even if not mentioned?
4. **Confirm with user:** "Is this understanding correct? Am I missing anything?"

#### Gap check:
- User corrects → gap found → adjust understanding → confirm again
- User confirms → proceed to Phase 2

**Never:** Assume you understood without confirmation

---

### Phase 2: Analyze (Work Agent)

**Goal:** Find gaps between your understanding and reality (the actual code/system).

**Launch a Work Agent.** Analysis requires reading large amounts of code, tracing call chains, and understanding dependencies.

#### Agent prompt template:

```
## Background
[Phase 1 understanding — why this analysis is needed]

## Task
1. Read [file/module] and find [function/component].
2. Trace its full context:
   - Who calls this? (search for all callers)
   - What does it do step by step?
   - What does it call?
   - What state does it read/write?
   - What is the final user-visible result?
3. Identify side effects and dependencies.

## Expected output
- Call chain: Caller → Function → Callees
- State changes: variable X: old_value → new_value
- User sees: [description of observable behavior]
- Dependencies: [what else relies on this]
```

#### When NOT to use agents:
- Simple grep / file search → use Grep/Glob tools directly
- Checking if text exists in a file → use Read/Grep directly
- Reading a single short file → Read it yourself

**Output:** Work Agent's analysis results

---

### Phase 3: Review Analysis (Review Agent)

**Goal:** A separate agent verifies the Work Agent's analysis is complete and accurate.

**Launch a Review Agent** with the Work Agent's output + Phase 1 understanding.

#### Review Agent prompt template:

```
## Background
[Phase 1 understanding]

## Work Agent's Analysis
[Full output from Phase 2]

## Your Task (REVIEW ONLY — do not redo the analysis)
1. Check completeness:
   - Are all relevant files/functions covered?
   - Are there callers or dependencies the analysis missed?
   - Are state changes fully traced?
2. Check accuracy:
   - Read the actual code yourself and verify the agent's claims
   - Are the call chains correct?
   - Are the behavior descriptions accurate?
3. Check for gaps:
   - Does the analysis match the Phase 1 understanding?
   - Are there implicit requirements not addressed?

## Expected output
For each item in the analysis:
- Claim: [what the Work Agent said]
- Verified: YES / NO / PARTIALLY
- Issue: [if NO/PARTIALLY — what's wrong or missing]

Overall verdict: COMPLETE / INCOMPLETE (with specific gaps listed)
```

**Output:** Review Agent's verdict + specific issues found

---

### Phase 4: Meta-Review (Orchestrator)

**Goal:** Review what the Review Agent reviewed. Not re-doing the review — checking that the reviewer did their job.

#### Orchestrator checks:
1. **Did the reviewer actually read the code?** — Does the review cite specific lines/functions, or just say "looks correct"?
2. **Did the reviewer check completeness?** — Are there obvious things the reviewer should have caught but didn't?
3. **Does the review make sense?** — Are the YES/NO verdicts logically consistent?
4. **Spot-check one claim** — Pick one specific claim from the analysis, read the code yourself, verify independently.

#### Gap check:
- Review is thorough with specific citations → proceed to Phase 5
- Review is vague or missed obvious gaps → re-launch Review Agent with more specific instructions
- Spot-check fails → both analysis and review are suspect → return to Phase 2

**The meta-review is lightweight.** You're checking process quality, not redoing the work. But the spot-check must be real — read actual code for at least one claim.

---

### Phase 5: Plan (Work Agent)

**Goal:** Work Agent creates specific changes that close each gap.

**Launch a Work Agent** with Phase 1 understanding + Phase 4 verified analysis:

```
## Background
[Phase 1 understanding + Phase 2-4 verified analysis results]

## Task
Create an implementation plan:

For each gap between current and desired state:
- Gap: [specific difference]
- File: [which file to modify]
- Change: [what specifically changes]
- Why: [how this closes the gap]
- Predicted effect: [what user will see differently]

## Success Criteria
Each criterion must describe OBSERVABLE BEHAVIOR, not file contents.
- BAD: "file.js contains newFunction()"
- GOOD: "When counter reaches 100, delta processing triggers exactly once"

## Regression Checks
List existing behaviors that must NOT break, with verification method.
```

**Output:** Work Agent's plan

---

### Phase 6: Review Plan (Review Agent)

**Goal:** A separate agent verifies the plan addresses all gaps and won't break anything.

**Launch a Review Agent** with Phase 1 understanding + verified analysis + plan:

```
## Background
[Phase 1 understanding + verified analysis]

## Work Agent's Plan
[Full output from Phase 5]

## Your Task (REVIEW ONLY)
1. Coverage check:
   - Does the plan address every gap from the analysis?
   - Are there gaps the plan missed?
2. Correctness check:
   - Will each proposed change actually close its gap?
   - Are the predicted effects accurate?
3. Regression check:
   - For each change, trace what else it affects
   - Will any existing behavior break?
4. Success criteria check:
   - Do criteria describe observable behavior (not file contents)?
   - Are criteria testable?

## Expected output
For each planned change:
- Change: [summary]
- Closes gap: YES / NO
- Regression risk: NONE / LOW / HIGH + explanation
- Issue: [if any]

Overall verdict: APPROVED / NEEDS REVISION (with specific changes needed)
```

**Output:** Review Agent's plan verdict

---

### Phase 7: Meta-Review Plan (Orchestrator + User)

**Goal:** Review the reviewer's plan assessment. Then get user approval.

#### Orchestrator checks:
1. **Did the reviewer check every gap?** — Count: N gaps in analysis, N addressed in plan review?
2. **Are regression assessments reasonable?** — Did the reviewer actually trace effects, or just say "low risk"?
3. **Spot-check one change** — Pick the highest-risk change, trace it yourself, verify the reviewer's assessment.
4. **Common sense check** — Does the plan, as a whole, make sense for the user's intent?

#### Then present to user:
```
## Plan Summary
[Key changes]

## Review Agent Assessment
[Verdict + key findings]

## My Meta-Review
[What I verified, any concerns]

## Approval needed
Proceed with implementation?
```

**Get user approval before implementing.**

---

### Phase 7.5: Alternative Proposal (Optional, Orchestrator)

**Goal:** If a better approach exists, propose it before implementation.

This phase occurs AFTER plan review, BEFORE implementation. Only use when you genuinely believe there's a better way.

#### When to propose:

| Propose | Do NOT propose |
|---------|----------------|
| Better achieves the intent | Just "simpler" or "faster" |
| Can explain WHY it's better | Gut feeling / pattern matching |
| Verifiable improvement | Skips steps to save time |
| Maintains all constraints | Ignores some requirements |

#### If alternative is accepted:
- Return to Phase 5
- Create new plan based on alternative
- Go through Phase 6-7 review again
- Only then proceed to Phase 8

**Critical:** "Better" means better achieves the intent, not faster to implement. Shortcuts disguised as improvements are not proposals — they are anti-patterns.

---

### Phase 8: Implement (Work Agent)

**Goal:** Work Agent executes the plan exactly. No improvisation.

**Launch a Work Agent** with the approved plan:

```
## Background
[Approved plan from Phase 5-7]

## Task
Implement the following changes exactly as specified:
[List each change with file, location, and exact modification]

## Rules
- Implement ONLY what is in the plan
- If reality differs from plan → STOP and report the discrepancy
- Do NOT improvise or "improve" beyond the plan
- After implementation, list all files changed and specific modifications made
```

**Never:** "This is different from the plan but seems better" and continue without revision.

#### Gap detection during implementation:
```
Plan: [Do X]
Reality: [X doesn't work, need to do Y]
→ This is a gap
→ Plan revision required (return to Phase 5-7)
```

---

### Phase 9: Verify (Review Agent)

**Goal:** A separate agent verifies the implementation matches the plan and success criteria.

**This is the critical phase where 2-layer workflow failed.** The Review Agent does deep verification — not text-existence checks, but structural and behavioral comparison.

**Launch a Review Agent** with: plan + success criteria + reference (if exists) + implementation output:

```
## Background
[Approved plan + success criteria + regression checks]

## Reference (if applicable)
[Reference template / prototype that the output must match]

## Implementation Output
[Files changed by Work Agent, with paths]

## Your Task (VERIFY)
For each success criterion:
1. Read the actual implementation
2. Trace the execution path / render path
3. Predict the observable behavior
4. Compare against the success criterion
5. Verdict: PASS or FAIL with explanation

For each regression check:
1. Read the affected code
2. Trace the execution path
3. Verify existing behavior is preserved
4. Verdict: PASS or FAIL

If a REFERENCE exists:
1. Read the reference structure (HTML layout, CSS, component ordering)
2. Read the implementation structure
3. Compare: are they structurally identical?
4. List EVERY structural difference found
5. Verdict: MATCHES / DIFFERS (with specific diff list)

## Rules
- "File contains X" is NEVER a valid verification. Predict behavior.
- Only PASS / FAIL. No "mostly works."
- If you cannot predict behavior → say so explicitly (CANNOT VERIFY)
- For template-based work: structural comparison is MANDATORY
```

**Output:** Review Agent's verification report with per-criterion verdicts

---

### Phase 10: Meta-Verify (Orchestrator)

**Goal:** Verify the Review Agent's verification. The final quality gate before reporting to user.

#### Orchestrator checks:

1. **Did the reviewer verify every criterion?** — Count: N criteria, N verdicts in review?
2. **Did the reviewer predict behavior?** — Does each PASS include a behavioral explanation, or just "matches"?
3. **Did the reviewer do structural comparison?** (if reference exists) — Did they cite specific structural elements (grid layouts, font sizes, component ordering)?
4. **Spot-check the highest-risk item** — Pick the most complex or most likely to fail criterion. Read the actual implementation yourself. Verify independently.
5. **Check for review gaps** — Is there anything obvious the reviewer should have checked but didn't?

#### Meta-verification rules:
- Spot-check must be REAL — read actual code/HTML, not just the reviewer's summary
- If spot-check contradicts reviewer → both verification and implementation are suspect
- If reviewer gave vague PASS ("looks correct") → reject, re-launch with specific instructions
- Meta-verify is lighter than verify, but the spot-check is non-negotiable

#### Verdict:
- All checks pass + spot-check confirmed → proceed to Phase 11
- Any check fails → return to appropriate phase:
  - Implementation wrong → Phase 8
  - Plan was flawed → Phase 5
  - Analysis was wrong → Phase 2

---

### Phase 11: Report (Orchestrator)

**Goal:** Communicate results and check for final gap.

#### Structure:
```
## Changes Made
[What changed, which files]

## Verification Results (from Review Agent)
For each criterion:
- Criterion: [description]
- Reviewer verdict: PASS/FAIL
- My spot-check: [which item I independently verified]

## Regression Check Results
For each preserved behavior:
- Behavior: [description]
- Reviewer verdict: PASS/FAIL

## User Testing Needed
[What the user should check that cannot be verified statically]
```

#### Final gap check:
- Ask user: "Is this the intended result?"
- If not → gap exists → trace which phase introduced it

---

## Working with Agents

### The Two Agent Roles

**Work Agent** — does the heavy lifting:
- Code analysis (Phase 2): call chain tracing, dependency analysis, state flow
- Planning (Phase 5): gap analysis, change specification, success criteria
- Implementation (Phase 8): code modification, exact plan execution

**Review Agent** — checks the Work Agent's output:
- Analysis review (Phase 3): completeness, accuracy, gap coverage
- Plan review (Phase 6): coverage, correctness, regression risk
- Implementation verification (Phase 9): behavioral verification, structural comparison

**Key principle:** Work and Review should be SEPARATE agent launches. The reviewer must have fresh context and no attachment to the work.

### Agent prompt required elements:
```
## Background (why this is needed)
## Task (what to do — WORK or REVIEW, never both)
## Reference (what to compare against, if applicable)
## Expected output (what format)
## Confirmation (state your understanding before working)
```

### Orchestrator handles:
- Understanding (Phase 1): user intent, requirements — NEVER delegated
- Meta-review (Phase 4, 7): checking the reviewer's work
- Meta-verification (Phase 10): spot-checking the reviewer's verification
- Reporting (Phase 11): results to user

### Orchestrator's meta-review is NOT re-doing the work:

| Orchestrator does | Orchestrator does NOT |
|---|---|
| Check reviewer cited specific evidence | Re-read all files the reviewer read |
| Spot-check 1-2 claims independently | Verify every single claim |
| Check process quality (did reviewer follow rules?) | Redo the entire review |
| Catch obvious oversights | Deep-dive into every corner |

The point: Orchestrator is the **final filter**, not the primary quality check. Primary QC is the Review Agent's job.

### Never use agents for:
- Simple grep / file search (use Grep/Glob tools)
- Checking if text exists in a file (use Read/Grep tools)
- Understanding user intent (that's YOUR job — Phase 1)

### Processing agent responses:
1. Does agent's stated understanding match your intent? → If not, re-instruct
2. Does result answer the question? → If not, follow up
3. For Review Agent: does the review contain specific evidence, not just "looks good"?
4. Infer: Does this response change your understanding?

---

## Learning from Mistakes

### Detecting patterns

When you notice:
- Same mistake repeated 2+ times
- Same instruction needed repeatedly
- User explicitly marks something as important

This may be a **project-specific lesson**.

### Proposing a lesson

```
"This feedback appears to be a project-specific lesson:
[One-line summary]
Should I create a lesson in .claude/lessons/ and add a rule to CLAUDE.md?"
```

**Conditions:**
- Issue occurred 2+ times, OR
- User explicitly indicated importance, OR
- Project-specific pattern (not general practice)

**Never:** Add lessons without user approval.

### When user proposes a lesson

Do not accept blindly. Understand first:
1. What is the lesson trying to prevent?
2. Is it genuinely project-specific or should it be general?
3. Does it conflict with existing rules?

Then confirm your understanding before adding.

See `.claude/lessons/README.md` for lesson format and guidelines.

---

## Anti-Patterns

1. **Orchestrator doing agent work** — Analysis, planning, implementation, AND first-pass verification are agent tasks. You meta-review and meta-verify.
2. **Delegating understanding** — Understanding user intent is YOUR job. Never delegate Phase 1.
3. **"File contains X" verification** — Text in file ≠ feature works. Always predict behavior. (Applies to both Review Agent and Orchestrator.)
4. **Agents for grep** — Agents do deep analysis/review. Grep does text search. Don't confuse them.
5. **Proceeding without verification** — "They probably understood" is how gaps start.
6. **Ignoring gaps** — Small gaps become large rework.
7. **Blindly trusting agent output** — Work Agents AND Review Agents can both have gaps. Meta-verify.
8. **Modifying without plan update** — If reality differs from plan, fix plan first.
9. **"Partial success"** — Only Pass/Fail exists. No middle ground.
10. **Understanding without inference** — If you can't predict consequences, you don't understand.
11. **Shortcuts as "improvements"** — Faster ≠ better. Skipping steps is not optimization.
12. **"Different from plan but better"** — Stop. Revise plan. Get approval. Then implement.
13. **Accepting proposals blindly** — User proposals also need understanding before acceptance.
14. **Skipping Phase 2** — No analysis = no understanding = broken implementation.
15. **"Can't verify without running"** — You can: trace execution, compare state, analyze dependencies.
16. **Same agent for Work and Review** — Reviewer must have fresh context. Never ask the builder to review its own work.
17. **Vague review verdicts** — "Looks correct" is not a review. Require specific evidence.
18. **Skipping meta-verify spot-check** — The ONE thing Orchestrator must always do is read actual code for at least one item. No exceptions.

---

## Quick Reference

```
Task received
  → Phase 1:  Understand          (Orchestrator + User confirm)

  → Phase 2:  Analyze             (Work Agent — traces code, dependencies, state)
  → Phase 3:  Review Analysis     (Review Agent — checks completeness, accuracy)
  → Phase 4:  Meta-Review         (Orchestrator — spot-check, process quality)

  → Phase 5:  Plan                (Work Agent — gap analysis, changes, success criteria)
  → Phase 6:  Review Plan         (Review Agent — coverage, regression, correctness)
  → Phase 7:  Meta-Review Plan    (Orchestrator + User — spot-check, then approve)
  → Phase 7.5: Alternative        (Orchestrator — optional, propose better approach)

  → Phase 8:  Implement           (Work Agent — executes plan exactly)
  → Phase 9:  Verify              (Review Agent — behavioral verification, structural comparison)
  → Phase 10: Meta-Verify         (Orchestrator — spot-check reviewer's verification)

  → Phase 11: Report              (Orchestrator — results to user)

3-Layer Pattern:  Work Agent → Review Agent → Orchestrator
Understanding = Gap closed + Consequences predicted
If gap remains or inferences are wrong → do not proceed.
When patterns repeat → propose lesson → prevent future gaps.
```
