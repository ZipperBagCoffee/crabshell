---
name: ticketing
description: "Create and update ticket documents tied to a plan. Use when breaking a plan into session-sized work units. Invoke with /ticketing P001 \"topic\" to create, or /ticketing P001_T001 to update."
---

# Ticket Document Skill

## Modes

- **Create mode:** `/ticketing P001 "제목"` — creates a new ticket under plan P001
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

## Intent (의도)
{user's answer}

## Scope (범위)
할 것: {included}
안 할 것: {excluded}

## Acceptance Criteria (완료 조건)
- [ ] {criterion 1}
- [ ] {criterion 2}

## Verification (검증)
{criterion 1}: {how to verify — command to run, behavior to observe}
{criterion 2}: {how to verify}

## Log

---
### [{YYYY-MM-DD HH:MM}] 생성
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

Tell user: "Created P{NNN}_T{NNN}. Status: todo. Invoke workflow skill to begin execution."

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
- `작업 기록` — work notes, files changed, decisions made
- `검증 실행` — verification run with commands and results
- `검증 완료` — verification passed/failed with evidence
- `상태변경: {old} → {new}`

### Step 3: Update INDEX.md if status changed

Update ticket INDEX.md status column.

If ticket status → `verified`, also check: are ALL tickets for parent plan now verified?
If yes → update parent plan INDEX.md status to `done` and append log entry to plan document.

### Status Transitions

- `todo` → `in-progress` (work begins)
- `in-progress` → `done` (work complete, pending verification)
- `done` → `verified` (verification passed)
- `in-progress` → `blocked` (external dependency)
- `blocked` → `in-progress` (unblocked)

---

## Rules

1. **NEVER modify existing content.** Only append to Log section.
2. **Acceptance criteria checkboxes:** Never modify. Completion tracked in Log entries.
3. **`done` ≠ `verified`:** Work completion and verification are separate events with separate log entries.
4. **Verification at creation:** The Verification section MUST be filled at ticket creation time (before work starts). This is the TDD principle — define how you'll check before you build.
5. **"File contains X" is forbidden** in Verification section. Must describe observable behavior or runnable commands.
6. **INDEX.md** is the only file where existing content may be modified.
7. **Plan propagation:** When all tickets verified → auto-update plan status.
