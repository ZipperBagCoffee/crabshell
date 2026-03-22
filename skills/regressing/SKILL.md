---
name: regressing
description: "Autonomous D-PT loop with verification-based optimization. Use when iterative improvement is needed. Invoke with /regressing \"topic\" N to run N cycles of plan→ticket→execute→feedback, wrapped by a single Discussion."
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

### Step 2: Open Discussion (D)

Create ONE Discussion document that wraps the entire regressing session:

- Invoke `/discussing "topic"`
- D contains: Intent, Context, Intent Anchor (IA), goals, expected results
- This D stays open throughout all cycles and closes at the end
- Metadata: `[regressing: {N} cycles]`

### Step 3: Pre-check (optional)

- Check if related Investigation (I) documents exist
- I is independent — may or may not be included, at discretion
- I is pre-work outside the cycle loop

### Step 4: Cycle Loop

```
for cycle in 1..N:
  Step 4a: Planning (P)
  Step 4b: Ticketing (T)
  Step 4c: Ticket Execution
  Step 4d: Feedback Transfer
```

#### Step 4a: Planning — Create P(n)
- Invoke `/planning`, formulate plan based on D's IA
- Cycle 2+: P(n) Context includes T(n-1)'s `## Final Verification > Next Direction`
- Work Agent: analysis + planning → append to P document
- Review Agent: plan verification → append to P document
- Orchestrator: intent check against D's IA → append to P document
- After approval, proceed to ticket creation

#### Step 4b: Ticketing — Create T(n)
- Invoke `/ticketing`, create ticket from P(n)

#### Step 4c: Ticket Execution
- Execute T(n) using ticketing's built-in agent structure (Work Agent → Review Agent → Orchestrator)
- Work Agent: execute tasks → append to T document
- Review Agent: runtime verification (exhaustive level) → append to T document
- Orchestrator: final verification → append to T document
  - Correctness: Was it done correctly?
  - Improvement Opportunities: Was there a better approach?
  - Next Direction: What should be done next?

#### Step 4d: Feedback Transfer
- Extract T(n)'s `## Final Verification > Next Direction`
- Pass directly to next cycle P(n+1)'s Context
- This transfer is explicitly performed by the Orchestrator

### Step 5: Close Discussion (D) + Final Report

After completing N cycles, return to the D document:

1. Append the Final Report to D's Discussion Log
2. Transition D to `concluded`

Final Report format:

```
### [{timestamp}] Regressing Final Report
Total {N} cycles completed

**IA Achievement:**
| Cycle | IA-1 | IA-2 | ... | Overall |
|-------|------|------|-----|---------|
| 1     | ...  | ...  |     | ...     |
| N     | ...  | ...  |     | ...     |

**Improvement Trajectory:**
- Cycle 1→2: {key changes}
- Cycle 2→3: {key changes}

**Final State:**
- Achieved: ...
- Not achieved: ...
- Future recommendations: ...
```

## Document Structure

One D wraps the entire session. Each cycle creates one P + one T:

```
D (open)
  → P(1) → T(1)    [cycle 1]
  → P(2) → T(2)    [cycle 2]
  → ...
  → P(N) → T(N)    [cycle N]
D (closed with final report)
```

| Document | Count | Role |
|----------|-------|------|
| D | 1 | Top-level container: intent, IA, final report |
| P | N | One per cycle: plan based on D's IA + previous feedback |
| T | N | One per cycle: execution + verification |

## User Interaction

- **At start**: Confirm topic + number of cycles
- **During**: No user intervention (fully autonomous)
- **At end**: Present final report in D → user requests additional cycles or terminates

## Rules

1. **1 cycle = 1 P + 1 T.** No steps may be skipped.
2. **One D wraps all cycles.** D opens at start, closes with final report at end. Do NOT create a new D per cycle.
3. **Verification-based Optimization.** No iteration without verification. Must verify at the end of each cycle, and verification results determine the next cycle.
4. **T→P context transfer is mandatory.** The Orchestrator must explicitly pass T(n)'s final verification results as Context to P(n+1).
5. **User intervention only at the end.** Do not ask for user confirmation during intermediate cycles.
6. **Use existing skill invocations.** Invoke discussing (once at start), planning, and ticketing skills internally.
7. **Early termination only on user request.** No automatic convergence detection (v1).
8. **Light-workflow is a lightweight reference.** Regressing is the primary mode; light-workflow is for standalone one-off tasks.
9. **D's IA is the constant anchor.** All P and T documents reference D's IA as read-only evaluation criteria throughout all cycles.
