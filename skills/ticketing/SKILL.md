---
name: ticketing
description: "Create and update ticket documents tied to a plan. Use when breaking a plan into session-sized work units. Invoke with /ticketing P001 \"topic\" to create, or /ticketing P001_T001 to update."
---

# Ticket Document Skill

## Modes

- **Create mode:** `/ticketing P001 "title"` — creates a new ticket under plan P001
- **Update mode:** `/ticketing P001_T001` — appends a log entry to an existing ticket

---

## Create Mode

When arguments are a Plan ID + title string:

### Step 1: Validate parent plan

Read `docs/plan/INDEX.md`. Find the row for the given Plan ID.
- If plan not found → error: "Plan {ID} does not exist."
- If plan status is `draft` → warn: "Plan {ID} is not yet approved. Create ticket anyway? (not recommended)"
- If plan status is `approved` or `in-progress` → proceed

### Step 2: Ensure ticket folder exists

Check if `docs/ticket/` exists.

- **Folder does not exist:** Create it and create `docs/ticket/INDEX.md` with content below.
- **Folder exists but INDEX.md does NOT exist:** Pre-existing files detected. Create `docs/ticket/backup/`, move ALL existing files into it, then create INDEX.md. Report to user: "Moved N existing files to docs/ticket/backup/"
- **Folder exists and INDEX.md exists:** Already managed. Proceed.

INDEX.md content:
```
# Ticket Index

| ID | Title | Status | Created | Plan |
|----|-------|--------|---------|------|
```

### Step 3: Determine next ticket ID

Glob `docs/ticket/P{NNN}_T*.md` where P{NNN} is the parent plan.
Extract ticket numbers. Next = max + 1, zero-padded to 3 digits.
If no tickets for this plan, start at 001.

### Step 4: Create ticket document

Ask the user:
1. **Intent:** What part of the parent plan does this ticket fulfill? What changes after completion?
2. **Scope:** What to do / not do in this session?
3. **Acceptance Criteria:** Specific conditions for "done"
4. **Verification:** How to verify each acceptance criterion? (Must be executable commands or observable behavior. "File contains X" is NOT acceptable.)

Then create `docs/ticket/P{NNN}_T{NNN}-{slug}.md`:

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
- Execute tasks according to the plan (P)
- Record results for each work item
- Append results to `## Execution Results` section

### Step B: Review Agent — Verification
- Verify runtime behavior of each work item (trigger → path → result)
- Confirm changes do not break existing functionality
- Confirm edge case and exception handling
- Append results to `## Verification Results` section

### Step C: Orchestrator — Final Verification
- Re-verify the Review Agent's verification (exhaustive where possible)
- Catch cases where "verification was claimed but not actually performed"
- 3-factor evaluation:
  1. **Correctness**: Was it done correctly?
  2. **Improvement Opportunities**: Was there a better approach?
  3. **Next Direction**: What should be done next?
- Append results to `## Final Verification` section

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
### Improvement Opportunities
### Next Direction

## Log

---
### [{YYYY-MM-DD HH:MM}] Created
{work plan for this ticket}
```

### Step 5: Update ticket INDEX.md

Append row to `docs/ticket/INDEX.md`:

```
| P{NNN}_T{NNN} | {title} | todo | {YYYY-MM-DD} | P{NNN} |
```

### Step 6: Update parent plan

Append to the **Tickets section** of the parent plan document:

```
- P{NNN}_T{NNN}: {title}
```

Also update `docs/plan/INDEX.md` Tickets column to include the new ticket ID.

### Step 7: Confirm

Tell user: "Created P{NNN}_T{NNN}. Status: todo. Ready for execution."

---

## Update Mode

When argument matches `P\d{3}_T\d{3}` pattern:

### Step 1: Read existing ticket

Glob `docs/ticket/P{NNN}_T{NNN}-*.md`. If not found, stop.

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

1. **Check parent plan:** Read `docs/ticket/INDEX.md`, find ALL tickets for the same parent plan. Are ALL of them `verified`?
   - If NO → stop here.
   - If YES → continue cascade.
2. **Close parent plan:** Update parent plan's status to `done` in `docs/plan/INDEX.md`. Append log entry to plan document: `Status Change: in-progress → done (all tickets verified)`
3. **Cascade to D/R:** Read parent plan's `Related` column in `docs/plan/INDEX.md`. For each related D/R ID:
   - **Cross-check:** Read that D/R's Related column in its INDEX.md. If it references OTHER plans besides the one just completed, check those plans' statuses too. ALL related plans must be `done` before concluding.
   - If all related plans done → update D/R status to `concluded`, append log entry: `Status Change: open → concluded (all related plans completed)`
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
11. **Exhaustive verification standard:** **Verification definition:** Verification = closing the gap between belief and reality through observation. Direct execution + observation is the top priority; indirect means only when direct execution is impractical. — Verification must be at the level of confirming actual runtime behavior. If direct verification is possible → execute directly; if only indirect is possible → use all indirect means; if impossible → explicitly state "unverified".
12. **Regressing context transfer:** In the regressing loop, this T document's `## Final Verification > Next Direction` content is passed to the next cycle D(n+1) document's `## Context` section. The Orchestrator must explicitly perform this transfer.
