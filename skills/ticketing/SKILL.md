---
name: ticketing
description: "Creates and updates ticket documents as executable work units tied to a plan. Use when breaking a plan into session-sized tasks with acceptance criteria and verification steps. Invoke with /ticketing P001 \"topic\" to create, or /ticketing P001_T001 to update. Each ticket uses parent-owned execution and verification with optional bounded delegation."
---

# Ticket Document Skill

## Modes

- **Create mode:** `/ticketing P001 "title"` — creates a new ticket under plan P001
- **Update mode:** `/ticketing P001_T001` — appends a log entry to an existing ticket

---

## Create Mode

When arguments are a Plan ID + title string:

### Step 1: Validate parent plan

Read `.crabshell/plan/INDEX.md`. Find the row for the given Plan ID.
- If plan not found → error: "Plan {ID} does not exist."
- If plan status is `draft` → warn: "Plan {ID} is not yet approved. Create ticket anyway? (not recommended)"
- If plan status is `approved` or `in-progress` → proceed

### Step 2: Ensure ticket folder exists

Check if `.crabshell/ticket/` exists.

- **Folder does not exist:** Create it and create `.crabshell/ticket/INDEX.md` with content below.
- **Folder exists but INDEX.md does NOT exist:** Pre-existing files detected. Create `.crabshell/ticket/backup/`, move ALL existing files into it, then create INDEX.md. Report to user: "Moved N existing files to .crabshell/ticket/backup/"
- **Folder exists and INDEX.md exists:** Already managed. Proceed.

INDEX.md content:
```
# Ticket Index

| ID | Title | Status | Created | Plan |
|----|-------|--------|---------|------|
```

### Step 3: Determine next ticket ID

Glob `.crabshell/ticket/P{NNN}_T*.md` where P{NNN} is the parent plan.
Extract ticket numbers. Next = max + 1, zero-padded to 3 digits.
If no tickets for this plan, start at 001.

### Step 4a: Line-number pre-flight (MANDATORY for Scope authoring)

Before writing line-number references (e.g., "USER-MANUAL.md L290", "scripts/inject-rules.js:636") in the Scope or Acceptance Criteria sections, **verify each line number via grep or Read**:

1. For a target file + expected content (e.g., "where canonical phrase appears"), run `grep -n '<phrase>' <file>` — capture actual line number.
2. Include line number in Scope only if confirmed; otherwise use a semantic reference (e.g., "§Pressure System section" or "the `classifyAgent` function").
3. If line numbers drift due to subsequent edits, the ticket's Scope retains validity via semantic anchor.

This prevents ticket-Scope line-number drift (as observed when D100 T003 Scope cited STRUCTURE.md L350 but actual target was L70).

### Step 4: Create ticket document

Ask the user:
1. **Intent:** What part of the parent plan does this ticket fulfill? What changes after completion?
2. **Scope:** What to do / not do in this session?
3. **Acceptance Criteria:** Specific conditions for "done"
4. **Verification:** How to verify each acceptance criterion? (Must be executable commands or observable behavior. "File contains X" is NOT acceptable.)

Then create `.crabshell/ticket/P{NNN}_T{NNN}-{slug}.md`:

```
---
type: ticket
id: P{NNN}_T{NNN}
title: "{title}"
status: todo
created: {YYYY-MM-DD}
tags: []
---

# P{NNN}_T{NNN} - {title}

## Parent
- Plan: [[P{NNN}-{slug}|P{NNN}]] - {plan title}

## Intent
{user's answer}

## Scope
Included: {included}
Excluded: {excluded}

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

### Step 5: Update ticket INDEX.md

Append row to `.crabshell/ticket/INDEX.md`:

```
| [[P{NNN}_T{NNN}-{slug}|P{NNN}_T{NNN}]] | {title} | todo | {YYYY-MM-DD} | [[P{NNN}-{slug}|P{NNN}]] |
```

### Step 6: Update parent plan

Append to the **Tickets section** of the parent plan document:

```
- [[P{NNN}_T{NNN}-{slug}|P{NNN}_T{NNN}]]: {title}
```

Also update `.crabshell/plan/INDEX.md` Tickets column to include the new ticket ID.

### Step 7: Confirm

Tell user: "Created P{NNN}_T{NNN}. Status: todo. Ready for execution."

---

## Update Mode

When argument matches `P\d{3}_T\d{3}` pattern:

### Step 1: Read existing ticket

Glob `.crabshell/ticket/P{NNN}_T{NNN}-*.md`. If not found, stop.

### Step 2: Append log entry

Append to end of document:

```

---
### [{YYYY-MM-DD HH:MM}] {entry_type}
{content}
```

Entry types:
- `Work Log` — work notes, files changed, decisions made
- `Verification Run` — verification run with commands and results
- `Verification Complete` — verification passed/failed with evidence
- `Status Change: {old} → {new}`

### Step 3: Update INDEX.md if status changed

Update ticket INDEX.md status column.

### Step 4: Status cascade (on verified)

If ticket status → `verified`:

1. **Check parent plan:** Read `.crabshell/ticket/INDEX.md`, find ALL tickets for the same parent plan. Are ALL of them `verified`?
   - If NO → stop here.
   - If YES → continue cascade.
2. **Close parent plan:** Update parent plan's status to `done` in `.crabshell/plan/INDEX.md`. Append log entry to plan document: `Status Change: in-progress → done (all tickets verified)`
3. **Cascade to D/I:** Read parent plan's `Related` column in `.crabshell/plan/INDEX.md`. For each related D/I ID (stored as wikilinks `[[D{NNN}-{slug}|D{NNN}]]` or bare IDs — extract the ID portion):
   - **Cross-check:** Read that D/I's Related column in its INDEX.md. If it references OTHER plans besides the one just completed, check those plans' statuses too. ALL related plans must be `done` before concluding.
   - If all related plans done → update D/I status to `concluded`, append log entry: `Status Change: open → concluded (all related plans completed)`
   - If other related plans still open → skip, do not conclude. Log: `P{NNN} completed, conclusion deferred due to other related plans still incomplete`

### Status Transitions

- `todo` → `in-progress` (work begins)
- `in-progress` → `done` (work complete, pending verification)
- `done` → `verified` (verification passed)
- `in-progress` → `blocked` (external dependency)
- `blocked` → `in-progress` (unblocked)

---

## Rules

1. **NEVER modify existing content.** Only append to Log section and agent result sections (Execution Results, Verification Results, Final Verification).
2. **Acceptance criteria checkboxes:** Never modify. Completion tracked in Log entries.
3. **`done` ≠ `verified`:** Work completion and verification are separate events with separate log entries.
4. **Verification at creation:** The Verification section MUST be filled at ticket creation time (before work starts). This is the TDD principle — define how you'll check before you build.
5. **"File contains X" is forbidden** in Verification section. Must describe observable behavior or runnable commands.
6. **INDEX.md** is the only file where existing content may be modified.
7. **Plan propagation:** When all tickets verified → auto-update plan status.
8. **1 Ticket = 1 independent execution cycle:** Each ticket is executed as a separate, independent agent cycle. Never batch multiple tickets into a single execution. 3 tickets = 3 separate executions.
9. **Mandatory work log:** After performing any work related to this document, append a log entry to the Log section using the existing format (`### [{YYYY-MM-DD HH:MM}] {entry_type}`). This applies regardless of whether this skill was explicitly invoked — if the work touched or advanced this ticket's purpose, log it.
10. **Mandatory append of results:** The parent must append execution, direct verification, and final evaluation to the corresponding T sections. If delegation/review was used, its evidence and the parent's disposition must also be recorded. Verification not recorded in the document is treated as not performed. Before completion, the parent reads the T document and confirms all three required sections no longer contain `placeholder`; optional review notes are not a completion gate.
11. **Exhaustive verification standard:** Verification follows the VERIFICATION-FIRST principle in RULES (Predict → Execute → Compare). When no project verification tool exists, invoke the 'verifying' skill. Direct → indirect → explicitly "unverified".
12. **Regressing context transfer:** In the regressing loop, this T document's `## Final Verification > Next Direction` content is passed directly to the next cycle's P(n+1) document's Context. The Orchestrator must explicitly perform this transfer. (D is the top-level container and does not receive per-cycle context.)
13. **Regressing state update:** If `.crabshell/memory/regressing-state.json` exists and is active, update it after ticket creation using: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.ticketIds.push('{T-ID}');s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"`. Phase transition is handled automatically by the PostToolUse hook. Only applies when regressing-state.json exists — standalone ticketing usage is unaffected.
14. **No autonomous code writes:** Every Write/Edit to a code file must trace to an explicit Acceptance Criterion in this ticket. If a code file write is not covered by an AC, STOP — either add an AC (if in scope) or raise an Open Question. Completion drive = writing beyond the ticket's AC scope.
