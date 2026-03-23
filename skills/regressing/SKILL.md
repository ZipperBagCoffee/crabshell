---
name: regressing
description: "Runs autonomous iterative optimization cycles wrapped by a single Discussion. Use when a topic needs repeated improvement through plan-execute-verify-feedback loops. Invoke with /regressing \"topic\" N to run N cycles of P→T. Not for one-shot tasks — use light-workflow instead."
---

# Regressing Skill

## Core Philosophy: Verification-based Optimization

> **Verification Philosophy:** Follows VERIFICATION-FIRST principle from RULES (Predict → Execute → Compare). When no project verification tool exists, invoke the 'verifying' skill.

> Verification-based optimization — each cycle's verification results determine the optimization direction for the next cycle.

### 3 Foundational Philosophies

| Philosophy | Source | Role in regressing |
|------|------|----------------------|
| **Iterative Optimization** | autoresearch | Each cycle: feedback → improvement. Output becomes input |
| **Agent Structure + Verification** | workflow | Work/Review/Orchestrator pattern, runtime verification |
| **Document Tracing** | D/P/T | Every step is documented, enabling full traceability |

## Anti-Patterns (PROHIBITED)

The following patterns indicate regressing has degenerated into sequential batch execution:

| Anti-Pattern | What it looks like | Correct alternative |
|---|---|---|
| **Pre-partitioning** | P(1) divides total work into N equal parts, assigning each to a cycle | P(1) addresses all work. P(2+) respond to verification findings |
| **Sequential pipeline** | Cycle 1 = modify, Cycle 2 = sync, Cycle 3 = version bump | Each cycle is a complete implement-verify-improve loop |
| **Copy-paste feedback** | Next Direction says "continue with remaining items" | Next Direction diagnoses specific problems with evidence |
| **Role collapse** | Orchestrator performs Work Agent or Review Agent tasks directly | Each role is a separate Task tool invocation |
| **Rubber-stamp verification** | "ALL PASS — no improvement opportunities" | Orchestrator enumerates what was examined and why no improvements apply |

If any of these patterns are detected during execution, the Orchestrator MUST halt and restructure before proceeding.

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
- **Cycle 1**: Plan addresses the highest-impact improvements for the CURRENT state. MUST NOT pre-allocate or partition work across future cycles. Plan should be completable in this single cycle.
- **Cycle 2+**: P(n) Context MUST include T(n-1)'s `## Final Verification > Next Direction`. Plan MUST directly respond to diagnosed problems from the previous cycle — not continue a pre-determined schedule.
- Work Agent (separate Task tool call): analysis + planning → append to P document
- Review Agent (separate Task tool call): plan verification + CHECK that plan does not pre-partition work across future cycles → append to P document
- Orchestrator: intent check against D's IA. REJECT plans that pre-allocate future cycle work → append to P document
- **Quality Gate (BLOCKING):** Plan agent sections (Analysis Results, Review Results, Intent Check) MUST ALL be populated before proceeding to Step 4b. Empty agent sections indicate the Plan quality gate was bypassed — the Orchestrator MUST halt and run the missing agents.
- After approval, proceed to ticket creation

#### Step 4b: Ticketing — Create T(n)
- Invoke `/ticketing`, create ticket from P(n)

#### Step 4c: Ticket Execution
- Execute T(n) using ticketing's built-in agent structure (Work Agent → Review Agent → Orchestrator)
- Work Agent: execute tasks → append to T document
- Review Agent (separate Task tool call): runtime verification (exhaustive level) → append to T document
  - **Independence Protocol (MANDATORY):** The Review Agent prompt MUST NOT include Work Agent's Execution Results. Provide only: (1) Plan ID and acceptance criteria, (2) Verification criteria from ticket, (3) the P/O/G template below. The Review Agent performs independent verification first. After Review Agent completes, the Orchestrator cross-references RA findings against WA Execution Results — discrepancies are findings.
  - **Review Agent prompt MUST include this philosophical context and verification output template:**
    ```
    Verification = closing the gap between belief and reality through observation.
    Fill Prediction BEFORE looking at the code. Fill Observation ONLY from tool output.
    The Gap column is where real findings live — if Gap is always "none", you are confirming, not verifying.

    For each verification item, provide ALL THREE fields:
    | Item | Prediction (before observation) | Observation (tool output required) | Gap |
    |------|-------------------------------|-----------------------------------|-----|

    Rules:
    - Observation MUST include tool output (Bash execution, Read result, diff, etc.)
    - If Prediction and Observation are identical text → INVALID (no actual observation occurred)
    - If direct execution is impossible: state "Indirect: {method}" + why direct is impossible
    - Empty Observation or Gap fields → entire verification is INVALID
    ```
- Orchestrator: final verification → append to T document. MUST critically evaluate both Work and Review Agent outputs. Default posture: skepticism — "ALL PASS" requires more justification than "FAIL". Must provide substantive evaluation, not rubber-stamp approval.
  - Correctness: Was it done correctly? Cite specific evidence (command output, observed behavior).
  - Improvement Opportunities: What gaps remain? What was attempted but didn't work well? (Orchestrator MUST enumerate what was examined. "No improvements" requires detailed justification of what was checked and why no improvements apply — minimum 3 sentences referencing specific aspects.)
  - **Evidence Gate (BLOCKING — check BEFORE evaluating content):**
    Agents generate text that looks like verification without actual observation. Your gate exists to catch this.
    □ Does each verification item have Prediction, Observation, AND Gap fields?
    □ Does Observation contain tool output evidence? (for directly-executable items)
    □ Is Prediction ≠ Observation? (copy detection)
    □ For indirect verification: is the reason stated?
    → If ANY check fails: REJECT Review Agent results and request re-verification
  - **RA/WA Cross-Reference (after Evidence Gate):**
    Compare Review Agent's independent findings against Work Agent's Execution Results.
    1. Read RA's P/O/G table findings
    2. Read WA's Execution Results
    3. Identify discrepancies — items where RA found problems WA didn't report, or where WA claimed success but RA found issues
    4. Discrepancies are the highest-priority findings and must be addressed in Correctness evaluation
  - Next Direction (cycles 1 through N-1 only; cycle N uses Final Report instead):
    - **Problems Found**: Specific problems or shortcomings observed in THIS cycle's output, with evidence.
    - **Root Cause Hypothesis**: Why did these problems occur?
    - **Recommended Focus**: What should the next cycle prioritize and why?
    - (If this section reads like a generic TODO list without referencing specific observations from this cycle, it is INVALID — rewrite with evidence.)

#### Step 4d: Feedback Transfer (Quality Gate)
- Extract T(n)'s `## Final Verification > Next Direction`
- **Quality check before transfer:** The Orchestrator MUST verify Next Direction contains:
  (1) Specific problems diagnosed with evidence from this cycle
  (2) Root cause hypothesis
  (3) Recommended focus with rationale
  If Next Direction is a generic TODO list without cycle-specific observations → REJECT and require re-evaluation.
- Pass validated feedback to next cycle P(n+1)'s Context
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
10. **Agent independence via Task tool.** Work Agent and Review Agent MUST each be launched as separate Task tool invocations. The Orchestrator (main conversation) MUST NOT perform Work or Review tasks itself. Collapsing roles violates agent pairing.
11. **Orchestrator anti-rubber-stamp.** The Orchestrator MUST provide substantive evaluation for each cycle. "No improvement opportunities" and "ALL PASS" without detailed justification are INVALID. When the Orchestrator genuinely finds no improvements, it must enumerate what was specifically examined and provide a reasoned argument (minimum 3 sentences) for why the output is optimal.
12. **Cycles are iterative, not partitioned.** Each P(n) MUST plan work for ONE cycle only. P(1) MUST NOT pre-allocate work across all N cycles. If P(n) divides total work into equal parts or references "what cycle N+1 will do," it is INVALID. The scope of cycle N+1 is unknown until cycle N's verification completes.
13. **Cross-review integration.** When ticket or plan execution involves 2+ parallel review agents, cross-review is MANDATORY before Orchestrator evaluation. The Orchestrator must verify whether cross-review conditions were met. When only 1 Review Agent runs, it MUST include a "Devil's Advocate" section articulating the strongest counter-argument to its own conclusions.
