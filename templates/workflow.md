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

## Role Division

**Agent:** Analysis, planning, implementation (heavy work)
**Orchestrator (you):** Understanding, review, verification, reporting (quality control)

```
Phase 1: Understand       → Orchestrator + User
Phase 2: Analyze           → AGENT
Phase 3: Review Analysis   → Orchestrator
Phase 4: Plan              → AGENT
Phase 5: Review Plan       → Orchestrator + User
Phase 5.5: Alternative     → Orchestrator (optional)
Phase 6: Implement         → AGENT
Phase 7: Verify            → Orchestrator
Phase 8: Report            → Orchestrator
```

**Why this division:**
- Agents are full Claude instances. They can read thousands of lines, trace execution paths, and analyze complex interactions. Use them for heavy lifting.
- Orchestrator maintains the thread of understanding. Never delegate understanding or verification to agents — that is YOUR job.
- Agents for grep/file search is waste. Use Grep/Glob tools directly.

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

### Phase 2: Analyze the Code (AGENT)

**Goal:** Find gaps between your understanding and reality (the actual code/system).

**Launch an agent.** Analysis requires reading large amounts of code, tracing call chains, and understanding dependencies. This is agent work.

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

**Output:** Agent's analysis results

---

### Phase 3: Review Analysis (Orchestrator)

**Goal:** Verify the agent's analysis is complete and accurate.

**This is YOUR job. Do not delegate review to another agent.**

#### Check the agent's output:
```
Function: [name]
Call chain: [caller → function → callees]
State changes: [variables affected]
Current behavior: [what happens now]
Predicted behavior after change: [what will happen]
Risk: [what could break]
```

**If any of these are missing or unclear:**
- Send the agent back with follow-up questions
- Or launch a new agent with a more specific prompt

**If you cannot produce a clear picture of how the code works, you do not understand it enough to modify it. Do not proceed.**

#### Gap check:
- Does the analysis match Phase 1 understanding?
- Did the analysis reveal anything that changes your understanding?
- If yes → revisit Phase 1, adjust understanding with user

---

### Phase 4: Plan (AGENT)

**Goal:** Agent creates specific changes that close each gap.

**Launch an agent** with Phase 1 understanding + Phase 3 verified analysis:

```
## Background
[Phase 1 understanding + Phase 2-3 analysis results]

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

**Output:** Agent's plan

---

### Phase 5: Review Plan (Orchestrator + User)

**Goal:** Find gaps between plan and intent.

**This is YOUR job.**

#### Checklist:
- [ ] Does the plan address every gap from Phase 3?
- [ ] Does it preserve what must not break (from Phase 1)?
- [ ] Is each change's "why" directly connected to a gap?
- [ ] Are inferred consequences acceptable?
- [ ] Success criteria describe behavior, not file contents?

#### If regression risk exists, verify with agent:
```
## Background
Current code does [X]. Plan proposes changing [Y].

## Task
1. Trace the current execution path of [affected functions].
2. Mentally apply the planned changes.
3. Trace the new execution path.
4. Compare: any differences besides the intended change?

## Expected output
- Before: [execution path and result]
- After: [execution path and result]
- Regression found: Yes/No + details
```

If ANY regression is found → revise plan → re-review.

**Get user approval before implementing.**

---

### Phase 5.5: Alternative Proposal (Optional, Orchestrator)

**Goal:** If a better approach exists, propose it before implementation.

This phase occurs AFTER plan review, BEFORE implementation. Only use when you genuinely believe there's a better way.

#### When to propose:

| Propose | Do NOT propose |
|---------|----------------|
| Better achieves the intent | Just "simpler" or "faster" |
| Can explain WHY it's better | Gut feeling / pattern matching |
| Verifiable improvement | Skips steps to save time |
| Maintains all constraints | Ignores some requirements |

#### Proposal format:

```
## Current plan approach
[Summary of Phase 4 plan]

## Alternative approach
[What you propose instead]

## Comparison
- Intent achievement: [How each approach achieves the intent]
- Risks: [Risks of each approach]
- Trade-offs: [What you gain/lose with each]

## Why I believe the alternative is better
[Specific, verifiable reasoning — not "it's simpler"]

## Your decision needed
Which approach should we proceed with?
```

#### If alternative is accepted:
- Return to Phase 4
- Create new plan based on alternative
- Go through Phase 5 review again
- Only then proceed to Phase 6

**Critical:** "Better" means better achieves the intent, not faster to implement. Shortcuts disguised as improvements are not proposals — they are anti-patterns.

---

### Phase 6: Implement (AGENT)

**Goal:** Agent executes the plan exactly. No improvisation.

**Launch an agent** with the approved plan:

```
## Background
[Approved plan from Phase 4-5]

## Task
Implement the following changes exactly as specified:
[List each change with file, location, and exact modification]

## Rules
- Implement ONLY what is in the plan
- If reality differs from plan → STOP and report the discrepancy
- Do NOT improvise or "improve" beyond the plan
- After implementation, list all files changed
```

**Never:** "This is different from the plan but seems better" and continue without revision.

#### Gap detection during implementation:
```
Plan: [Do X]
Reality: [X doesn't work, need to do Y]
→ This is a gap
→ Plan revision required (return to Phase 4-5)
```

---

### Phase 7: Verify (Orchestrator)

**Goal:** Confirm implementation matches plan and success criteria.

**This is YOUR job. Verification is not delegation.**

#### Verification methods:

**Method 1: Execution Path Tracing** (logic, state changes)
- Read the modified code
- Start from trigger (user action / hook / event)
- Follow every call, branch, and state change
- End at the observable result
- Predict exactly what happens
- Compare against success criterion
- Verdict: PASS or FAIL

**Method 2: State Comparison** (before/after)
- Compare state transitions before and after change
- Trace: trigger → execution → final state
- Check for unintended side effects
- Verdict: PASS or FAIL

#### Rules:
- Every success criterion must have at least one verification method applied
- Every regression check must be verified
- Must produce a **behavior prediction**, not a text-existence check
- **"File contains X" is NEVER valid verification.** Predict behavior.
- If cannot predict behavior → understanding is insufficient → return to Phase 2
- PASS requires explanation of predicted behavior. "It matches" alone is not PASS.
- Only PASS/FAIL. "Mostly works" = FAIL.

---

### Phase 8: Report (Orchestrator)

**Goal:** Communicate results and check for final gap.

#### Structure:
```
## Changes Made
[What changed, which files]

## Verification Results
For each criterion:
- Criterion: [description]
- Method: [which verification method]
- Prediction: [what will happen]
- Verdict: PASS/FAIL

## Regression Check Results
For each preserved behavior:
- Behavior: [description]
- Verified by: [method]
- Verdict: PASS/FAIL

## User Testing Needed
[What the user should check that cannot be verified statically]
```

#### Final gap check:
- Ask user: "Is this the intended result?"
- If not → gap exists → trace which phase introduced it

---

## Working with Agents

### Core: Agents can have gaps too

Agents only know what's in the prompt. They lack context.
Therefore:

1. **Transfer intent explicitly** — background, purpose, expected outcome
2. **Verify understanding** — have agent state its understanding before working
3. **Validate results** — check if agent output matches intent
4. **Infer from responses** — does the agent's answer reveal a gap in your own understanding?

### Agent prompt required elements:
```
## Background (why this is needed)
## Task (what to do)
## Expected output (what format)
## Confirmation (state your understanding before working)
```

### Agents handle:
- Code analysis (Phase 2): call chain tracing, dependency analysis, state flow
- Planning (Phase 4): gap analysis, change specification, success criteria
- Implementation (Phase 6): code modification, exact plan execution
- Regression checks (Phase 5): trace before/after execution paths

### Orchestrator handles:
- Understanding (Phase 1): user intent, requirements
- Review (Phase 3, 5): quality control of agent output
- Verification (Phase 7): behavior prediction, regression check
- Reporting (Phase 8): results to user

### Never use agents for:
- Simple grep / file search (use Grep/Glob tools)
- Checking if text exists in a file (use Read/Grep tools)
- Understanding user intent (that's your job)
- Verification of implementation (that's your job)

### Processing agent responses:
1. Does agent's stated understanding match your intent? → If not, re-instruct
2. Does result answer the question? → If not, follow up
3. Never blindly trust → verify critical parts yourself
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

1. **Orchestrator doing agent work** — Analysis, planning, implementation are agent tasks. You review and verify.
2. **Delegating understanding** — Understanding and verification are YOUR job. Never delegate to agents.
3. **"File contains X" verification** — Text in file ≠ feature works. Always predict behavior.
4. **Agents for grep** — Agents do deep analysis. Grep does text search. Don't confuse them.
5. **Proceeding without verification** — "They probably understood" is how gaps start
6. **Ignoring gaps** — Small gaps become large rework
7. **Blindly trusting agent output** — Agents misunderstand too. Verify intent.
8. **Modifying without plan update** — If reality differs from plan, fix plan first
9. **"Partial success"** — Only Pass/Fail exists. No middle ground.
10. **Understanding without inference** — If you can't predict consequences, you don't understand
11. **Shortcuts as "improvements"** — Faster ≠ better. Skipping steps is not optimization.
12. **"Different from plan but better"** — Stop. Revise plan. Get approval. Then implement.
13. **Accepting proposals blindly** — User proposals also need understanding before acceptance
14. **Skipping Phase 2** — No analysis = no understanding = broken implementation.
15. **"Can't verify without running"** — You can: trace execution, compare state, analyze dependencies.

---

## Quick Reference

```
Task received
  → Phase 1: Understand         (Orchestrator + User confirm)
  → Phase 2: Analyze            (AGENT — traces code, dependencies, state)
  → Phase 3: Review analysis    (Orchestrator — checks completeness)
  → Phase 4: Plan               (AGENT — gap analysis, changes, success criteria)
  → Phase 5: Review plan        (Orchestrator + User confirm)
  → Phase 5.5: Alternative      (Orchestrator — optional, propose better approach)
  → Phase 6: Implement          (AGENT — executes plan exactly)
  → Phase 7: Verify             (Orchestrator — behavior prediction, NOT text check)
  → Phase 8: Report             (Orchestrator — results to user)

Understanding = Gap closed + Consequences predicted
If gap remains or inferences are wrong → do not proceed.
When patterns repeat → propose lesson → prevent future gaps.
```
