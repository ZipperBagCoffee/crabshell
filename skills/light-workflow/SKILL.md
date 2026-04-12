---
name: light-workflow
description: "Provides lightweight agent orchestration for standalone one-shot tasks with worklog tracing. Use when a simple task needs Work Agent + Review Agent + Orchestrator but does not require D/P/T documentation. Invoke with /light-workflow. Not for iterative work — use regressing instead."
---

# Agent Orchestration Workflow

## Worklog (W document)

Every light-workflow invocation creates a W document in `.crabshell/worklog/`:

### On start:
1. Glob `.crabshell/worklog/W*.md`, determine next ID (W001, W002, ...)
2. Create `.crabshell/worklog/W{NNN}-{slug}.md`:
```
# W{NNN} - {task title}

## Header
**Date:** {YYYY-MM-DD HH:MM}
**Source:** {user request or D/P/I reference}
**Scope estimate:** Files: ~N. Components: X, Y, Z. Cross-cutting: yes/no.

## Task
{one-line description of what needs to be done}

## Problem
{minimum 2 sentences: what is wrong or missing, and why it matters}

## Approach
{minimum 2 sentences: how you will solve it, and why this approach}

## Files Changed
| File | Change Description |
|------|--------------------|
| (filled after completion) | |

## Verification
| Criterion | Method | Result |
|-----------|--------|--------|
| (per acceptance criterion) | (command or observation) | PASS/FAIL |

## Experiment Log
{Record of attempts, failures, and pivots during execution. N/A with reason if single-shot success.}

## User Testing Needed
{Describe what the user should manually verify, or N/A with reason if fully machine-verifiable.}

## Result
{Final outcome summary}
```
3. Append row to `.crabshell/worklog/INDEX.md`: `| W{NNN} | {task} | in-progress | {date} |`

### On completion:
1. Complete all 9 W document sections: Header, Task, Problem, Approach, Files Changed (table), Verification (per-criterion PASS/FAIL), Experiment Log (or N/A), User Testing Needed (or N/A), Result
2. **Orchestrator document check:** Read the W document and verify NO section still contains placeholder text or "(filled after completion)". If any section is incomplete, write the actual content using Edit before marking done.
3. Update INDEX.md status to `done`

### W Document Rejection Criteria
A W document is REJECTED if any of these apply:
1. **Problem absent** — no explanation of what was wrong
2. **"Verification: Done"** — no per-criterion PASS/FAIL breakdown
3. **Files as bare list** — no change description per file
4. **Approach absent** — or disguised as a file list
5. **Experiment Log silently absent** — when rework actually occurred during execution
6. **Result = copy of Task** — no outcome differentiation

> **Lightweight reference mode:** This light-workflow skill is a lightweight execution mode suited for standalone one-shot tasks.
> For iterative tasks requiring document tracing, use the D/P/T-based `/regressing` skill.
> - `/regressing "topic" N` — N autonomous cycles (D→P→T loop, verification-based optimization)
> - `/discussing`, `/planning`, `/ticketing` — individual document creation skills

> Principles (Understanding-First, HHH, Critical Stance, etc.) are injected via RULES every prompt.
> This document defines HOW those principles apply to agent-based task execution.

### Pre-Response Output Scan

Before finalizing any response, scan for PROHIBITED PATTERNS (from RULES):
1. Scope reduction without approval
2. "Verified" without tool output in last 5 calls
3. Agreement without evidence
4. Same fix repeated ≥3 times
5. Prediction = Observation verbatim in P/O/G table
6. "takes too long" as justification for doing less
7. Suggesting to stop/defer without proof

**Workflow-specific additions:**
- **Document-first rule (W document):** After each phase, write results to the corresponding W document section FIRST using Edit tool. The document update is the primary output; conversation narration is secondary. Phase complete but W document not updated → STOP and update before proceeding.
- Review Agent produced no per-criterion verdict → reject, re-request with PASS/FAIL

## Workflow Selection

Before choosing light-workflow, assess scope:

**Pre-check: Open D documents.** Before selecting light-workflow, run:
`Glob('.crabshell/discussion/D*.md')`
If any D document exists → task is part of a tracked discussion. Do NOT use light-workflow. Route to the existing D/P/T system instead.

**Mandatory scope estimate** (state before selecting workflow):
```
Files: ~N. Components: X, Y, Z. Cross-cutting: yes/no.
```

### Decision Matrix

| Dimension | Light-Workflow | Regressing |
|-----------|---------------|------------|
| File count | ≤5 | 8+ (6-7 = check cross-cutting) |
| Complexity | Known pattern, single-shot | Design exploration, multiple candidates |
| Cross-cutting | Single module/layer | Shared convention (env var, interface, pattern used by 3+ scripts) |
| Iteration need | Plan known and stable | Feedback loops needed |
| Requirement stability | Stable at task-start | May expand during execution |

### Selection Rules
1. ≤5 files, no shared convention, known solution → **light-workflow**
2. 6-7 files without cross-cutting → **light-workflow** (with escalation monitoring)
3. 6-7 files with cross-cutting → **regressing**
4. 8+ files → **regressing unconditionally**
5. Shared convention change (env var, interface, pattern used by 3+ scripts) → **regressing**
6. "Investigate and implement" (requirements may expand) → **regressing**
7. Open D document exists in `.crabshell/discussion/` → **do not use light-workflow** — task belongs to D/P/T system. Check with Glob before selecting.

> The primary question is "does this warrant document traceability?" not "is this iterative?" Single-cycle regressing is valid for large-scope, well-specified tasks.

## Table of Contents

- [Worklog (W document)](#worklog-w-document)
- [Workflow Selection](#workflow-selection)
- [Core Concepts](#core-concepts)
- [3-Layer Architecture](#3-layer-architecture)
- [12-Phase Workflow](#12-phase-workflow) (overview)
- [Agent Prompt Template](#agent-prompt-template-generic)
- [Orchestrator Scope](#orchestrator-scope)
- [Parallel Execution](#parallel-execution)
- [Processing Agent Responses](#processing-agent-responses)
- [Anti-Patterns](#anti-patterns) (27 items)
- [Mid-Execution Escalation Protocol](#mid-execution-escalation-protocol)
- [Quick Reference](#quick-reference)

**Phase Details:**
- [ANALYSIS-PHASES.md](ANALYSIS-PHASES.md) — Phases 0.7-7 (Parameter Recommend, Understand, Analyze, Review, Plan)
- [EXECUTION-PHASES.md](EXECUTION-PHASES.md) — Phases 8-11 (Implement, Verify, Report)
- [COMPACTION.md](COMPACTION.md) — Compaction Protocol (used after Phase 4 and Phase 7)

---

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
| **Orchestrator** | Close understanding gap before delegating. Filter reviews through original intent. Spot-check claims (scaled to reviewer count). Run cross-review when 2+ reviewers. Never aggregate — judge. **Verify runtime verification results exist and are valid — final gatekeeper.** |
| **Work Agent** | Execute exactly what's specified. If reality differs from plan, STOP and report. No improvisation. **After implementation, perform runtime verification to prove code is reachable.** |
| **Review Agent** | Cite specific evidence. Predict behavior, don't just check text existence. PASS/FAIL only. Fresh context, no attachment to the work. **Independently perform runtime verification — never trust Work Agent's results.** |

### Evidence Gate (Review Agent — mandatory before PASS verdict)

Before issuing any PASS verdict, check all 6:
- [ ] Observation evidence attached (execution output, diff, log, test result)?
- [ ] Evidence from actual execution, not text search?
- [ ] Behavior predicted before evidence collected?
- [ ] Prediction matches observation, or gap documented?
- [ ] Verification independent (not based on Work Agent's claims)?
- [ ] `git diff` reviewed — no unintended deletions of existing functions/classes/exports?

If any checkbox unchecked → verdict is FAIL or CANNOT VERIFY, not PASS. This gate is BLOCKING.

---

## 12-Phase Workflow

```
Phase 0.7: Parameter Recommend → Orchestrator (agent count, roles, models)
Phase 1:   Understand          → Orchestrator + User
Phase 2:   Analyze             → Work Agent
Phase 3:   Review Analysis     → Review Agent(s)
Phase 3.5: Cross-Review        → Review Agents (BLOCKING, if 2+ reviewers)
Phase 4:   Meta-Review         → Orchestrator (Intent Guardian)

Phase 5:   Plan                → Work Agent
Phase 6:   Review Plan         → Review Agent(s)
Phase 6.5: Cross-Review        → Review Agents (BLOCKING, if 2+ reviewers)
Phase 7:   Meta-Review Plan    → Orchestrator + User
Phase 7.5: Alternative         → Orchestrator (optional)

Phase 8:   Implement           → Work Agent
Phase 9:   Verify              → Review Agent(s)
Phase 9.5: Cross-Review        → Review Agents (BLOCKING, if 2+ reviewers)
Phase 10:  Meta-Verify         → Orchestrator (Intent Guardian)

Phase 11:  Report              → Orchestrator
```

> **Phase details:** See [ANALYSIS-PHASES.md](ANALYSIS-PHASES.md) for Phases 1-7, [EXECUTION-PHASES.md](EXECUTION-PHASES.md) for Phases 8-11.

### Agent Prompt Template (generic)

All agent prompts follow this structure:

```
## Background
[Why this is needed — Phase 1 understanding + relevant prior phase outputs]

## Intent Anchor (READ-ONLY — DO NOT REINTERPRET)
IA-1: [requirement]
IA-2: [requirement]
...

These are your evaluation criteria. You may NOT add, remove, or reinterpret them.
If you believe an IA item conflicts with reality, STOP and report to orchestrator.
Do NOT silently reinterpret IA to match reality.

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

---

## Orchestrator Scope

| Does | Does NOT |
|------|----------|
| Check reviewer cited specific evidence | Re-read all files reviewer read |
| Spot-check claims (scaled to reviewer count) | Verify every single claim |
| Run cross-review when 2+ reviewers, resolve contested findings | Skip cross-review to save time |
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
  Work B → Review B ─┤── Cross-Review (BLOCKING) ── Orchestrator (intent check)
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

### Agent Call Classification

| Classification | Criteria | Review Requirement |
|---------------|----------|-------------------|
| **Light call** | Single file, no judgment needed, verifiable result (e.g., format check, existence check, simple comparison) | Orchestrator spot-check only (no separate Review Agent) |
| **Full agent** | Multiple files, judgment required, architectural decisions, code changes | 1:1 Review Agent mandatory (existing rule) |

**Default rule:** When in doubt, classify as Full agent. Misclassifying Full work as Light risks bypassing review.

**Orchestrator decides** the classification before spawning. Document the reasoning: "Light because [criteria met]" or "Full because [criteria not met]."

### Cross-Review Protocol

Cross-review is NOT a coherence check. It is adversarial cross-examination — reviewers challenge each other's conclusions.

See [ANALYSIS-PHASES.md — Phase 3.5](ANALYSIS-PHASES.md#phase-35--65--95-cross-review-blocking-gate) for full procedure and output format.

**Key principle:** Reviewers don't just check "do our findings align?" — they ask "did the other reviewer miss something I caught? Do I disagree with their verdict? Can I break their reasoning?"

**BLOCKING:** Meta-Review phases (4, 7, 10) require the Cross-Review Report as input when 2+ reviewers ran in parallel. Skipping cross-review to save time is Anti-pattern #20.

### Integration Review (Intent Guardian)

After cross-review:
1. Re-read Intent Anchor (IA-1 through IA-N) — this IS the immovable anchor
2. For each agent's work: `Agent output → IA-N: ALIGNED/CONFLICTS — [reason]`
3. "Does all this together satisfy every IA item?"
4. "Have reviewer suggestions shifted any IA item?"
5. **Accept** quality improvements that preserve all IA items; **override** drift

---

## Processing Agent Responses

1. Does agent's understanding match your intent? → If not, re-instruct
2. Does result answer the question? → If not, follow up
3. Review Agent: specific evidence, not just "looks good"?
4. Does this response change your understanding?

---

## Anti-Patterns

> **Verification Philosophy:** Follows VERIFICATION-FIRST principle from RULES (Predict → Execute → Compare). When no project verification tool exists, invoke the 'verifying' skill. The common root cause of anti-patterns #3, #9, #15, #25 below is absence of observation.
>
> **Observation Resolution Levels (from RULES):**
> - **L1 (Direct Execution):** Run code, observe output. Gold standard.
> - **L2 (Indirect Execution):** Execute related operation, infer result.
> - **L3 (Structural Check):** Read/grep files. No execution. Insufficient alone for runtime features.
> - **L4 (Claim Without Evidence):** PROHIBITED — always a violation.
>
> If L1 is possible, L3 is not acceptable. Phase 8 Runtime Verification = L1. Phase 9 review claiming PASS from text search alone = L3 violation.

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
| 20 | Skipping cross-review | 2+ parallel reviewers → Cross-Review Report is BLOCKING. Meta-Review without it is invalid. Completion drive is not an excuse. |
| 21 | Orchestrator as aggregator | Verify intent alignment, don't just compile |
| 22 | Token-first splitting | Split by module/feature first, tokens second |
| 23 | Reviewer-driven drift | Reviewers improve quality, not redefine goals |
| 24 | Intent erosion through iterations | Re-anchor to Intent Anchor (IA-N items) every meta-review — run Intent Comparison Protocol |
| 25 | Skipping runtime verification | Verification without tracing actual execution path is incomplete. "Code exists" ≠ "Code runs." Can verify but didn't = violation. |
| 26 | Internal iteration for plan changes | "Different approach" is plan-level, not execution-level. STOP and report. Only syntax/runtime fixes qualify for internal iteration. |
| 27 | Accepting partial verdicts | Graceful degradation preserves work products, not verdicts. Each criterion is still PASS or FAIL. No "partial pass." |
| 28 | Autonomous Write not in plan | Writing a code file not mentioned in Phase 5 plan → STOP. Cite which plan item covers the write, or stop and report |

---

## Mid-Execution Escalation Protocol

During Phase 8 (Implementation), the Work Agent MUST monitor scope:

### Escalation Triggers
- Files touched exceeds 7 (counted from Phase 8 start)
- A shared convention is being modified (env var, exported interface, pattern used by 3+ scripts)
- New dependency discovered not in Phase 5 plan

### Escalation Procedure
1. **STOP** implementation immediately
2. **Report** to Orchestrator: current file count vs. estimate, which trigger fired, files already modified
3. **Orchestrator decides:**
   - Scope reducible to ≤7 files → revise plan, continue as light-workflow
   - Scope inherently 8+ or cross-cutting → save W document with status `escalated`, create D document, hand off to `/regressing`

> Work Agents do NOT have authority to "just finish the last file" after a trigger fires. The trigger is a hard stop.

---

## Quick Reference

```
Task → Phase 0.7: Parameter Recommendation (agents, roles, models)
     → Phase 1: Understand + Intent Anchor (IA-1..N)
     → Phase 2-4: Analyze → Review → [Cross-Review] → Meta-Review + Intent Comparison
     → Phase 5-7: Plan → Review → [Cross-Review] → Meta-Review + Intent Comparison + Approve
     → Phase 7.5: Alternative (optional)
     → Phase 8-10: Implement → Verify → [Cross-Review] → Meta-Verify + Intent Comparison
     → Phase 11: Report

[Cross-Review] = Phase 3.5/6.5/9.5 — BLOCKING when 2+ reviewers
Intent Comparison = re-read IA items, compare each recommendation, document ALIGNED/CONFLICTS

3-Layer: Work Agent → Review Agent → Orchestrator (Intent Guardian)
Understanding = Gap closed + Consequences predicted
Orchestrator = Synthesize + Critique + Preserve Intent Anchor
Spot-checks scale: 1 reviewer→1, 2-3→2, 4+→3
If gap remains → do not proceed
If recommendation CONFLICTS with any IA item → reject or find alternative
Compaction = Summarize previous phases after Phase 4/7 meta-review. IA is never compressed.
Light/Full = agent classification. Light: single file + no judgment needed → spot-check only. Full: existing 1:1 Review mandatory. When in doubt → Full.
Internal Iteration = Only Phase 8 execution errors, max 3 retries. Plan change → STOP. Logging mandatory.
Graceful Degradation = On partial failure in Phase 10, keep confirmed PASS + rework only FAIL items. Verdicts remain PASS/FAIL.
Escalation = WA monitors scope during Phase 8. >7 files or shared convention → STOP → Orchestrator decides: reduce scope or escalate to regressing.
```
