---
name: light-workflow
description: "Provides lightweight agent orchestration for standalone one-shot tasks without document trail. Use when a simple task needs Work Agent + Review Agent + Orchestrator but does not require D/P/T documentation. Invoke with /light-workflow. Not for iterative work — use regressing instead."
---

# Agent Orchestration Workflow

> **Lightweight reference mode:** This light-workflow skill is a lightweight execution mode suited for standalone one-shot tasks.
> For iterative tasks requiring document tracing, use the D/P/T-based `/regressing` skill.
> - `/regressing "topic" N` — N autonomous cycles (D→P→T loop, verification-based optimization)
> - `/discussing`, `/planning`, `/ticketing` — individual document creation skills

> Principles (Understanding-First, HHH, Critical Stance, etc.) are injected via RULES every prompt.
> This document defines HOW those principles apply to agent-based task execution.

## Table of Contents

- [Core Concepts](#core-concepts)
- [3-Layer Architecture](#3-layer-architecture)
- [11-Phase Workflow](#11-phase-workflow) (overview)
- [Agent Prompt Template](#agent-prompt-template-generic)
- [Orchestrator Scope](#orchestrator-scope)
- [Parallel Execution](#parallel-execution)
- [Processing Agent Responses](#processing-agent-responses)
- [Anti-Patterns](#anti-patterns) (27 items)
- [Quick Reference](#quick-reference)

**Phase Details:**
- [ANALYSIS-PHASES.md](ANALYSIS-PHASES.md) — Phases 1-7 (Understand, Analyze, Review, Plan)
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

---

## 11-Phase Workflow

```
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

> **Verification Philosophy:** Verification = closing the gap between belief and reality through observation. The common root cause of anti-patterns #3, #9, #15, #25 below is absence of observation. Direct execution + observation is the top priority; indirect means only when direct execution is impractical.

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

---

## Quick Reference

```
Task → Phase 1: Understand + Intent Anchor (IA-1..N)
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
```
