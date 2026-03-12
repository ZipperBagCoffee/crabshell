---
name: discussing
description: "Create and update discussion documents. Use when starting a discussion with the user or recording an ongoing dialogue. Invoke with /discussing \"topic\" to create, or /discussing D001 to update."
---

# Discussion Document Skill

## Modes

This skill has two modes based on arguments:

- **Create mode:** `/discussing "제목"` — creates a new discussion document
- **Update mode:** `/discussing D001` — appends a log entry to an existing discussion

---

## Create Mode

When argument is a title string (not a D-prefixed ID):

### Step 1: Ensure folder exists

Check if `docs/discussion/` exists.

- **Folder does not exist:** Create it and create `docs/discussion/INDEX.md` with content below.
- **Folder exists but INDEX.md does NOT exist:** Pre-existing files detected. Create `docs/discussion/backup/`, move ALL existing files into it, then create INDEX.md. Report to user: "Moved N existing files to docs/discussion/backup/"
- **Folder exists and INDEX.md exists:** Already managed. Proceed.

INDEX.md content:
```
# Discussion Index

| ID | Title | Status | Created | Related |
|----|-------|--------|---------|---------|
```

### Step 2: Determine next ID

Glob `docs/discussion/D*.md` to find existing files.
Extract numeric part from filenames (e.g., D001 → 1, D012 → 12).
Next ID = max + 1, zero-padded to 3 digits.
If no files exist, start at 001.

### Step 3: Create discussion document

Filename: `docs/discussion/D{NNN}-{slug}.md`
- `{slug}` = title converted to kebab-case (Korean titles: keep Korean as-is with hyphens for spaces)

Ask the user:
1. **Intent:** Why is this discussion needed? What decision is being made?
2. **Context:** Related files, issues, prior discussions?

Then create the document:

```
# D{NNN} - {title}

## Intent (의도)
{user's answer about intent}

## Context (배경)
{user's answer about context}

## Discussion Log

---
### [{YYYY-MM-DD HH:MM}] 시작
{Initial discussion topic or opening statement}
```

### Step 4: Update INDEX.md

Append a new row to the table in `docs/discussion/INDEX.md`:

```
| D{NNN} | {title} | open | {YYYY-MM-DD} | |
```

### Step 5: Confirm to user

Tell the user: "Created D{NNN}. Discussion is open. Continue the dialogue and I'll record it."

---

## Update Mode

When argument matches `D\d{3}` pattern:

### Step 1: Read existing document

Read `docs/discussion/D{NNN}-*.md` (glob to find the file).
If not found, tell user and stop.

### Step 2: Append log entry

Append to the end of the document:

```

---
### [{YYYY-MM-DD HH:MM}] {entry_type}
{content}
```

Where `entry_type` is one of:
- A summary of the discussion point (default)
- `결론` — when a conclusion is reached
- `상태변경: {old} → {new}` — when status changes

### Step 3: Update INDEX.md if status changed

If the entry includes a status change, update the status column in `docs/discussion/INDEX.md` for this ID.

### Status Transitions

- `open` → `concluded` (decision reached)
- `open` → `abandoned` (no longer relevant)

---

## Rules

1. **NEVER modify existing content** in a discussion document. Only append to the Discussion Log section.
2. **Timestamps** use local time: `[YYYY-MM-DD HH:MM]`
3. **INDEX.md** is the only file where existing content may be modified (status column updates).
4. When the discussion leads to a plan, note in the log: "→ See P{NNN}" and update INDEX.md Related column.
