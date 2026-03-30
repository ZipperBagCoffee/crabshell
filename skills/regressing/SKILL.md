---
name: regressing
description: "Runs convergence-based iterative optimization cycles wrapped by a single Discussion. Use when a topic needs repeated improvement through plan-execute-verify-feedback loops. Invoke with /regressing \"topic\" N (N = cycle cap, not target). Cycles continue until convergence or cap. Not for one-shot tasks — use light-workflow instead."
---

# Regressing Skill

## Core Philosophy: Result Improvement Through Iteration

> **Verification Philosophy:** Follows VERIFICATION-FIRST principle from RULES (Predict → Execute → Compare). When no project verification tool exists, invoke the 'verifying' skill.

> Cycles exist to improve the quality of results, not to progress through a work queue. Each cycle produces a complete result, verifies it, and the next cycle improves that result based on verified gaps.

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
| **Pre-partitioning** | P(1) divides total work into N equal parts, assigning each to a cycle | P(1) addresses highest-impact improvements. P(2+) respond to verification gaps. Cycle count is emergent, not planned |
| **Sequential pipeline** | Cycle 1 = modify, Cycle 2 = sync, Cycle 3 = version bump | Sequential tasks (version bump, cache sync, deploy) belong in the SAME cycle as separate tickets — NOT as separate cycles. Each cycle is a complete implement-verify-improve loop |
| **Copy-paste feedback** | Next Direction says "continue with remaining items" | Next Direction diagnoses specific problems with evidence |
| **Role collapse** | Orchestrator performs Work Agent or Review Agent tasks directly | Each role is a separate Task tool invocation |
| **Rubber-stamp verification** | "ALL PASS — no improvement opportunities" | Orchestrator enumerates what was examined and why no improvements apply |
| **Single WA without justification** | One Work Agent handles all execution without stating why parallel WA does not apply | Parallel WA is the default. Single-WA requires explicit justification: "Single-WA because {reason}" |
| **Operational steps as separate cycles** | Cycle 1 = code change, Cycle 2 = version bump + cache sync + commit | Version bump, cache sync, and commit are operational steps within a cycle's ticket(s), not independent cycles |

If any of these patterns are detected during execution, the Orchestrator MUST halt and restructure before proceeding.

## Execution Procedure

### Step 1: Initialize

User invokes with `/regressing "topic"` or `/regressing "topic" N`.

- Run until convergence (Rule 7), with safety cap at 10 cycles. Cap is always 10 unless the user explicitly specifies a different number. Do not ask, do not infer from context.
- If user writes `/regressing "topic" 5`: cap is 5. If user writes `/regressing "topic"`: cap is 10. No exceptions.

### Step 2: Open Discussion (D)

Create ONE Discussion document that wraps the entire regressing session:

- Invoke `/discussing "topic"`
- D contains: Intent, Context, Intent Anchor (IA), goals, expected results
- This D stays open throughout all cycles and closes at the end
- Metadata: `[regressing: cap {N}]`

After creating the Discussion document, write the regressing state file:
- Path: `.crabshell/memory/regressing-state.json`
- Content: `{ "active": true, "discussion": "{D-ID}", "cycle": 1, "totalCycles": {N}, "userSpecifiedN": {true|false}, "phase": "planning", "planId": null, "ticketIds": [], "startedAt": "{ISO}", "lastUpdatedAt": "{ISO}" }`
- Use Bash tool: `"{NODE_PATH}" -e "require('fs').writeFileSync('{PROJECT_DIR}/.crabshell/memory/regressing-state.json', JSON.stringify({active:true, discussion:'{D-ID}', cycle:1, totalCycles:{N}, userSpecifiedN:{true|false}, phase:'planning', planId:null, ticketIds:[], startedAt:new Date().toISOString(), lastUpdatedAt:new Date().toISOString()}, null, 2))"`

### Step 3: Pre-check (optional)

- Check if related Investigation (I) documents exist
- I is independent — may or may not be included, at discretion
- I is pre-work outside the cycle loop

### Step 4: Cycle Loop

```
repeat until convergence or cap reached:
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

After /planning completes, update regressing state:
- Set `"planId": "{P-ID}"`, `"lastUpdatedAt": "{ISO}"` using: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.planId='{P-ID}';s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"` (phase transition is automatic via PostToolUse hook)

#### Step 4b: Ticketing — Create T(n,1..M)
- Invoke `/ticketing` one or more times per plan to create tickets from P(n)
- Ticket sizing: 3-5 acceptance criteria per ticket. Independent work items are separate tickets.
- A plan with a single coherent work item produces one ticket. A plan with multiple independent work items produces multiple tickets.

After each /ticketing invocation, update regressing state:
- Append the new ticket's ID to `"ticketIds"` array, update `"lastUpdatedAt": "{ISO}"` using: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.ticketIds.push('{T-ID}');s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"` (phase transition is automatic via PostToolUse hook)

#### Step 4c: Ticket Execution
- Execute each T(n,m) sequentially using ticketing's built-in agent structure (Work Agent → Review Agent → Orchestrator)
- Each ticket is an independent execution cycle
- **Ticket execution ordering:** Dependent tickets (e.g., T002 depends on T001's file changes) MUST execute sequentially — T001 completes before T002 starts. Independent tickets MAY execute in parallel. The Orchestrator determines dependency order before execution begins.
- **Agent flow:** Planning phase (Step 4a) is serial — WA analysis then RA review. Execution phase uses parallel WAs by default (ticketing Step A). Single-WA requires explicit justification in the Orchestrator's ticket execution log.
- Work Agent: execute tasks → append to T document
  - **Framing:** Agent prompts follow the parent skill's (ticketing/planning) framing and verification standards. See CLAUDE.md SCOPE DEFINITIONS.
- Review Agent (separate Task tool call): runtime verification (exhaustive level) → append to T document
  - **RA Count Rule:** RA count MUST equal WA count. WA 2개 → RA 2개. Each WA's output is reviewed by its own dedicated RA. Single RA reviewing multiple WAs' outputs is a pairing violation.
  - **Independence Protocol (MANDATORY):** The Review Agent prompt MUST NOT include Work Agent's Execution Results. Provide only: (1) Plan ID and acceptance criteria, (2) Verification criteria from ticket, (3) the P/O/G template below. The Review Agent performs independent verification first. After Review Agent completes, the Orchestrator cross-references RA findings against WA Execution Results — discrepancies are findings.
  - **Review Agent prompt MUST include this philosophical context and verification output template:**
    ```
    Verification = closing the gap between belief and reality through observation.
    Fill Prediction BEFORE looking at the code. Fill Observation ONLY from tool output.
    The Gap column is where real findings live — if Gap is always "none", you are confirming, not verifying.

    For each verification item, provide ALL fields:
    | Item | Type | Prediction (before observation) | Observation (tool output required) | Gap |
    |------|------|-------------------------------|-----------------------------------|-----|

    Type: `behavioral` = runtime execution observed (ran command, triggered feature, checked output)
    Type: `structural` = static check (grep, file read, code inspection)

    Rules:
    - Observation MUST include tool output (Bash execution, Read result, diff, etc.)
    - If Prediction and Observation are identical text → INVALID (no actual observation occurred)
    - If direct execution is impossible: state "Indirect: {method}" + why direct is impossible
    - Empty Observation or Gap fields → entire verification is INVALID
    ```
- **Verification Tool Check (BEFORE Orchestrator evaluation):**
  1. Check if `.crabshell/verification/manifest.json` exists
  2. If YES → `/verifying run` and include results in evaluation
  3. If NO → `/verifying` to create manifest, then `/verifying run`
  4. No executable runtime → skip with note
- Orchestrator: final verification → append to T document. MUST critically evaluate both Work and Review Agent outputs. Default posture: skepticism — "ALL PASS" requires more justification than "FAIL". Must provide substantive evaluation, not rubber-stamp approval.
  - Correctness: Was it done correctly? Cite specific evidence (command output, observed behavior).
  - Coherence: Do the changes from this cycle work together as a whole? Individual items may each pass, but combined output may have integration gaps. Verify that parts form a coherent whole, not just that each passes individually.
    **Coherence verification methods (minimum 2 of the following):**
    - **Cross-file sync check:** When the same concept appears in multiple files, grep for the concept in all locations and confirm consistent wording/semantics.
    - **Reference integrity:** When file A references file B's content, verify the reference target actually exists and matches.
    - **Integration test:** Run the changed code/hook and verify that outputs from multiple changed files interact correctly.
    - **Contradiction scan:** Explicitly check whether any two changes give contradictory instructions.
    - **Pipeline contradiction scan:** Check whether this change contradicts logic in related pipelines. Level 1: within the changed files. Level 2: in files that interact with the changed component (imports, callers, shared state). Level 3: against project rules/philosophy (CLAUDE.md, SKILL.md principles). A change that works locally but contradicts a related pipeline is not coherent.
    "Coherent" or "일관됨" as a one-line verdict without executing any of the above methods is INVALID.
  - Improvement Opportunities: What gaps remain? What was attempted but didn't work well? (Orchestrator MUST enumerate what was examined. "No improvements" requires detailed justification of what was checked and why no improvements apply — minimum 3 sentences referencing specific aspects.)
  - **Evidence Gate (BLOCKING — check BEFORE evaluating content):**
    Agents generate text that looks like verification without actual observation. Your gate exists to catch this.
    □ Does each verification item have Prediction, Observation, AND Gap fields?
    □ Does Observation contain tool output evidence? (for directly-executable items)
    □ Is Prediction ≠ Observation? (copy detection)
    □ For indirect verification: is the reason stated?
    □ Does at least 1 verification item have Type = behavioral? (structural-only = insufficient for runtime features)
    → If ANY check fails: REJECT Review Agent results and request re-verification
  - **RA/WA Cross-Reference (after Evidence Gate):**
    Compare Review Agent's independent findings against Work Agent's Execution Results.
    1. Read RA's P/O/G table findings
    2. Read WA's Execution Results
    3. Identify discrepancies — items where RA found problems WA didn't report, or where WA claimed success but RA found issues
    4. Discrepancies are the highest-priority findings and must be addressed in Correctness evaluation
  - Next Direction (while verification finds gaps and cycle < cap; final cycle uses Final Report instead):
    - **Problems Found**: Specific problems or shortcomings observed in THIS cycle's output, with evidence.
    - **Root Cause Hypothesis**: Why did these problems occur?
    - **Recommended Focus**: What should the next cycle prioritize and why?
    - (If this section reads like a generic TODO list without referencing specific observations from this cycle, it is INVALID — rewrite with evidence.)

After ticket execution completes, update regressing state:
- Set `"phase": "feedback"`, `"lastUpdatedAt": "{ISO}"` using: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.phase='feedback';s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"`

#### Step 4d: Feedback Transfer (Quality Gate)
- **Single ticket:** Extract T(n,1)'s `## Final Verification > Next Direction` directly.
- **Multiple tickets:** The Orchestrator synthesizes all tickets' `## Final Verification` sections into a unified Next Direction. The synthesis must integrate findings across tickets, not merely concatenate them.
- **Quality check before transfer:** The Orchestrator MUST verify the Next Direction (whether extracted or synthesized) contains:
  (1) Specific problems diagnosed with evidence from this cycle
  (2) Root cause hypothesis
  (3) Recommended focus with rationale
  If Next Direction is a generic TODO list without cycle-specific observations → REJECT and require re-evaluation.
- Pass validated feedback to next cycle P(n+1)'s Context
- This transfer is explicitly performed by the Orchestrator

After feedback transfer:
- If verification found gaps AND cycle < cap: Set fields using: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.cycle++;s.phase='planning';s.planId=null;s.ticketIds=[];s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"`
- **If cycle = cap AND cap was defaulted (not user-specified):** Present a progress report to the user summarizing what was achieved and what gaps remain. User decides: approve another 10 cycles (raises cap) or stop. If approved, update totalCycles: `s.totalCycles = s.cycle + 10`.
- If converged (Rule 7) OR cycle = cap (user-specified): proceed to Step 5

### Step 5: Close Discussion (D) + Final Report

After convergence or reaching the cap, return to the D document:

1. Append the Final Report to D's Discussion Log
2. Transition D to `concluded`

After final report, clean up regressing state:
- Delete state file: `"{NODE_PATH}" -e "try{require('fs').unlinkSync('{PROJECT_DIR}/.crabshell/memory/regressing-state.json')}catch(e){}"`

Final Report format:

```
### [{timestamp}] Regressing Final Report
Converged after {actual} cycles (cap: {N})
Termination reason: {convergence | cap reached | user stop}

**Gap Reduction:**
| Cycle | Gaps Identified | Gaps Resolved | Key Improvement |
|-------|----------------|---------------|-----------------|
| 1     | ...            | ...           | ...             |
| ...   | ...            | ...           | ...             |

**Improvement Trajectory:**
- Cycle 1→2: {key changes}
- Cycle 2→3: {key changes}

**Final State:**
- Achieved: ...
- Remaining gaps: ...
- Future recommendations: ...
```

## Document Structure

One D wraps the entire session. Each cycle creates one P + one or more T:

```
D (open)
  → P(1) → T(1,1), T(1,2), ...    [cycle 1]
  → P(2) → T(2,1)                  [cycle 2]
  → ...
  → P(N) → T(N,1), T(N,2), ...    [cycle N]
D (closed with final report)
```

| Document | Count | Role |
|----------|-------|------|
| D | 1 | Top-level container: intent, IA, final report |
| P | N | One per cycle: plan based on D's IA + previous feedback |
| T | >= N | One or more per cycle: execution + verification |

## User Interaction

- **At start**: Confirm topic. Cap is 10 unless user explicitly wrote a number. Do not infer cap from context, memory, or past sessions.
- **During**: Fully autonomous. Terminates on convergence (Rule 7) or when cap is reached. At every 10-cycle boundary (when cap was defaulted), present progress report — user approves raising cap by 10 or stops.
- **At end**: Present final report in D → user requests raising cap or terminates

## Rules

1. **1 cycle = 1 P + 1..M T.** Each cycle produces exactly one plan and one or more tickets. Ticket sizing: 3-5 acceptance criteria per ticket, independent work items are separate tickets. No steps may be skipped.
2. **One D wraps all cycles.** D opens at start, closes with final report at end. Do NOT create a new D per cycle.
3. **Verification-based Optimization.** No iteration without verification. Must verify at the end of each cycle, and verification results determine the next cycle.
4. **T→P context transfer is mandatory.** The Orchestrator must explicitly pass T(n)'s final verification results as Context to P(n+1).
5. **User intervention only at the end.** Do not ask for user confirmation during intermediate cycles.
6. **Use existing skill invocations.** Invoke discussing (once at start), planning, and ticketing skills internally.
7. **Early termination on convergence.** If the Orchestrator's verification finds no improvement opportunities with substantive justification (minimum 3 sentences enumerating what was examined and why further cycles would not improve the result), the session terminates early. Generic "ALL PASS" without this justification is not valid convergence — it is rubber-stamping.
8. **Light-workflow is a lightweight reference.** Regressing is the primary mode; light-workflow is for standalone one-off tasks.
9. **D's IA is the constant anchor.** All P and T documents reference D's IA as read-only evaluation criteria throughout all cycles.
10. **Agent independence via Task tool.** Work Agent and Review Agent MUST each be launched as separate Task tool invocations. The Orchestrator (main conversation) MUST NOT perform Work or Review tasks itself. Collapsing roles violates agent pairing.
11. **Orchestrator anti-rubber-stamp.** The Orchestrator MUST provide substantive evaluation for each cycle. "No improvement opportunities" and "ALL PASS" without detailed justification are INVALID. When the Orchestrator genuinely finds no improvements, it must enumerate what was specifically examined and provide a reasoned argument (minimum 3 sentences) for why the output is optimal.
12. **Cycles are for result improvement, not sequential work progression.** Each cycle produces a complete result and verifies it. The next cycle's purpose is to improve the previous cycle's output based on verified gaps — not to continue with remaining work. P(1) MUST NOT pre-allocate work across cycles. If P(n) divides total work into equal parts or references "what cycle N+1 will do," it is INVALID. The scope of cycle N+1 is unknown until cycle N's verification reveals what needs improvement. Cycle count is emergent — N is a safety cap, not a quota to fill. **Sequential tasks (version bump, cache sync, deploy) belong in the SAME cycle as the code change, as separate tickets — NOT as separate cycles.** A cycle is incomplete if it produces a code change without its operational follow-through.
13. **Cross-review integration.** When ticket or plan execution involves 2+ parallel review agents, cross-review is MANDATORY before Orchestrator evaluation. The Orchestrator must verify whether cross-review conditions were met. When only 1 Review Agent runs, it MUST include a "Devil's Advocate" section articulating the strongest counter-argument to its own conclusions.
