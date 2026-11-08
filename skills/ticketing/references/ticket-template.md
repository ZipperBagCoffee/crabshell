# Ticketing — ticket document template

Moved out of SKILL.md so the skill body stays within what Claude Code re-attaches after compaction (the first 5,000 tokens of each skill). Read this file when the body points here.

```
---
type: ticket
id: {PARENT}_T{NNN}
title: "{title}"
status: todo
created: {YYYY-MM-DD}
tags: []
---

# {PARENT}_T{NNN} - {title}

## Parent
- Parent: [[{PARENT}-{slug}|{PARENT}]] - {parent title}

## Intent
{user's answer}

## Scope
Included: {included}
Excluded: {excluded}

## Implementation Details
{This ticket's part of the discussion's Plan, specific enough to build from this ticket alone: each file → function/section → what changes; formats, names, order.}

## Acceptance Criteria
- [ ] {criterion 1}
- [ ] {criterion 2}
- **Edge-case coverage (recommended):** At least one AC should test an error path, boundary condition, or negative scenario (e.g., "invalid input returns error", "empty file handled gracefully"). Happy-path-only ACs miss the failures that matter most.

## Verification
{criterion 1}: {how to verify — command to run, behavior to observe}
{criterion 2}: {how to verify}

## Ticket Execution

The parent owns implementation, decisive verification, the final diff, completion and each worker's brief. Independent parts go to parallel workers by default.

### Step A: Parent — Execution
- Execute tasks according to the plan (P)
- Record results for each work item
- **Document-first rule:** Write execution results to `## Execution Results` in the T document FIRST using Write/Edit tool. After the document is updated, provide a brief summary to the user. The document update is the primary output; the conversation summary is secondary.

**Parallel workers:**
- Parts that touch different files and need no result from each other go to parallel workers.
- Every prompt names the exact task, non-goals, authoritative references, allowed scope, expected observation, and verification command.
- Delegates do not fan out. Agent count is never progress or completion evidence.

### Step B: Parent Verification + Optional Independent Review
- The parent runs the ticket's direct verification regardless of delegation.
- **Record in `## Verification Results`:** for each acceptance criterion, the command run (or the file read), its output line, and pass/fail. A behavior claim is backed by an execution result, a structure claim by what was read.
- Use independent review when change risk, shared contracts, security, data loss, or user-visible behavior warrants it. Reviewer count never follows worker count.
- **Independence Protocol:** When review is used, the prompt MUST NOT include implementation conclusions as its observation source. Provide the ticket Acceptance Criteria and Verification sections and ask for the same record (command or file read, output line, pass/fail per criterion). The parent records each finding and what it did about it.
- **Deletion Check (MANDATORY first step):** Run `git diff` (or `git diff HEAD` if changes are staged/committed) on all modified files BEFORE any other verification. Scan deleted lines — any function, class, or export that disappeared without being mentioned in the ticket Acceptance Criteria is a finding. Unintended deletion of existing code = automatic FAIL. If diff is empty (new files only, or already committed), use an available baseline diff. If no diff is obtainable, state "Deletion Check: N/A — {reason}" and proceed.
- Verify runtime behavior of each work item (trigger → path → result)
- Confirm changes do not break existing functionality (the Deletion Check above — `git diff` — enforces this)
- Confirm edge case and exception handling
- **Check run — once, after the discussion's last edit, before the commit:** with several tickets, the last one runs it and an earlier ticket records that it waits for that run; while editing, run only the test of the part being written, by name through the runner (`node .crabshell/verification/run-verify.js <id>`) so its pass is kept. If `.crabshell/verification/manifest.json` exists, run `node .crabshell/verification/run-verify.js --changed` (or the project's equivalent) once and record the command and its result line; with no manifest, invoke `/verifying` to create one, then run it; a project with nothing executable records "Verification tool N/A: {reason}". The runner reuses passes whose inputs did not change; do not run it again on unchanged files.
- **Document-first rule:** Write verification results to `## Verification Results` in the T document FIRST using Write/Edit tool. After the document is updated, provide a brief summary to the user. The document update is the primary output; the conversation summary is secondary.

### Step B.5: Multiple Independent Reviews (when useful)
- Assign different material risks rather than duplicating a checklist.
- The parent compares evidence, records discrepancies, and resolves them before completion. A cross-review report or reviewer count is not a completion gate.

### Step C: Parent — Final Verification
**Performed by:** The parent — reads direct execution evidence and any optional independent findings, then evaluates independently.
- **Document-first rule:** Write your evaluation to `## Final Verification` in the T document FIRST using Write/Edit tool. After the document is updated, provide a brief summary to the user. The document update is the primary output; the conversation summary is secondary.
- Read the recorded evidence (the check run's result line, each criterion's command and output line); a worker's or reviewer's claim is not completion evidence. Observe again only what changed after it was observed.
- **Intent Fidelity (BLOCKING — the result against the discussion):** Before the 4-factor evaluation, write `## Intent Fidelity`: one row per discussion item this ticket touches — each IA item and each Plan decision in its Implementation Details:
  ```
  | Discussion item (IA-n / Plan decision) | Result | Deviation (none/partial/departed) | Evidence | Reason / user approval |
  |---|---|---|---|---|
  ```
  Evidence is tool output or a file/line, as in Verification Results. A row marked departed without the user's approval means the ticket is not verified: fix the result, or ask the user and record their answer. In regressing, every partial or departed row goes into Next Direction. The log guard blocks `verified` while this section still holds its placeholder.
- **Evidence (BLOCKING — before evaluating content):** each criterion has its Step B record — the parent's and a worker's alike. A criterion without one (verification claimed but not performed) is observed once — run it, or read its saved result — before it counts.
- 4-factor evaluation:
  1. **Correctness**: Was it done correctly? Cite specific evidence (command output, observed behavior).
  2. **Coherence**: Do the changes work together as a whole? Individual ACs may each pass, but the combined result may have inconsistencies, contradictions, or integration gaps. The Orchestrator MUST verify that the parts form a coherent whole — not just that each part individually passes. (If only 1 AC exists, state "Single AC — coherence N/A" with brief justification.)
     **Ways to check coherence (use the ones the change calls for):**
     - **Cross-file sync check:** When the same concept appears in multiple files (e.g., RULES in inject-rules.js and CLAUDE.md), grep for the concept in all locations and confirm consistent wording/semantics.
     - **Reference integrity:** When file A references file B's content (e.g., skill referencing CLAUDE.md rules), verify the reference target actually exists and matches.
     - **Integration test:** Run the changed code/hook and verify that outputs from multiple changed files interact correctly (e.g., inject-rules.js produces CLAUDE.md that contains all expected sections).
     - **Contradiction scan:** Explicitly check whether any two changes give contradictory instructions (e.g., one file says "RA count = WA count" while another says "single RA is fine").
     - **Pipeline contradiction scan:** Check whether this change contradicts logic in related pipelines. Level 1: within the changed files. Level 2: in files that interact with the changed component (imports, callers, shared state). Level 3: against project rules/philosophy (CLAUDE.md, SKILL.md principles). A change that works locally but contradicts a related pipeline is not coherent.
     Name the method used; "Coherent" or "일관됨" as a one-line verdict with no method is not a check.
  3. **Improvement Opportunities**: What gaps remain? What didn't work well? ("No improvements" names what was examined and why nothing applies.)
  4. **Next Direction** (for regressing cycles 1 through N-1; cycle N uses Final Report):
     - **Problems Found**: Specific issues observed in THIS cycle, with evidence.
     - **Root Cause Hypothesis**: Why did these problems occur?
     - **Recommended Focus**: What should the next cycle prioritize?
     - (Generic TODO lists without cycle-specific observations are INVALID.)

## Execution
- This ticket uses the parent-owned flow above (Step A → Step B → Step C)
- 1 Ticket = 1 independent execution cycle

## Execution Results
(placeholder — parent writes implementation evidence here)

## Verification Results
(placeholder — per acceptance criterion: the command run or file read, its output line, pass/fail; append optional independent findings when used)

## Reader Check
(placeholder — person check: who used or read the result and what they did, or "not confirmed"; correction sweep: the user's words, defect type, same defect in N places, fixed, left, or "none")

## Intent Fidelity
(placeholder — parent compares the result with the discussion's Intent Anchor and Plan here)

## Final Verification
(placeholder — parent writes the final evaluation here)
### Correctness
### Coherence
### Improvement Opportunities
### Next Direction
#### Problems Found
#### Root Cause Hypothesis
#### Recommended Focus

## Independent Review Notes (if applicable)
(Optional. Record distinct risk assignments, contested findings, and the parent's resolution.)

## Log

---
### [{YYYY-MM-DD HH:MM}] Created
{work plan for this ticket}
```
