---
name: regressing
description: "Autonomous D→P→T loop with verification-based optimization. Use when iterative improvement is needed. Invoke with /regressing \"topic\" N to run N cycles of discuss→plan→ticket→workflow→feedback."
---

# Regressing Skill

## Core Philosophy: Verification-based Optimization

> **Verification Philosophy:** Verification = closing the gap between belief and reality through observation. Direct execution + observation is the top priority; indirect means only when direct execution is impractical.

> Verification-based optimization — each cycle's verification results determine the optimization direction for the next cycle.

### 3 Foundational Philosophies

| Philosophy | Source | Role in regressing |
|------|------|----------------------|
| **Iterative Optimization** | autoresearch | Each cycle: feedback → improvement. Output becomes input |
| **Agent Structure + Verification** | workflow | Work/Review/Orchestrator pattern, runtime verification |
| **Document Tracing** | D/P/T | Every step is documented, enabling full traceability |

## Execution Procedure

### Step 1: Initialize

User invokes with `/regressing "topic"` or `/regressing "topic" N`.

- If N is not specified: ask "How many cycles should I run?"
- If N is specified: proceed immediately

### Step 2: Pre-check (optional)

- Check if related Research (R) documents exist
- If none exist, ask the user whether preliminary research is needed
- R is independent pre-work outside the loop

### Step 3: Cycle Loop

```
for cycle in 1..N:
  Step 3a: Discussion (D)
  Step 3b: Planning (P)
  Step 3c: Ticketing (T)
  Step 3d: Workflow Execution
  Step 3e: Feedback Transfer
```

#### Step 3a: Discussion — Create D(n)
- Cycle 1: invoke `/discussing "topic [cycle 1/N]"`, based on user intent
- Cycle 2+: invoke `/discussing "topic [cycle n/N]"`
  - Context includes previous T(n-1)'s `## Final Verification > Next Direction` content
- Define Intent Anchor (IA) in D document
- Metadata: `[regressing cycle: {n}/{N}]`

#### Step 3b: Planning — Create P(n)
- Invoke `/planning`, formulate plan based on D(n)
- Work Agent: analysis + planning → append to P document
- Review Agent: plan verification → append to P document
- Orchestrator: intent check against D(n)'s IA → append to P document
- After approval, proceed to ticket creation

#### Step 3c: Ticketing — Create T(n)
- Invoke `/ticketing`, create ticket from P(n)

#### Step 3d: Workflow Execution
- Invoke `/workflow`, execute T(n)
- Work Agent: execute tasks → append to T document
- Review Agent: runtime verification (exhaustive level) → append to T document
- Orchestrator: final verification → append to T document
  - Correctness: Was it done correctly?
  - Improvement Opportunities: Was there a better approach?
  - Next Direction: What should be done next?

#### Step 3e: Feedback Transfer
- Extract T(n)'s `## Final Verification > Next Direction`
- Pass to next cycle D(n+1)'s `## Context` section
- This transfer is explicitly performed by the Orchestrator

### Step 4: Final Report

After completing N cycles, present the final report to the user:

```
## Regressing Final Report: {topic}
Total {N} cycles completed

### IA Achievement
| Cycle | IA-1 | IA-2 | ... | Overall |
|-------|------|------|-----|------|
| 1     | ...  | ...  |     | ...  |
| N     | ...  | ...  |     | ...  |

### Improvement Trajectory
- Cycle 1→2: {key changes}
- Cycle 2→3: {key changes}

### Final State
- Achieved: ...
- Not achieved: ...
- Future recommendations: ...
```

## Document Naming Convention

A new document set is created for each cycle:

| Cycle | Discussion | Plan | Ticket |
|-------|-----------|------|--------|
| 1 | D{next} | P{next} | P{n}_T001 |
| 2 | D{next+1} | P{next+1} | P{n}_T001 |
| N | D{next+N-1} | P{next+N-1} | P{n}_T001 |

All documents include metadata: `[regressing session: {timestamp}, cycle: {n}/{N}]`

## User Interaction

- **At start**: Confirm topic + number of cycles
- **During**: No user intervention (fully autonomous)
- **At end**: Present final report → user requests additional cycles or terminates

## Rules

1. **1 cycle = 1 D + 1 P + 1 T + 1 Workflow execution.** No steps may be skipped.
2. **New document set per cycle.** Create new D/P/T instead of appending to existing documents.
3. **Verification-based Optimization.** No iteration without verification. Must verify at the end of each cycle, and verification results determine the next cycle.
4. **T→D context transfer is mandatory.** The Orchestrator must explicitly pass T(n)'s final verification results as Context to D(n+1).
5. **User intervention only at the end.** Do not ask for user confirmation during intermediate cycles.
6. **Use existing skill invocations.** Invoke discussing, planning, ticketing, and workflow skills internally.
7. **Early termination only on user request.** No automatic convergence detection (v1).
8. **Workflow is a lightweight reference.** Regressing is the primary mode; workflow is for standalone one-off tasks.
