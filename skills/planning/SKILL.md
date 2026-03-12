---
name: planning
description: "Create and update plan documents. Use when establishing a structured plan for implementation. Invoke with /planning \"topic\" to create, or /planning P001 to update."
---

# Plan Document Skill

## Modes

- **Create mode:** `/planning "제목"` — creates a new plan document
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

## Intent (의도)
{user's answer}

## Scope (범위)
포함: {included}
제외: {excluded}

## Plan (계획)
- [ ] 단계 1: {step}
- [ ] 단계 2: {step}
...

## Tickets
(티켓 생성 시 자동 기록)

## Verification Criteria (검증 기준)
{user's answer — must describe observable behavior}

## Log

---
### [{YYYY-MM-DD HH:MM}] 생성
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
- `승인` — user approved the plan
- `상태변경: {old} → {new}`
- `티켓 추가: P{NNN}_T{NNN}` — when a ticket is created (auto-appended by ticketing skill)

### Step 3: Update INDEX.md if needed

Update status column and/or Tickets column in `docs/plan/INDEX.md`.

### Status Transitions

- `draft` → `approved` (user approves — REQUIRED before tickets)
- `approved` → `in-progress` (first ticket starts work)
- `in-progress` → `done` (all tickets verified)
- any → `abandoned`

---

## Rules

1. **NEVER modify existing content.** Only append to Log section and Tickets section.
2. **Tickets section:** Only receives appended lines like `- P{NNN}_T{NNN}: {title}` when ticketing skill creates a ticket.
3. **Plan checkboxes:** Never modify. Progress is tracked in Log entries.
4. **INDEX.md** is the only file where status may be modified.
5. When plan comes from a discussion, note `D{NNN}` in INDEX.md Related column and add to first log entry.
