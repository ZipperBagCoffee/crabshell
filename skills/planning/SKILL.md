---
name: planning
description: "Creates and updates structured plan documents with agent-verified execution strategy. Use when establishing an implementation plan after a discussion, or when breaking work into steps before ticketing. Invoke with /planning \"topic\" to create, or /planning P001 to update. Not for direct execution — create tickets first."
---

# Plan Document Skill

## Modes

- **Create mode:** `/planning "title"` — creates a new plan document
- **Update mode:** `/planning P001` — appends a log entry to an existing plan

---

## Create Mode

When argument is a title string (not a P-prefixed ID):

### Step 1: Ensure folder exists

Check if `docs/plan/` exists.

- **Folder does not exist:** Create it and create `docs/plan/INDEX.md` with content below.
- **Folder exists but INDEX.md does NOT exist:** Pre-existing files detected. Create `docs/plan/backup/`, move ALL existing files into it, then create INDEX.md. Report to user: "Moved N existing files to docs/plan/backup/"
- **Folder exists and INDEX.md exists:** Already managed. Proceed.

INDEX.md content:
```
# Plan Index

| ID | Title | Status | Created | Related | Tickets |
|----|-------|--------|---------|---------|---------|
```

### Step 2: Determine next ID

Glob `docs/plan/P*.md` (exclude files matching `P\d{3}_T` pattern to avoid tickets in wrong folder).
Extract numeric part. Next ID = max + 1, zero-padded to 3 digits.
If no files exist, start at 001.

### Step 3: Create plan document

Ask the user:
1. **Intent:** What is this plan's purpose? What are the success conditions?
2. **Scope:** What's included / excluded?
3. **Plan steps:** What are the high-level steps?
4. **Verification criteria:** How do we know the plan succeeded? (Observable behavior, not "file contains X")

Then create `docs/plan/P{NNN}-{slug}.md`:

```
# P{NNN} - {title}

## Intent
{user's answer}

## Scope
Included: {included}
Excluded: {excluded}

## Plan
- [ ] Step 1: {step}
- [ ] Step 2: {step}
...

## Agent Execution

This plan is executed using the following agent structure:

### Step A: Work Agent — Analysis + Plan Writing
- Analyze related code/system
- Identify dependencies and impact scope
- Write concrete execution plan
- Append results to `## Analysis Results` section

### Step B: Review Agent — Plan Quality Verification
- Verify completeness and accuracy of analysis
- Review feasibility of plan
- Identify risks and missing items
- Append results to `## Review Results` section

### Step C: Orchestrator — Intent Check
- Compare against D document's Intent Anchor (IA)
- Confirm plan has not deviated from original intent
- Decide to approve or reject
- Append results to `## Intent Check` section

## Tickets
(Automatically recorded when tickets are created)

## Analysis Results (Work Agent)
(Appended after agent execution)

## Review Results (Review Agent)
(Appended after agent execution)

## Intent Check (Orchestrator)
(Appended after agent execution)

## Verification Criteria
{user's answer — must describe observable behavior}

## Log

---
### [{YYYY-MM-DD HH:MM}] Created
{background/motivation for this plan}
```

### Step 4: Update INDEX.md

Append row to `docs/plan/INDEX.md`:

```
| P{NNN} | {title} | draft | {YYYY-MM-DD} | | |
```

### Step 5: Confirm

Tell user: "Created P{NNN} in draft status. Review and approve before creating tickets."

---

## Update Mode

When argument matches `P\d{3}` pattern:

### Step 1: Read existing document

Glob `docs/plan/P{NNN}-*.md`. If not found, stop.

### Step 2: Append log entry

Append to end of document:

```

---
### [{YYYY-MM-DD HH:MM}] {entry_type}
{content}
```

Entry types:
- General update (default)
- `Approved` — user approved the plan
- `Status change: {old} → {new}`
- `Ticket added: P{NNN}_T{NNN}` — when a ticket is created (auto-appended by ticketing skill)

### Step 3: Update INDEX.md if needed

Update status column and/or Tickets column in `docs/plan/INDEX.md`.

### Status Transitions

- `draft` → `approved` (user approves — REQUIRED before tickets)
- `approved` → `in-progress` (first ticket starts work)
- `in-progress` → `done` (all tickets verified)
- any → `abandoned`

---

## Rules

1. **NEVER modify existing content.** Only append to Log section, Tickets section, and agent result sections (Analysis Results, Review Results, Intent Check).
2. **Tickets section:** Only receives appended lines like `- P{NNN}_T{NNN}: {title}` when ticketing skill creates a ticket.
3. **Plan checkboxes:** Never modify. Progress is tracked in Log entries.
4. **INDEX.md** is the only file where status may be modified.
5. When plan comes from a discussion/research, note `D{NNN}` or `R{NNN}` in INDEX.md Related column and add to first log entry.
6. **No parent transition while children incomplete:** P can only transition to `done` when ALL related tickets are `verified`. If any ticket is incomplete, refuse `done` transition.
7. **Auto-conclude parent on completion:** When P becomes `done` → automatically update D/R in Related column to `concluded` and append log to those documents. (Triggered by ticketing cascade)
8. **Mandatory work log:** After performing any work related to this document, append a log entry to the Log section using the existing format (`### [{YYYY-MM-DD HH:MM}] {entry_type}`). This applies regardless of whether this skill was explicitly invoked — if the work touched or advanced this plan's purpose, log it.
9. **Mandatory verification result append:** Work Agent, Review Agent, and Orchestrator MUST append their execution results to the corresponding sections of the P document (Analysis Results, Review Results, Intent Check). Verbal reporting alone is insufficient — verification not recorded in the document is equivalent to verification not performed.
10. **Exhaustive verification standard:** **Definition of verification:** Verification = closing the gap between belief and reality through observation. Direct execution + observation is the top priority; indirect means only when direct execution is not feasible. — Verification must go beyond "exists in file" to confirming actual executability and behavior. What can be directly verified, verify directly; what can only be indirectly verified, use all available indirect means; what cannot be verified, explicitly mark as "unverified".
