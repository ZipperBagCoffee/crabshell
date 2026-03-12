---
name: researching
description: "Create and update research documents. Use when investigating a topic, analyzing code, or gathering information. Invoke with /researching \"topic\" to create, or /researching R001 to update."
---

# Research Document Skill

## Modes

- **Create mode:** `/researching "제목"` — creates a new research document
- **Update mode:** `/researching R001` — appends a log entry to an existing research

---

## Create Mode

When argument is a title string (not an R-prefixed ID):

### Step 1: Ensure folder exists

Check if `docs/research/` exists. If not, create it and create `docs/research/INDEX.md`:

```
# Research Index

| ID | Title | Status | Created | Related |
|----|-------|--------|---------|---------|
```

### Step 2: Determine next ID

Glob `docs/research/R*.md`.
Extract numeric part. Next ID = max + 1, zero-padded to 3 digits.
If no files exist, start at 001.

### Step 3: Create research document

Ask the user:
1. **Intent:** What are you trying to find out? Why is this research needed?
2. **Questions:** What specific questions need answers?

Then create `docs/research/R{NNN}-{slug}.md`:

```
# R{NNN} - {title}

## Intent (의도)
{user's answer}

## Questions (질문)
1. {question 1}
2. {question 2}
...

## Log

---
### [{YYYY-MM-DD HH:MM}] 조사 시작
{methodology, initial sources, approach}
```

### Step 4: Update INDEX.md

Append row to `docs/research/INDEX.md`:

```
| R{NNN} | {title} | open | {YYYY-MM-DD} | |
```

### Step 5: Confirm

Tell user: "Created R{NNN}. Research is open. I'll record findings as we go."

---

## Update Mode

When argument matches `R\d{3}` pattern:

### Step 1: Read existing document

Glob `docs/research/R{NNN}-*.md`. If not found, stop.

### Step 2: Append log entry

Append to end of document:

```

---
### [{YYYY-MM-DD HH:MM}] {entry_type}
{content}
```

Entry types:
- `발견사항` — findings, data, analysis results
- `결론` — answers to each Question, with evidence and limitations
- `상태변경: {old} → {new}`

### Step 3: Update INDEX.md if status changed

Update status column in `docs/research/INDEX.md`.

### Status Transitions

- `open` → `concluded` (all questions answered)
- `open` → `abandoned` (no longer relevant)

---

## Rules

1. **NEVER modify existing content.** Only append to Log section.
2. **결론 entry** must answer each Question from the Questions section individually, with evidence and limitations.
3. **INDEX.md** is the only file where existing content may be modified.
4. When research leads to a discussion or plan, note in log: "→ See D{NNN}" or "→ See P{NNN}" and update INDEX.md Related column.
