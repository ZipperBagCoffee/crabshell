---
name: planning
description: "Crabshell no longer creates plan documents: a new plan is written into its discussion as a log entry, then tickets hang off that discussion (/discussing D001, /ticketing D001 \"title\"). Use /planning P001 only to append a log entry to an existing plan document."
---

# Plan Document Skill (existing plans only)

## New plans go into the discussion

The document workflow is D (a discussion that carries the plan) → T. A new plan is not a separate document:

1. Invoke `/discussing D{NNN}` (or `/discussing "topic"` to open one) and append a plan entry to the discussion log with **Intent**, **Context**, **Scope** (included / excluded), **Steps**, **Analysis** (the evidence inspected — files, functions, measurements) and **Intent Check** (against the discussion's Intent Anchor, at least one risk, approve or reject). In regressing this is Step 4a's `Cycle {n} plan` entry.
2. Create tickets under the discussion: `/ticketing D{NNN} "title"`.

The parent owns plan analysis and intent fidelity; an optional independent review receives the intent, scope and criteria, not the parent's conclusions.

When this skill is invoked with a title (the former create mode), do not create a P document: tell the user that new plans go into the discussion and continue with step 1.

Existing P documents stay readable and searchable, and their tickets (`P{NNN}_T{NNN}`) keep working.

---

## Update Mode

When argument matches `P\d{3}` pattern:

### Step 1: Read existing document

Glob `.crabshell/plan/P{NNN}-*.md`. If not found, stop.

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

Update status column and/or Tickets column in `.crabshell/plan/INDEX.md`.

### Status Transitions

- `draft` → `approved` (user approves — REQUIRED before tickets)
- `approved` → `in-progress` (first ticket starts work)
- `in-progress` → `done` (all tickets verified)
- any → `abandoned`


## Rules (existing plans)

1. **NEVER modify existing content.** Only append to the Log section, the Tickets section, and the result sections (Analysis Results, Review Results, Intent Check).
2. **Plan checkboxes:** Never modify. Progress is tracked in Log entries.
3. **INDEX.md** is the only file where status may be modified.
4. **No parent transition while children incomplete:** P can only transition to `done` when ALL related tickets are `verified`.
5. **Mandatory work log:** After performing any work related to an existing plan, append a log entry using `### [{YYYY-MM-DD HH:MM}] {entry_type}`.
