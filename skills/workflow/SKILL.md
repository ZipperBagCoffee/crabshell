---
name: workflow
description: "Agent orchestration workflow for complex tasks. Use when RULES say 'invoke workflow skill' or user requests structured workflow execution."
---

# Agent Orchestration Workflow

> Principles (Understanding-First, HHH, Critical Stance, etc.) are injected via RULES every prompt.
> This document defines HOW those principles apply to agent-based task execution.

## Core Concepts

**Understanding = Closing gaps + Inferring consequences.**
Understanding without inference is just parroting. You must go beyond what is stated.
**Proof of understanding is not action — it is not acting without understanding.**

### The Feedback Loop

Your inference may reveal problems with the original intent itself:

```
Close gap → Infer → Detect problems in intent → Report/Question → User clarifies → Close gap again
```

When this happens: report what you found, ask clarifying questions, close the new gap before proceeding.

### Gap Types

| Gap Type | Where | Symptom |
|----------|-------|---------|
| Requirements | User intent vs your understanding | Wrong direction |
| Analysis | Actual code vs your understanding | Wrong assumptions |
| Plan | Intended vs planned changes | Missing/unnecessary work |
| Implementation | Plan vs actual code | Result doesn't match plan |
| Agent | Your intent vs agent's understanding | Wrong agent results |
| Intent | What user said vs what user needs | Correct execution of wrong goal |
| Review | What was checked vs what should be | False "PASS" verdict |

---

## 3-Layer Architecture

```
Work Agent:     Analysis, planning, implementation (heavy work)
Review Agent:   Review, verify (quality check — fresh context, no attachment)
Orchestrator:   Intent guardian, meta-review, meta-verify, report (final authority)
```

Every stage: **Work Agent → Review Agent → Orchestrator (Intent Guardian)**

**The Orchestrator is the Intent Guardian.** It judges whether review feedback serves or undermines the original intent. Reviewer opinions that would dilute, distort, or drift from the user's actual goal are overridden.

### Why 3 Layers (not 2)

| 2-Layer Problem | 3-Layer Fix |
|----------------|-------------|
| Orchestrator verifies by grep/text search | Review Agent does deep structural comparison |
| Orchestrator has completion bias after long session | Review Agent has fresh context |
| Orchestrator checks "exists?" not "matches?" | Review Agent's ONLY job is comparison |
| Orchestrator writes lessons then violates them | Meta-verify catches what reviewer missed |

### What Each Role Needs

| Role | Mindset |
|------|---------|
| **Orchestrator** | Close understanding gap before delegating. Filter reviews through original intent. Spot-check one claim per meta-review. Never aggregate — judge. |
| **Work Agent** | Execute exactly what's specified. If reality differs from plan, STOP and report. No improvisation. |
| **Review Agent** | Cite specific evidence. Predict behavior, don't just check text existence. PASS/FAIL only. Fresh context, no attachment to the work. |

---

## 11-Phase Workflow

```
Phase 1:  Understand          → Orchestrator + User
Phase 2:  Analyze             → Work Agent
Phase 3:  Review Analysis     → Review Agent
Phase 4:  Meta-Review         → Orchestrator (Intent Guardian)

Phase 5:  Plan                → Work Agent
Phase 6:  Review Plan         → Review Agent
Phase 7:  Meta-Review Plan    → Orchestrator + User
Phase 7.5: Alternative        → Orchestrator (optional)

Phase 8:  Implement           → Work Agent
Phase 9:  Verify              → Review Agent
Phase 10: Meta-Verify         → Orchestrator (Intent Guardian)

Phase 11: Report              → Orchestrator
```

### Agent Prompt Template (generic)

All agent prompts follow this structure:

```
## Background
[Why this is needed — Phase 1 understanding + relevant prior phase outputs]

## Task
[WORK or REVIEW — never both in one prompt]
[Specific instructions for this phase]

## Reference (if applicable)
[What to compare against]

## Expected Output
[Format and verdict structure]

## Confirmation
State your understanding before working.
```

### Phase 1: Understand (Orchestrator + User)

**YOUR job — never delegate.**

1. State understanding explicitly: current state, desired state, must preserve, constraints
2. Infer implicit requirements — what would a reasonable person expect even if not mentioned?
3. Confirm with user: "Is this understanding correct?"
4. User corrects → gap found → adjust → confirm again

### Phase 2: Analyze (Work Agent)

Trace call chains, dependencies, state changes, user-visible behavior.

**When NOT to use agents:** simple grep, checking text existence, reading a single short file.

### Phase 3: Review Analysis (Review Agent)

- Check completeness (all files/functions covered?)
- Check accuracy (read code yourself, verify claims)
- Per-item verdict: Claim → Verified YES/NO/PARTIALLY → Issue
- Overall: COMPLETE / INCOMPLETE (with specific gaps)

### Phase 4: Meta-Review (Orchestrator as Intent Guardian)

1. Did reviewer cite specific evidence (not just "looks correct")?
2. Spot-check ONE claim — read actual code yourself
3. Intent alignment: do findings serve user's goal?
4. **Intent Guardian judgment:**
   - Quality improvement + preserves intent → **accept**
   - Valid concern but fix dilutes intent → **accept concern, reject fix, find alternative**
   - Feedback redirects from user's goal → **override with explanation**
5. Gap check:
   - Thorough + intent-aligned → proceed to Phase 5
   - Vague or missed obvious gaps → re-launch Review Agent
   - Drifts from intent → accept valid findings, discard drift
   - Spot-check fails → both analysis and review suspect → return to Phase 2

### Phase 5: Plan (Work Agent)

For each gap: file, change, why, predicted effect.

**Success criteria rules:**
- MUST describe **observable behavior**, NOT file contents
- BAD: "file.js contains newFunction()"
- GOOD: "When counter reaches 100, delta triggers exactly once"

Include regression checks with verification method.

### Phase 6: Review Plan (Review Agent)

- Coverage: every gap addressed?
- Correctness: will changes close gaps?
- Regression risk per change (NONE / LOW / HIGH)
- Success criteria: observable behavior, testable?
- Per-change verdict + overall APPROVED / NEEDS REVISION

### Phase 7: Meta-Review Plan (Orchestrator + User)

1. Count: N gaps → N addressed in review?
2. Spot-check highest-risk change
3. Intent preservation: reviewer modifications still achieve user's goal?
4. Scope drift: plan grown beyond or shrunk below original intent?
5. Present summary → get user approval before implementing

### Phase 7.5: Alternative Proposal (Optional)

Only when genuinely better approach exists:

| Propose | Do NOT propose |
|---------|----------------|
| Better achieves the intent | Just "simpler" or "faster" |
| Can explain WHY | Gut feeling / pattern matching |
| Verifiable improvement | Skips steps to save time |
| Maintains all constraints | Ignores some requirements |

If accepted → return to Phase 5, full review cycle again.
**"Better" means better achieves intent, not faster to implement.**

### Phase 8: Implement (Work Agent)

Execute plan exactly. No improvisation.

**If reality differs from plan → STOP.** This is a plan-reality gap. Return to Phase 5-7 for revision.
**"Different from plan but better" → Stop. Revise plan. Get approval. Then implement.**

### Phase 9: Verify (Review Agent)

For each criterion:
1. Read actual implementation
2. Trace execution path
3. Predict observable behavior
4. Compare against criterion
5. Verdict: PASS or FAIL with explanation

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

### Phase 10: Meta-Verify (Orchestrator as Intent Guardian)

1. Did reviewer predict behavior for each PASS (not just "matches")?
2. Spot-check highest-risk item — read actual code yourself
3. If spot-check contradicts reviewer → both verification and implementation suspect
4. If reviewer gave vague PASS → reject, re-launch with specific instructions
5. **Final intent check:** does combined result deliver what user wanted? Technically correct but misses the point = failure.
6. Spot-check is **NON-NEGOTIABLE** — the ONE thing orchestrator must always do
7. On failure, return to appropriate phase:
   - Implementation wrong → Phase 8
   - Plan was flawed → Phase 5
   - Analysis was wrong → Phase 2

### Phase 11: Report (Orchestrator)

```
## Changes Made
[Files and modifications]

## Verification Results
Per criterion: description, reviewer verdict, my spot-check

## Regression Check Results
Per behavior: description, verdict

## User Testing Needed
[What cannot be verified statically]
```

Final gap check: "Is this the intended result?"

---

## Orchestrator Scope

| Does | Does NOT |
|------|----------|
| Check reviewer cited specific evidence | Re-read all files reviewer read |
| Spot-check 1-2 claims independently | Verify every single claim |
| Check process quality (rules followed?) | Redo the entire review |
| Filter review through original intent | Blindly accept reviewer suggestions |
| Override feedback that drifts from intent | Let reviewers redirect work |
| Catch obvious oversights | Deep-dive every corner |

---

## Parallel Execution

### Batch Pattern

```
Batch 1:
  Work A → Review A ─┐
  Work B → Review B ─┤── Cross-talk ── Orchestrator (intent check)
  Work C → Review C ─┘

Batch 2 (depends on Batch 1): ...
```

### Rules

- **1:1 Pairing**: Every Work Agent has a dedicated Review Agent
- **Independence**: Agents in a batch must not depend on each other
- **Dependency ordering**: Dependent tasks → separate batches

### Context Budget

Split by **logical boundaries** first (module, layer, feature), then check tokens:

| Work Type | Files per Agent | Reason |
|-----------|----------------|--------|
| Search/Read | 10-20 | Minimal reasoning |
| Code modification | 3-5 | Understanding + modification + verification |
| Complex refactoring | 1-2 | Most context on comprehension |

If budget exceeds ~80-100K tokens → split further. If room → merge small tasks.

**Orchestrator assignment:** extract tasks → build dependency graph → group into batches → estimate budget → split or merge.

### Cross-talk Protocol

1. All Review Agents complete independently
2. Orchestrator collects results
3. Orchestrator sends each reviewer the OTHER reviewers' findings
4. Reviewers report coherence issues
5. Orchestrator synthesizes into coherence verdict

### Integration Review (Intent Guardian)

After cross-talk:
1. Re-read user's original request (immovable anchor)
2. Compare each agent's work against that request
3. "Does all this together achieve what user asked?"
4. "Have reviewer suggestions shifted the work?"
5. **Accept** quality improvements; **override** drift from intent

---

## Processing Agent Responses

1. Does agent's understanding match your intent? → If not, re-instruct
2. Does result answer the question? → If not, follow up
3. Review Agent: specific evidence, not just "looks good"?
4. Does this response change your understanding?

---

## Anti-Patterns

| # | Pattern | Rule |
|---|---------|------|
| 1 | Orchestrator doing agent work | Analysis/planning/implementation/verification = agent tasks |
| 2 | Delegating understanding | Phase 1 is YOUR job |
| 3 | "File contains X" verification | Predict behavior, not text existence |
| 4 | Agents for grep | Deep analysis → agents. Text search → Grep/Glob |
| 5 | Proceeding without verification | "Probably understood" = gap |
| 6 | Ignoring small gaps | Small gaps → large rework |
| 7 | Trusting agent output blindly | Both Work and Review agents can have gaps |
| 8 | Modifying without plan update | Reality ≠ plan → fix plan first |
| 9 | "Partial success" | Only Pass/Fail. No middle ground |
| 10 | Understanding without inference | Can't predict consequences → don't understand |
| 11 | Shortcuts as "improvements" | Faster ≠ better |
| 12 | "Different from plan but better" | Stop → revise plan → approve → implement |
| 13 | Accepting proposals blindly | User proposals need understanding too |
| 14 | Skipping Phase 2 | No analysis = no understanding |
| 15 | "Can't verify without running" | Trace execution, compare state, analyze deps |
| 16 | Same agent for Work and Review | Reviewer needs fresh context |
| 17 | Vague review: "looks correct" | Require specific evidence |
| 18 | Skipping meta-verify spot-check | Non-negotiable. Read actual code for at least 1 item |
| 19 | Work without review | No Work Agent runs solo |
| 20 | Isolated parallel reviews | Cross-reference for coherence |
| 21 | Orchestrator as aggregator | Verify intent alignment, don't just compile |
| 22 | Token-first splitting | Split by module/feature first, tokens second |
| 23 | Reviewer-driven drift | Reviewers improve quality, not redefine goals |
| 24 | Intent erosion through iterations | Re-anchor to original request every meta-review |

---

## Quick Reference

```
Task → Phase 1: Understand (Orchestrator + User)
     → Phase 2-4: Analyze → Review → Meta-Review
     → Phase 5-7: Plan → Review → Meta-Review + Approve
     → Phase 7.5: Alternative (optional)
     → Phase 8-10: Implement → Verify → Meta-Verify
     → Phase 11: Report

3-Layer: Work Agent → Review Agent → Orchestrator (Intent Guardian)
Understanding = Gap closed + Consequences predicted
Orchestrator = Synthesize + Critique + Preserve original intent
If gap remains → do not proceed
If reviewer drifts from intent → accept quality, reject drift
```
