---
name: regressing
description: "Runs convergence-based iterative optimization cycles wrapped by a single Discussion. Use when a topic needs repeated improvement through plan-execute-verify-feedback loops. Invoke with /regressing \"topic\" N (N = cycle cap, not target). Cycles continue until convergence or cap. Not for one-shot tasks — use a discussion with a Plan and one ticket instead."
---

# Regressing Skill

## Core Philosophy: Result Improvement Through Iteration

Follow the RULES' VERIFICATION-FIRST principle: predict, execute, compare. When the project has no verification tool, invoke the 'verifying' skill.

Each cycle produces a complete result and verifies it. The next cycle improves that result from the verified gaps. Cycles are not steps through a work queue.

### 3 Foundational Philosophies

- **Iterative Optimization:** each cycle's output and feedback are the next cycle's input.
- **Parent-Owned Orchestration + Verification:** the parent decides, independent parts run as parallel workers, and verification runs the real thing.
- **Document Tracing:** every step is written down in the D and T documents.

## Anti-Patterns (PROHIBITED)

Pre-partitioning, sequential pipeline, copy-paste feedback, parent abdication, rubber-stamp verification, delegation ritual, operational steps as separate cycles, autonomous writes outside scope. Read `references/anti-patterns.md` before writing a cycle plan; it shows what each looks like and the correct alternative. If any is detected during execution, halt and restructure before proceeding.

## Execution Procedure

### Step 1: Initialize

The user invokes `/regressing "topic"` or `/regressing "topic" N`.

- Run until convergence (Rule 7), with a safety cap of 10 cycles. The cap is always 10 unless the user explicitly wrote a different number: `/regressing "topic" 5` has cap 5; `/regressing "topic"` has cap 10. Do not ask, and do not infer the cap from context. No exceptions.

### Step 2: Open Discussion (D)

Create ONE Discussion document that wraps the whole session:

- Invoke `/discussing "topic"`.
- D contains: Intent, Context, Intent Anchor (IA), goals, expected results.
- D MUST contain a `## Convergence Criteria` section. Each item must be objectively checkable by reading project documents or running a command: document status, command exit code, numeric threshold. Rule 7 and the host goal evaluator (Step 2.6) use these criteria; vague criteria end the session at the wrong time.
- D stays open through all cycles and closes at the end.
- Metadata: `[regressing: cap {N}]`

After creating D, write the state file `.crabshell/memory/regressing-state.json` (`active`, `discussion`, `cycle: 1`, `totalCycles`, `phase: "planning"`, `ticketIds: []`, owning `sessionId`). Exact content and command: `references/session-start.md`.

### Step 2.5–2.6: Parameters and goal-mode handoff

Once, at session start, recommend the cycle cap (10 unless the user wrote a number), workers and model tiers. Silence means proceed. Then print the ready-to-paste `/goal` line that points at the D document. The recommendation block, inline-number rules and the exact `/goal` line: `references/session-start.md`.

### Step 3: Pre-check (optional)

- Check whether related Investigation (I) documents exist. Including them is optional.
- I documents are pre-work outside the cycle loop.

### Step 4: Cycle Loop

```
repeat until convergence or cap reached:
  Step 4a: Cycle plan (an entry in the D log)
  Step 4b: Ticketing (T)
  Step 4c: Ticket Execution
  Step 4d: Feedback Transfer
```

#### Step 4a: Cycle plan — an entry in the D log
- Invoke `/discussing D{NNN}` and append a `Cycle {n} plan` entry to the D log. New cycles create no plan document; existing P documents stay readable and searchable.
- The entry contains: **Intent** (what this cycle improves), **Context** (cycle 2+: the previous cycle's Next Direction), **Scope** (included / excluded), **Steps**, **Reader Structure:** (structuring skill, or none: reason), **Analysis** (evidence inspected), **Intent Check** (against D's IA, at least one risk, approve or reject).
- **Design lines** (**Values:**, **Structure:**, **Start state:**, **User burden:**, **Design review:** — see the discussing skill) sit once in the discussion's `## Plan`. A cycle that changes the design adds a `Plan revision` entry carrying them.
- **Cycle 1**: plan the highest-impact improvements for the CURRENT state, completable in this cycle. MUST NOT pre-allocate or partition work across future cycles.
- **Cycle 2+**: respond directly to the problems the previous cycle diagnosed, not to a set schedule.
- The parent owns plan analysis: inspect the authoritative references, write the plan and its analysis into the entry. Beyond the design review, use optional review only for bounded independent work or a material risk. Give a reviewer the intent, scope and criteria, not your conclusions.
- **Quality Gate (BLOCKING):** write Analysis and Intent Check in the entry before Step 4b. No hook checks these two; the docs guard does block a new ticket while the Plan lacks its design lines. If you used optional review, record its evidence and how you handled each finding.
- The `/discussing` call ends the planning phase: the PostToolUse hook moves the regressing state to `ticketing`. `planId` stays `null`.

#### Step 4b: Ticketing — Create T(n,1..M)
- Invoke `/ticketing D{NNN} "title"` once per ticket under the discussion. Ticket IDs (`D{NNN}_T{NNN}`) continue across cycles. The state file's `ticketIds` and the D log's cycle entries record which tickets belong to this cycle.
- Give each ticket 3-5 acceptance criteria. Put independent work items in separate tickets; a single coherent work item is one ticket.

After each /ticketing invocation, update the regressing state. Append the new ticket's ID to `"ticketIds"` and set `"lastUpdatedAt": "{ISO}"` with: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.ticketIds.push('{T-ID}');s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"`. The PostToolUse hook moves the phase.

#### Step 4c: Ticket Execution
- Execute each T(n,m) with ticketing's parent-owned execution and verification flow. Each ticket is its own independent execution.
- **Ticket execution ordering:** The parent sets the dependency order before execution begins. Dependent tickets MUST run in order: if T002 needs T001's file changes, T001 completes before T002 starts. Independent tickets MAY run in parallel.
- The parent owns each phase, executes in-scope work and appends execution evidence to the T document. Work given to a worker follows the ticket contract.
  - **Framing:** Every delegated prompt (worker or reviewer) follows ticketing framing and verification standards, names exact scope and non-goals, and forbids fan-out.
- Before each ticket's final verification, read and follow `references/cycle-verification.md`. It covers optional independent review, the check run, and the parent's final verification: Correctness, Coherence, Improvement Opportunities, the evidence record, Intent Fidelity (the result against D's IA and the cycle plan) and Next Direction. Default posture: skepticism. A worker's or reviewer's claim is never the completion condition.

After ticket execution, update the regressing state. Set `"phase": "feedback"` and `"lastUpdatedAt": "{ISO}"` with: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.phase='feedback';s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"`

#### Step 4d: Feedback Transfer (Quality Gate)
The parent performs the transfer explicitly:
- **Single ticket:** take T(n,1)'s `## Final Verification > Next Direction` directly.
- **Multiple tickets:** synthesize all tickets' `## Final Verification` sections into one Next Direction. Integrate findings across tickets; do not just concatenate them.
- **Quality check before transfer:** The parent MUST verify that the Next Direction, whether extracted or synthesized, contains:
  (1) Specific problems diagnosed with evidence from this cycle
  (2) Root cause hypothesis
  (3) Recommended focus with rationale
  (4) Every partial or departed Intent Fidelity row — the deviation from D
  If it is a generic TODO list without cycle-specific observations, REJECT it and re-evaluate.
- **Document-first rule:** Record the feedback transfer in the D document's Discussion Log (via `/discussing`) BEFORE beginning the next cycle plan.
- Pass the validated feedback into the next cycle plan entry's Context (Rule 4).

After feedback transfer:
- If verification found gaps AND cycle < cap, set the fields with: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.cycle++;s.phase='planning';s.planId=null;s.ticketIds=[];s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"`
- **If cycle = cap AND the user did not set the cap:** present a progress report: what was achieved and which gaps remain. The user approves another 10 cycles or stops. If approved, set `s.totalCycles = s.cycle + 10`.
- If converged (Rule 7), or cycle = cap and the user set the cap: go to Step 5.

### Step 5: Close Discussion (D) + Final Report

After convergence or reaching the cap, return to the D document:

1. Append the Final Report to D's Discussion Log.
- **Document-first rule:** Write the Final Report to the D document with the Edit tool FIRST. Then give the user a brief summary.
2. Transition D to `concluded`.

Then delete the state file: `"{NODE_PATH}" -e "try{require('fs').unlinkSync('{PROJECT_DIR}/.crabshell/memory/regressing-state.json')}catch(e){}"`

Final Report format (fill every field it names): `references/final-report.md`.

## Document Structure

One D wraps the session. Each cycle adds one plan entry in the D log and one or more tickets `D{NNN}_T{NNN}` under the D. The D closes with the final report. Diagram and table: `references/document-structure.md`. Sessions started before this layout keep their P documents (`P{NNN}` plans with `P{NNN}_T{NNN}` tickets); guards and tools accept both parents.

## User Interaction

At start, confirm the topic and cap. During the cycles, work autonomously (Rule 5 and its notify exception). At the end, present the final report. Details: `references/user-interaction.md`.

## Rules

1. **1 cycle = 1 plan entry in the D log + 1..M T.** Each cycle produces exactly one plan entry and one or more tickets, sized as Step 4b says. Skip no step.
2. **One D wraps all cycles.** D opens at start and closes with the final report. Do NOT create a new D per cycle.
3. **Verification-based Optimization.** No iteration without verification. Verify at the end of each cycle; the results decide the next cycle.
4. **Context transfer between cycles is mandatory.** The parent MUST explicitly pass cycle n's final verification results as the Context of cycle n+1's plan entry.
5. **User intervention only at the end.** Do not ask for user confirmation during intermediate cycles. Exception, notify without asking: report at once, in one line, a limitation that changes what the user will get, such as scope that cannot be met, a blocked dependency, or that the cap will be reached. Keep working.
6. **Use existing skill invocations.** Invoke the discussing skill internally at start, for each cycle plan entry and for each feedback transfer. Invoke the ticketing skill internally for tickets.
7. **Early termination on convergence.** End early when the parent's verification finds no improvement opportunities, naming what was examined and why further cycles would not improve the result. A bare "ALL PASS" is rubber-stamping, not convergence. **When D has a `## Convergence Criteria` section, the parent MUST evaluate each criterion explicitly. Convergence is valid only when every listed criterion is met or explicitly declared out of scope with a reason.**
8. **A one-ticket discussion is the lightweight alternative.** Regressing is the primary mode. Do a standalone one-off task directly and record it as a discussion with one ticket.
9. **D's IA is the constant anchor.** Every cycle plan entry and T document uses D's IA as read-only evaluation criteria throughout all cycles.
10. **Parent-owned orchestration.** The parent owns intent, implementation decisions, decisive verification and completion. Independent parts (different files, no shared result) run as parallel workers. Do not require a worker/reviewer pair, and do not use worker count or WA:RA pairing as evidence. Workers and reviewers do not fan out.
11. **Parent anti-rubber-stamp.** Each cycle gets a substantive evaluation. "No improvement opportunities" or "ALL PASS" is valid only with what was specifically examined and why the output cannot be improved.
12. **Cycles are for result improvement, not sequential work progression.** The next cycle improves the previous output from verified gaps; it does not continue with remaining work. A cycle plan that divides total work into equal parts or names "what cycle N+1 will do" is INVALID. Cycle N+1's scope is unknown until cycle N's verification. N is a safety cap, not a quota. **Sequential tasks (version bump, cache sync, deploy) belong in the SAME cycle as the code change, as separate tickets — NOT as separate cycles.** A cycle that makes a code change without its operational follow-through is incomplete.
13. **Distinct-risk review.** When several reviewers help, give each a different risk instead of the same checklist. The parent compares their independent evidence and resolves differences. No reviewer count or cross-review ritual is a completion condition.
14. **Question-save-continue protocol.** When a question during ticket execution would normally pause for user input:
    (1) Do NOT send the question to the user.
    (2) Append it as an `## Open Questions` entry to the active T document with the Edit tool (document-first). Include the question text, a local timestamp, and the context: which AC raised it.
    (3) Make a reasonable assumption to unblock execution, and state it in that entry.
    (4) Continue without waiting. The next cycle's planning phase handles open questions.
    Exception: you MAY ask the user about destructive actions (delete, reset, overwrite); state the specific risk first.
