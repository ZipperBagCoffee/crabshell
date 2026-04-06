---
name: ticketing
description: "Creates and updates ticket documents as executable work units tied to a plan. Use when breaking a plan into session-sized tasks with acceptance criteria and verification steps. Invoke with /ticketing P001 \"topic\" to create, or /ticketing P001_T001 to update. Each ticket executes independently with Work Agent, Review Agent, and Orchestrator."
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

### Step 4: Create ticket document

Ask the user:
1. **Intent:** What part of the parent plan does this ticket fulfill? What changes after completion?
2. **Scope:** What to do / not do in this session?
3. **Acceptance Criteria:** Specific conditions for "done"
4. **Verification:** How to verify each acceptance criterion? (Must be executable commands or observable behavior. "File contains X" is NOT acceptable.)

Then create `.crabshell/ticket/P{NNN}_T{NNN}-{slug}.md`:

```
# P{NNN}_T{NNN} - {title}

## Parent
- Plan: P{NNN} - {plan title}

## Intent
{user's answer}

## Scope
Included: {included}
Excluded: {excluded}

## Acceptance Criteria
- [ ] {criterion 1}
- [ ] {criterion 2}

## Verification
{criterion 1}: {how to verify — command to run, behavior to observe}
{criterion 2}: {how to verify}

## Agent Execution

This ticket is executed with the following agent structure:

### Step A: Work Agent — Execution
**Launch:** Use Task tool to create a Work Agent with the task description below.
- Execute tasks according to the plan (P)
- **Scope Note (from project RULES):** Conciseness applies to communication style, not to verification steps. P/O/G tables and evidence citations are required work product, not verbose output. Evidence IS the answer — "verified" without tool output is not verification. Fill Prediction before looking; fill Observation only from tool output.
- Record results for each work item
- Append results to `## Execution Results` section

**Parallel Work Agents (DEFAULT):**
The Orchestrator MUST launch 2+ Work Agents with **distinct analytical perspectives** — not for speed, but to surface different viewpoints:
- Each WA receives the SAME task but a different **analytical lens** (e.g., WA1="correctness focus" vs WA2="edge case focus")
- The Orchestrator synthesizes WA outputs, selecting the strongest elements from each perspective
- Single-WA is the EXCEPTION — requires explicit justification: "Single-WA because {reason}" (e.g., single-file mechanical change, no judgment involved)
- When multiple WAs run, each WA's output still gets independent RA verification

### Step B: Review Agent — Verification
**Launch:** Use Task tool to create a NEW Review Agent (separate from Work Agent) with the task description below.
- **RA Count Rule (MANDATORY):** The number of Review Agents MUST equal the number of Work Agents. WA N개 → RA N개. Each WA's output is reviewed by its own dedicated RA. A single RA reviewing multiple WAs' outputs violates agent pairing — it creates a bottleneck that undermines independent verification.
- **Independence Protocol (MANDATORY):** The Review Agent prompt MUST NOT include Work Agent's Execution Results. Provide only: (1) ticket's Acceptance Criteria and Verification sections, (2) the P/O/G template below. The Review Agent performs independent verification first. After Review Agent completes, the Orchestrator cross-references RA findings against WA Execution Results — discrepancies are findings.
- **Deletion Check (MANDATORY first step):** Run `git diff` (or `git diff HEAD` if changes are staged/committed) on all WA-modified files BEFORE any other verification. Scan deleted lines — any function, class, or export that disappeared without being mentioned in the ticket's Acceptance Criteria is a finding. Unintended deletion of existing code = automatic FAIL. If diff is empty (new files only, or already committed), use `git diff HEAD~1` or `git show` to compare against pre-WA state. If no diff is obtainable, state "Deletion Check: N/A — {reason}" and proceed.
- Verify runtime behavior of each work item (trigger → path → result)
- **Scope Note (from project RULES):** Conciseness applies to communication style, not to verification steps. P/O/G tables and evidence citations are required work product, not verbose output. Evidence IS the answer — "verified" without tool output is not verification. Fill Prediction before looking; fill Observation only from tool output.
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
- Confirm changes do not break existing functionality (Evidence Gate checkbox 6 — `git diff` deletion check — enforces this)
- Confirm edge case and exception handling
- **Devil's Advocate (single reviewer):** When only 1 Review Agent runs, it MUST include a Devil's Advocate section articulating the strongest counter-argument to its own PASS verdict. This prevents rubber-stamp reviews.
- Append results to `## Verification Results` section

### Step B.5: Cross-Review (when applicable)
- **Trigger:** If 2+ Review Agents ran independently (e.g., reviewing different work items in parallel), cross-review is MANDATORY before Step C.
- Review Agents read each other's findings and produce a Cross-Review Report (Contested Findings, Blind Spots, Consensus).
- Step C cannot proceed without this report when the trigger condition is met.
- The Orchestrator must explicitly determine whether cross-review was required.

### Step B.9: Verification Tool Check (Orchestrator — BEFORE Step C)
**Before starting Step C**, the Orchestrator MUST check:
1. Does `.crabshell/verification/manifest.json` exist in the project?
2. If YES → run `/verifying run` to execute verification tools against acceptance criteria. Include runner output in Step C evaluation.
3. If NO → invoke `/verifying` to create a verification manifest for this project. Then run `/verifying run`.
4. If the project has no executable runtime (e.g., pure documentation) → skip with explicit note: "Verification tool N/A: {reason}"

This step is PROCEDURAL — it happens every time, not when the Orchestrator "remembers" the rule.

### Step C: Orchestrator — Final Verification
**Performed by:** The Orchestrator (main conversation) — reads Work and Review Agent outputs, then evaluates independently.
- **Document-first rule:** Write your evaluation to `## Final Verification` in the T document FIRST using Write/Edit tool. After the document is updated, provide a brief summary to the user. The document update is the primary output; the conversation summary is secondary.
- Re-verify the Review Agent's verification (exhaustive where possible)
- Catch cases where "verification was claimed but not actually performed"
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
- This ticket is executed using the built-in agent structure above (Step A → Step B → Step C)
- 1 Ticket = 1 independent execution cycle

## Execution Results (Work Agent)
(appended after agent execution)

## Verification Results (Review Agent)
(appended after agent execution)

## Final Verification (Orchestrator)
(appended after agent execution)
### Correctness
### Coherence
### Improvement Opportunities
### Next Direction
#### Problems Found
#### Root Cause Hypothesis
#### Recommended Focus

## Cross-Review Report (if applicable)
(Populated when 2+ Review Agents ran independently. Contains: Contested Findings, Blind Spots, Consensus.)

## Log

---
### [{YYYY-MM-DD HH:MM}] Created
{work plan for this ticket}
```

### Step 5: Update ticket INDEX.md

Append row to `.crabshell/ticket/INDEX.md`:

```
| P{NNN}_T{NNN} | {title} | todo | {YYYY-MM-DD} | P{NNN} |
```

### Step 6: Update parent plan

Append to the **Tickets section** of the parent plan document:

```
- P{NNN}_T{NNN}: {title}
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
3. **Cascade to D/I:** Read parent plan's `Related` column in `.crabshell/plan/INDEX.md`. For each related D/I ID:
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
10. **Mandatory append of results:** Work Agent, Review Agent, and Orchestrator must each append their execution results to the corresponding section of the T document (Execution Results, Verification Results, Final Verification). Verification not recorded in the document is treated as not performed.
11. **Exhaustive verification standard:** Verification follows the VERIFICATION-FIRST principle in RULES (Predict → Execute → Compare). When no project verification tool exists, invoke the 'verifying' skill. Direct → indirect → explicitly "unverified".
12. **Regressing context transfer:** In the regressing loop, this T document's `## Final Verification > Next Direction` content is passed directly to the next cycle's P(n+1) document's Context. The Orchestrator must explicitly perform this transfer. (D is the top-level container and does not receive per-cycle context.)
13. **Regressing state update:** If `.crabshell/memory/regressing-state.json` exists and is active, update it after ticket creation using: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.ticketIds.push('{T-ID}');s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"`. Phase transition is handled automatically by the PostToolUse hook. Only applies when regressing-state.json exists — standalone ticketing usage is unaffected.
