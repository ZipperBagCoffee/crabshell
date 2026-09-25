---
name: regressing
description: "Runs convergence-based iterative optimization cycles wrapped by a single Discussion. Use when a topic needs repeated improvement through plan-execute-verify-feedback loops. Invoke with /regressing \"topic\" N (N = cycle cap, not target). Cycles continue until convergence or cap. Not for one-shot tasks — do the work directly and record it with hotfix instead."
---

# Regressing Skill

## Core Philosophy: Result Improvement Through Iteration

> **Verification Philosophy:** Follows VERIFICATION-FIRST principle from RULES (Predict → Execute → Compare). When no project verification tool exists, invoke the 'verifying' skill.

> Cycles exist to improve the quality of results, not to progress through a work queue. Each cycle produces a complete result, verifies it, and the next cycle improves that result based on verified gaps.

### 3 Foundational Philosophies

| Philosophy | Source | Role in regressing |
|------|------|----------------------|
| **Iterative Optimization** | autoresearch | Each cycle: feedback → improvement. Output becomes input |
| **Parent-Owned Orchestration + Verification** | workflow | Parent-owned decisions, bounded delegation, runtime verification |
| **Document Tracing** | D/P/T | Every step is documented, enabling full traceability |

## Anti-Patterns (PROHIBITED)

Pre-partitioning, sequential pipeline, copy-paste feedback, parent abdication, rubber-stamp verification, delegation ritual, operational steps as separate cycles, autonomous writes outside scope. What each looks like and the correct alternative: `references/anti-patterns.md` — read it before writing a cycle plan. If any is detected, halt and restructure.


## Execution Procedure

### Step 1: Initialize

User invokes with `/regressing "topic"` or `/regressing "topic" N`.

- Run until convergence (Rule 7), with safety cap at 10 cycles. Cap is always 10 unless the user explicitly specifies a different number. Do not ask, do not infer from context.
- If user writes `/regressing "topic" 5`: cap is 5. If user writes `/regressing "topic"`: cap is 10. No exceptions.

### Step 2: Open Discussion (D)

Create ONE Discussion document that wraps the entire regressing session:

- Invoke `/discussing "topic"`
- D contains: Intent, Context, Intent Anchor (IA), goals, expected results
- D MUST contain a `## Convergence Criteria` section whose items are objectively checkable by reading project documents or running a command (document status, command exit code, numeric threshold). These criteria drive Rule 7 AND the host goal evaluator (Step 2.6) — vague criteria cause wrong termination.
- This D stays open throughout all cycles and closes at the end
- Metadata: `[regressing: cap {N}]`

After creating the Discussion document, write the regressing state file `.crabshell/memory/regressing-state.json` (`active`, `discussion`, `cycle: 1`, `totalCycles`, `phase: "planning"`, `ticketIds: []`, owning `sessionId`) — exact content and command: `references/session-start.md`.

### Step 2.5–2.6: Parameters and goal-mode handoff

Once, at session start: recommend the cycle cap (10 unless the user wrote a number), agents and model tiers (silence = proceed), then print the ready-to-paste `/goal` line that points at the D document. The recommendation block, inline-number rules and the exact `/goal` line: `references/session-start.md`.


### Step 3: Pre-check (optional)

- Check if related Investigation (I) documents exist
- I is independent — may or may not be included, at discretion
- I is pre-work outside the cycle loop

### Step 4: Cycle Loop

```
repeat until convergence or cap reached:
  Step 4a: Cycle plan (an entry in the D log)
  Step 4b: Ticketing (T)
  Step 4c: Ticket Execution
  Step 4d: Feedback Transfer
```

#### Step 4a: Cycle plan — an entry in the D log
- Invoke `/discussing D{NNN}` and append a `Cycle {n} plan` entry to the D document's log. The discussion carries the plan: new cycles create no plan document (existing P documents stay readable and searchable).
- The entry contains: **Intent** (what this cycle improves), **Context** (cycle 2+: the previous cycle's Next Direction), **Scope** (included / excluded), **Steps**, **Analysis** (the evidence inspected — files, functions, measurements), **Intent Check** (against D's IA, at least one risk, approve or reject).
- **Cycle 1**: the highest-impact improvements for the CURRENT state. MUST NOT pre-allocate or partition work across future cycles. The plan should be completable in this single cycle.
- **Cycle 2+**: respond directly to the diagnosed problems from the previous cycle — not a pre-determined schedule.
- The parent owns plan analysis: inspect the authoritative references, formulate the plan, and write the analysis into the entry. Optional review only for bounded independent work or a material risk; a reviewer receives the intent, scope and criteria, not your conclusions.
- **Quality Gate (BLOCKING):** Analysis and Intent Check are written in the entry before Step 4b. For discussion-based cycles no hook enforces this — it is this skill's rule. If optional review was used, record its evidence and your disposition of each finding.
- The `/discussing` call ends the planning phase: the PostToolUse hook moves the regressing state to `ticketing`. `planId` stays `null`.

#### Step 4b: Ticketing — Create T(n,1..M)
- Invoke `/ticketing D{NNN} "title"` one or more times to create tickets under the discussion. Ticket IDs (`D{NNN}_T{NNN}`) continue across cycles; the state file's `ticketIds` and the D log's cycle entries record which tickets belong to this cycle
- Ticket sizing: 3-5 acceptance criteria per ticket. Independent work items are separate tickets.
- A cycle plan with a single coherent work item produces one ticket; one with multiple independent work items produces multiple tickets.

After each /ticketing invocation, update regressing state:
- Append the new ticket's ID to `"ticketIds"` array, update `"lastUpdatedAt": "{ISO}"` using: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.ticketIds.push('{T-ID}');s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"` (phase transition is automatic via PostToolUse hook)

#### Step 4c: Ticket Execution
- Execute each T(n,m) using ticketing's parent-owned execution and verification flow.
- Each ticket is an independent execution cycle
- **Ticket execution ordering:** Dependent tickets (e.g., T002 depends on T001's file changes) MUST execute sequentially — T001 completes before T002 starts. Independent tickets MAY execute in parallel. The Orchestrator determines dependency order before execution begins.
- **Agent flow:** The parent owns each phase and delegates only bounded independent work when risk or latency justifies it. No worker count or WA:RA pairing is a completion condition.
- Parent executes in-scope work and appends execution evidence to the T document. Delegation is optional and bounded by the ticket contract.
  - **Framing:** Any delegated prompt follows ticketing framing and verification standards, names exact scope and non-goals, and forbids fan-out.
- Optional independent review, the Verification Tool Check (`/verifying run`), and the parent's final verification — Correctness, Coherence (at least 2 methods), Improvement Opportunities, the Evidence Gate, the independent-evidence cross-reference and Next Direction — follow `references/cycle-verification.md`; read it before each ticket's final verification. Default posture: skepticism; a worker/reviewer claim is never the completion condition.

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
- Pass the validated feedback into the next cycle plan entry's Context
- **Document-first rule:** Record the feedback transfer in the D document's Discussion Log (via `/discussing`) BEFORE beginning the next cycle plan. The document update is the primary action; conversation narration is secondary.
- This transfer is explicitly performed by the Orchestrator

After feedback transfer:
- If verification found gaps AND cycle < cap: Set fields using: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.cycle++;s.phase='planning';s.planId=null;s.ticketIds=[];s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"`
- **If cycle = cap AND cap was defaulted (not user-specified):** Present a progress report to the user summarizing what was achieved and what gaps remain. User decides: approve another 10 cycles (raises cap) or stop. If approved, update totalCycles: `s.totalCycles = s.cycle + 10`.
- If converged (Rule 7) OR cycle = cap (user-specified): proceed to Step 5

### Step 5: Close Discussion (D) + Final Report

After convergence or reaching the cap, return to the D document:

1. Append the Final Report to D's Discussion Log
- **Document-first rule:** Write the Final Report to the D document using the Edit tool FIRST. After the document is updated, provide a brief summary to the user. The document update is the primary output; the conversation summary is secondary.
2. Transition D to `concluded`

After final report, clean up regressing state:
- Delete state file: `"{NODE_PATH}" -e "try{require('fs').unlinkSync('{PROJECT_DIR}/.crabshell/memory/regressing-state.json')}catch(e){}"`

Final Report format (fill every field it names): `references/final-report.md`.

## Document Structure

One D wraps the session; each cycle adds one plan entry in the D log and one or more tickets `D{NNN}_T{NNN}` under the D; the D closes with the final report. Diagram and table: `references/document-structure.md`. Sessions started before this layout keep their P documents (`P{NNN}` plans with `P{NNN}_T{NNN}` tickets); guards and tools accept both parents.


## User Interaction

At start confirm the topic and cap; during the cycles work autonomously (Rule 5, and its notify exception); at the end present the final report. Details: `references/user-interaction.md`.

## Rules

1. **1 cycle = 1 plan entry in the D log + 1..M T.** Each cycle produces exactly one plan entry and one or more tickets. Ticket sizing: 3-5 acceptance criteria per ticket, independent work items are separate tickets. No steps may be skipped.
2. **One D wraps all cycles.** D opens at start, closes with final report at end. Do NOT create a new D per cycle.
3. **Verification-based Optimization.** No iteration without verification. Must verify at the end of each cycle, and verification results determine the next cycle.
4. **Context transfer between cycles is mandatory.** The Orchestrator must explicitly pass cycle n's final verification results as the Context of cycle n+1's plan entry.
5. **User intervention only at the end.** Do not ask for user confirmation during intermediate cycles. Exception — notify, do not ask: a limitation that changes what the user will get (scope cannot be met, a blocked dependency, the cap will be reached) is reported in one line at once; keep working.
6. **Use existing skill invocations.** Invoke discussing (at start, for each cycle plan entry and each feedback transfer) and ticketing skills internally.
7. **Early termination on convergence.** If the Orchestrator's verification finds no improvement opportunities with substantive justification (minimum 3 sentences enumerating what was examined and why further cycles would not improve the result), the session terminates early. Generic "ALL PASS" without this justification is not valid convergence — it is rubber-stamping. **When the wrapping D document contains a `## Convergence Criteria` section, the Orchestrator MUST evaluate each criterion explicitly — convergence is only valid when all listed criteria are met or explicitly declared out-of-scope with rationale.**
8. **A one-ticket discussion is the lightweight alternative.** Regressing is the primary mode; standalone one-off tasks are done directly and recorded as a discussion with one ticket.
9. **D's IA is the constant anchor.** Every cycle plan entry and T document references D's IA as read-only evaluation criteria throughout all cycles.
10. **Parent-owned orchestration.** The parent owns intent, implementation decisions, decisive verification, and completion. Delegate only bounded independent work when risk or latency justifies it; do not require a worker/reviewer pair or use agent count as evidence. Delegates do not fan out.
11. **Orchestrator anti-rubber-stamp.** The Orchestrator MUST provide substantive evaluation for each cycle. "No improvement opportunities" and "ALL PASS" without detailed justification are INVALID. When the Orchestrator genuinely finds no improvements, it must enumerate what was specifically examined and provide a reasoned argument (minimum 3 sentences) for why the output is optimal.
12. **Cycles are for result improvement, not sequential work progression.** Each cycle produces a complete result and verifies it. The next cycle's purpose is to improve the previous cycle's output based on verified gaps — not to continue with remaining work. Cycle 1's plan MUST NOT pre-allocate work across cycles. If a cycle plan divides total work into equal parts or references "what cycle N+1 will do," it is INVALID. The scope of cycle N+1 is unknown until cycle N's verification reveals what needs improvement. Cycle count is emergent — N is a safety cap, not a quota to fill. **Sequential tasks (version bump, cache sync, deploy) belong in the SAME cycle as the code change, as separate tickets — NOT as separate cycles.** A cycle is incomplete if it produces a code change without its operational follow-through.
13. **Distinct-risk review.** When multiple reviewers are useful, assign different risks rather than duplicating a checklist. The parent compares their independent evidence and resolves discrepancies; no reviewer count or cross-review ritual is a completion condition.
14. **Question-save-continue protocol.** When a question arises during ticket execution that would normally pause for user input: (1) Do NOT emit the question to the user. (2) Append the question as an `## Open Questions` entry to the active T document using Edit tool (document-first). Include: question text, local timestamp, context (which AC triggered the question). (3) Make a reasonable assumption to unblock execution — state the assumption in the T document entry. (4) Continue execution without waiting. Open questions are addressed by the next cycle's planning phase. Exception: questions about destructive actions (delete, reset, overwrite) MAY be emitted to the user — state the specific risk first.
