---
name: discussing
description: "Creates and updates discussion documents for recording decisions and ongoing dialogues. Use when starting a new discussion, recording a decision, or when the regressing skill needs a top-level container. Invoke with /discussing \"topic\" to create, or /discussing D001 to update. Not for investigation — use investigating skill instead."
---

# Discussion Document Skill

## Modes

This skill has two modes based on arguments:

- **Create mode:** `/discussing "title"` — creates a new discussion document
- **Update mode:** `/discussing D001` — appends a log entry to an existing discussion

---

## Create Mode

When argument is a title string (not a D-prefixed ID):

### Step 1: Ensure folder exists

Check if `.crabshell/discussion/` exists.

- **Folder does not exist:** Create it and create `.crabshell/discussion/INDEX.md` with content below.
- **Folder exists but INDEX.md does NOT exist:** Pre-existing files detected. Create `.crabshell/discussion/backup/`, move ALL existing files into it, then create INDEX.md. Report to user: "Moved N existing files to .crabshell/discussion/backup/"
- **Folder exists and INDEX.md exists:** Already managed. Proceed.

INDEX.md content:
```
# Discussion Index

| ID | Title | Status | Created | Related |
|----|-------|--------|---------|---------|
```

### Step 2: Determine next ID

Glob `.crabshell/discussion/D*.md` to find existing files.
Extract numeric part from filenames (e.g., D001 → 1, D012 → 12).
Next ID = max + 1, zero-padded to 3 digits.
If no files exist, start at 001.

### Step 3: Create discussion document

Filename: `.crabshell/discussion/D{NNN}-{slug}.md`
- `{slug}` = title converted to kebab-case (non-English titles: keep as-is with hyphens for spaces)

Ask the user:
1. **Intent:** Why is this discussion needed? What decision is being made?
2. **Context:** Related files, issues, prior discussions?
3. **Intent Anchor:** What are the specific, measurable outcomes? (IA items)

Then create the document:

```
# D{NNN} - {title}

## Intent
{user's answer about intent}

## Context
{user's answer about context}

## Intent Anchor
- IA-1: {first intent anchor item}
- IA-2: {second intent anchor item}
(Finalized after confirmation with user)

## IA Source Mapping
| IA Item | User Statement (verbatim or near-verbatim) | Mapping Type |
|---------|---------------------------------------------|-------------|

**Unmapped check:** Every user-stated goal MUST map to at least one IA item. If any user statement has no IA mapping → HALT and ask user to confirm exclusion.
Mapping Type: `direct` (user explicitly stated) or `inferred` (derived from context, requires user confirmation)

## Discussion Log

---
### [{YYYY-MM-DD HH:MM}] Started
{Initial discussion topic or opening statement}
```

### Step 4: Update INDEX.md

Append a new row to the table in `.crabshell/discussion/INDEX.md`:

```
| D{NNN} | {title} | open | {YYYY-MM-DD} | |
```

### Step 5: Confirm to user

Tell the user: "Created D{NNN}. Discussion is open. Continue the dialogue and I'll record it."

---

## Update Mode

When argument matches `D\d{3}` pattern:

### Step 1: Read existing document

Read `.crabshell/discussion/D{NNN}-*.md` (glob to find the file).
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
- `Conclusion` — when a conclusion is reached
- `Status change: {old} → {new}` — when status changes

### Step 3: Update INDEX.md if status changed

If the entry includes a status change, update the status column in `.crabshell/discussion/INDEX.md` for this ID.

### Status Transitions

- `open` → `concluded` (decision reached)
- `open` → `abandoned` (no longer relevant)

---

## Rules

1. **NEVER modify existing content** in a discussion document. Only append to the Discussion Log section.
2. **Timestamps** use local time: `[YYYY-MM-DD HH:MM]`
3. **INDEX.md** is the only file where existing content may be modified (status column updates).
4. When the discussion leads to a plan, note in the log: "→ See P{NNN}" and update INDEX.md Related column.
5. **No parent transition while children incomplete:** If a related P exists and is not yet `done` → do not transition D to `concluded`. Can only conclude when related plan is completed.
6. **Auto-conclude:** When related P becomes `done`, D is automatically set to `concluded` by ticketing cascade. No manual conclusion needed.
7. **Mandatory work log:** After performing any work related to this document, append a log entry to the Discussion Log section using the existing format (`### [{YYYY-MM-DD HH:MM}] {entry_type}`). This applies regardless of whether this skill was explicitly invoked — if the work touched or advanced this discussion's purpose, log it.
8. **Orchestrator reference obligation:** Orchestrator MUST reference this D document's Intent Anchor during P (planning) and T (execution) stages. IA items are read-only evaluation criteria and cannot be modified.
9. **Regressing context passing:** In regressing mode, this D document serves as the top-level container for all cycles. The D stays open throughout all cycles and closes with the final report. Cycle feedback (T(n) → P(n+1)) bypasses D and goes directly between T and P documents. **When created for regressing mode, the Intent Anchor MUST include an item requiring '/verifying each cycle' — this anchors the verification tool check as a first-class IA requirement, not just a procedural step.**
10. **Scope Note:** In this project, verification means closing the gap between belief and reality through observation (Predict → Execute → Compare). Evidence citations are required work product, not verbose output.
11. **IA Source Mapping is mandatory for regressing mode.** Every IA item must trace to a user statement. The IA Source Mapping table must be populated before proceeding to the first cycle.
