# Ticketing — ticket document template

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
- **Edge-case coverage (recommended):** At least one AC should test an error path, a boundary or a negative case, such as "invalid input returns error".

## Verification
{criterion 1}: {how to verify — command to run, behavior to observe}
{criterion 2}: {how to verify}

## Ticket Execution

The parent owns implementation, decisive verification, the final diff, completion and each worker's brief.

**Document-first rule:** In each step, write the results to its T section with Write/Edit first, then give the user a brief summary.

### Step A: Parent — Execution
- Execute the tasks according to the plan and record the result of each work item in `## Execution Results`.

**Parallel workers:**
- Parts that touch different files and need no result from each other go to parallel workers by default.
- Every brief names the exact task, non-goals, authoritative references, allowed scope, expected observation, and verification command.
- Workers and reviewers do not fan out. Worker or reviewer count is never progress or completion evidence.

### Step B: Parent Verification + Optional Independent Review
- The parent runs the ticket's direct verification, whether or not workers were used.
- **Deletion Check (MANDATORY first step):** Run `git diff` on all modified files before any other check. Use `git diff HEAD` when changes are staged or committed. Scan the deleted lines: a function, class or export deleted without mention in the Acceptance Criteria is a finding, and an unintended deletion of existing code is an automatic FAIL. If the diff is empty, as with new files only or already-committed changes, use an available baseline diff. With no diff available, write "Deletion Check: N/A — {reason}" and proceed.
- **Record in `## Verification Results`:** for each acceptance criterion, the command run (or the file read), its output line, and pass/fail. A behavior claim is backed by an execution result, a structure claim by what was read.
- Verify each work item's runtime behavior (trigger → path → result), that existing functionality still works, and edge-case and exception handling.
- Use independent review when change risk, shared contracts, security, data loss or user-visible behavior calls for it. Reviewer count never follows worker count.
- **Independence Protocol:** A reviewer's brief holds the ticket's Acceptance Criteria and Verification sections, never the implementation's conclusions. Ask for the same record per criterion. The parent records each finding and what it did about it.
- **Check run — once, after the discussion's last edit, before the commit (in regressing: after the cycle's last edit, see the regressing skill's cycle-verification.md):** With several tickets, the last ticket runs it and earlier tickets record that they wait for that run. While editing, run only the test of the part being written, by name through the runner (`node .crabshell/verification/run-verify.js <id>`), so its pass is kept. If `.crabshell/verification/manifest.json` exists, run `node .crabshell/verification/run-verify.js --changed` or the project's equivalent once; record the command and its result line. With no manifest, invoke `/verifying` to create one, then run it. A project with nothing executable records "Verification tool N/A: {reason}". Do not run it again on unchanged files.

### Step B.5: Multiple Independent Reviews (when useful)
- Give each reviewer a different material risk, not a copy of one checklist.
- The parent compares evidence, then records and resolves discrepancies before completion. A cross-review report or reviewer count is not a completion gate.

### Step C: Parent — Final Verification
**Performed by:** The parent reads the direct execution evidence and any optional independent findings, then evaluates independently.
- Read the recorded evidence: the check run's result line and each criterion's command and output line. A worker's or reviewer's claim is not completion evidence. Observe again only what changed after it was observed.
- **Intent Fidelity (BLOCKING — the result against the discussion):** Before the 4-factor evaluation, write `## Intent Fidelity` with one row per IA item this ticket touches and per Plan decision in its Implementation Details:
  ```
  | Discussion item (IA-n / Plan decision) | Result | Deviation (none/partial/departed) | Evidence | Reason / user approval |
  |---|---|---|---|---|
  ```
  Evidence is tool output or a file and line. A row marked departed without the user's approval means the ticket is not verified: fix the result, or ask the user and record their answer. In regressing, every partial or departed row goes into Next Direction. The log guard blocks `verified` while this section holds its placeholder.
- **Evidence (BLOCKING — before evaluating content):** Each criterion needs its Step B record, whether the parent or a worker did it. A criterion without one is observed once before it counts: run it, or read its saved result.
- 4-factor evaluation:
  1. **Correctness**: Was it done correctly? Cite specific evidence: command output or observed behavior.
  2. **Coherence**: Do the changes work together as a whole? The parent must check the combined result, not just that each AC passes alone. With a single AC, write "Single AC — coherence N/A" and a brief reason.
     **Ways to check coherence (use the ones the change calls for):**
     - **Cross-file sync check:** When one concept appears in several files, grep every location and confirm the wording and meaning match.
     - **Reference integrity:** When one file cites another's content, confirm the target exists and matches.
     - **Integration test:** Run the changed code or hook and confirm the outputs of the changed files work together.
     - **Contradiction scan:** Explicitly check whether any two changes give contradictory instructions.
     - **Pipeline contradiction scan:** Check whether this change contradicts logic in related pipelines, at three levels: within the changed files; in files that interact with them through imports, callers or shared state; and against project rules and philosophy (CLAUDE.md, SKILL.md principles). A change that works locally but contradicts a related pipeline is not coherent.
     Name the method used. A one-line "Coherent" or "일관됨" verdict with no method is not a check.
  3. **Improvement Opportunities**: What gaps remain? What did not work well? "No improvements" names what was examined and why nothing applies.
  4. **Next Direction**: Regressing cycles 1 through N-1 fill it; cycle N uses the Final Report.
     - **Problems Found**: Specific issues observed in this cycle, with evidence.
     - **Root Cause Hypothesis**: Why did these problems occur?
     - **Recommended Focus**: What should the next cycle prioritize?
     - A generic TODO list without this cycle's observations is invalid.

## Execution
- Parent-owned flow above (Step A → Step B → Step C); one ticket = one independent execution.

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
