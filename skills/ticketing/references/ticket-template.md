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

The parent owns implementation, decisive verification, and completion. Delegation is optional and bounded by independent value or material risk.

### Step A: Parent — Execution
- Execute tasks according to the plan (P)
- **Scope Note (from project RULES):** Conciseness applies to communication style, not to verification steps. P/O/G tables and evidence citations are required work product, not verbose output. Evidence IS the answer — "verified" without tool output is not verification. Fill Prediction before looking; fill Observation only from tool output.
- Record results for each work item
- **Document-first rule:** Write execution results to `## Execution Results` in the T document FIRST using Write/Edit tool. After the document is updated, provide a brief summary to the user. The document update is the primary output; the conversation summary is secondary.

**Optional bounded delegation:**
- Delegate only independent work whose risk or latency benefit justifies it.
- Every prompt names the exact task, non-goals, authoritative references, allowed scope, expected observation, and verification command.
- Delegates do not fan out. Agent count is never progress or completion evidence.

### Step B: Parent Verification + Optional Independent Review
- The parent runs the ticket's direct verification regardless of delegation.
- Use independent review when change risk, shared contracts, security, data loss, or user-visible behavior warrants it. Reviewer count never follows worker count.
- **Independence Protocol:** When review is used, the prompt MUST NOT include implementation conclusions as its observation source. Provide the ticket Acceptance Criteria and Verification sections plus the P/O/G template. The parent later cross-references findings against direct evidence.
- **Deletion Check (MANDATORY first step):** Run `git diff` (or `git diff HEAD` if changes are staged/committed) on all modified files BEFORE any other verification. Scan deleted lines — any function, class, or export that disappeared without being mentioned in the ticket Acceptance Criteria is a finding. Unintended deletion of existing code = automatic FAIL. If diff is empty (new files only, or already committed), use an available baseline diff. If no diff is obtainable, state "Deletion Check: N/A — {reason}" and proceed.
- Verify runtime behavior of each work item (trigger → path → result)
- **Scope Note (from project RULES):** Conciseness applies to communication style, not to verification steps. P/O/G tables and evidence citations are required work product, not verbose output. Evidence IS the answer — "verified" without tool output is not verification. Fill Prediction before looking; fill Observation only from tool output.
- **Any independent review prompt MUST include this verification context and output template:**
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
- Confirm changes do not break existing functionality (Evidence Gate checkbox 6 — `git diff` deletion check — enforces this)
- Confirm edge case and exception handling
- **Skeptical calibration:** If all verification items show Gap="none", this is a signal to examine harder — genuinely flawless implementation is rare. State explicitly what you searched for that you did NOT find. A review that finds zero issues requires more justification than one that finds problems.
- **Document-first rule:** Write verification results to `## Verification Results` in the T document FIRST using Write/Edit tool. After the document is updated, provide a brief summary to the user. The document update is the primary output; the conversation summary is secondary.

### Step B.5: Multiple Independent Reviews (when useful)
- Assign different material risks rather than duplicating a checklist.
- The parent compares evidence, records discrepancies, and resolves them before completion. A cross-review report or reviewer count is not a completion gate.

### Step B.9: Verification Tool Check (Parent — BEFORE Step C)
**Before starting Step C**, the parent MUST check:
1. Does `.crabshell/verification/manifest.json` exist in the project?
2. If YES → run `/verifying run` to execute verification tools against acceptance criteria. Include runner output in Step C evaluation.
3. If NO → invoke `/verifying` to create a verification manifest for this project. Then run `/verifying run`.
4. If the project has no executable runtime (e.g., pure documentation) → skip with explicit note: "Verification tool N/A: {reason}"

This step is procedural and happens every time.

### Step C: Parent — Final Verification
**Performed by:** The parent — reads direct execution evidence and any optional independent findings, then evaluates independently.
- **Document-first rule:** Write your evaluation to `## Final Verification` in the T document FIRST using Write/Edit tool. After the document is updated, provide a brief summary to the user. The document update is the primary output; the conversation summary is secondary.
- Re-run decisive observations directly; do not accept a worker/reviewer claim as completion evidence.
- Catch cases where "verification was claimed but not actually performed"
- **Intent Fidelity (BLOCKING — the result against the discussion):** Before the 4-factor evaluation, write `## Intent Fidelity`: one row per discussion item this ticket touches — each IA item and each Plan decision in its Implementation Details:
  ```
  | Discussion item (IA-n / Plan decision) | Result | Deviation (none/partial/departed) | Evidence | Reason / user approval |
  |---|---|---|---|---|
  ```
  Evidence is tool output or a file/line, as in Verification Results. A row marked departed without the user's approval means the ticket is not verified: fix the result, or ask the user and record their answer. In regressing, every partial or departed row goes into Next Direction. The log guard blocks `verified` while this section still holds its placeholder.
- **Evidence Gate (BLOCKING — check BEFORE evaluating content):**
  Agents can generate text that looks like verification without actual observation. Apply this gate to parent and delegated evidence alike.
  □ Does each verification item have Prediction, Observation, AND Gap fields?
  □ Does Observation contain tool output evidence? (for directly-executable items)
  □ Is Prediction ≠ Observation? (copy detection)
  □ For indirect verification: is the reason stated?
  □ Does at least 1 verification item have Type = behavioral? (structural-only = insufficient for runtime features)
  → If ANY check fails: reject that evidence and re-run the observation.
- **Independent Evidence Cross-Reference (when delegation/review was used):**
  Compare independent findings against implementation evidence.
  1. Read the independent P/O/G findings
  2. Read execution results and direct tool output
  3. Identify discrepancies — items where independent observation found problems implementation evidence did not report, or where implementation claimed success but direct observation found issues
  4. Discrepancies are the highest-priority findings and must be addressed in Correctness evaluation
- 4-factor evaluation:
  1. **Correctness**: Was it done correctly? Cite specific evidence (command output, observed behavior).
  2. **Coherence**: Do the changes work together as a whole? Individual ACs may each pass, but the combined result may have inconsistencies, contradictions, or integration gaps. The Orchestrator MUST verify that the parts form a coherent whole — not just that each part individually passes. (If only 1 AC exists, state "Single AC — coherence N/A" with brief justification.)
     **Coherence verification methods (minimum 2 of the following):**
     - **Cross-file sync check:** When the same concept appears in multiple files (e.g., RULES in inject-rules.js and CLAUDE.md), grep for the concept in all locations and confirm consistent wording/semantics.
     - **Reference integrity:** When file A references file B's content (e.g., skill referencing CLAUDE.md rules), verify the reference target actually exists and matches.
     - **Integration test:** Run the changed code/hook and verify that outputs from multiple changed files interact correctly (e.g., inject-rules.js produces CLAUDE.md that contains all expected sections).
     - **Contradiction scan:** Explicitly check whether any two changes give contradictory instructions (e.g., one file says "RA count = WA count" while another says "single RA is fine").
     - **Pipeline contradiction scan:** Check whether this change contradicts logic in related pipelines. Level 1: within the changed files. Level 2: in files that interact with the changed component (imports, callers, shared state). Level 3: against project rules/philosophy (CLAUDE.md, SKILL.md principles). A change that works locally but contradicts a related pipeline is not coherent.
     "Coherent" or "일관됨" as a one-line verdict without executing any of the above methods is INVALID.
  3. **Improvement Opportunities**: What gaps remain? What didn't work well? (MUST enumerate what was examined. "No improvements" requires 3+ sentences explaining what was checked and why no improvements apply.)
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
(placeholder — parent writes direct P/O/G evidence; append optional independent findings when used)

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
