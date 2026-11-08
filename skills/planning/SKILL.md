---
name: planning
description: "Crabshell no longer creates plan documents: a new plan is written into its discussion's Plan section and confirmed by the user, then tickets hang off that discussion (/discussing D001, /ticketing D001 \"title\"). Use /planning P001 only to append a log entry to an existing plan document."
---

# Plan Document Skill (existing plans only)

## New plans go into the discussion

The workflow is D (a discussion that carries the plan) → T. Do not create a P document. When invoked with a title, tell the user that new plans go into the discussion and continue with step 1.

1. Open a discussion with `/discussing "topic"`, or use an existing one with `/discussing D{NNN}`. Write every field of its `## Plan` that the discussing template lists. Show the plan to the user and record their confirmation. Once tickets exist, a plan change is a `Plan revision` log entry instead. In regressing, the plan is Step 4a's `Cycle {n} plan` entry, with the same fields.
2. Create tickets with `/ticketing D{NNN} "title"`. Each carries its part of the plan in `## Implementation Details`.

The parent owns plan analysis and intent fidelity. An optional independent review receives the intent, scope and criteria, never the parent's conclusions.

Existing P documents stay readable and searchable; their tickets (`P{NNN}_T{NNN}`) keep working.

---

## Update Mode

Use when the argument matches `P\d{3}`.

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
- `Approved` — the user approved the plan
- `Status change: {old} → {new}`
- `Ticket added: P{NNN}_T{NNN}` — the ticketing skill appends it when a ticket is created

### Step 3: Update INDEX.md if needed

Update the status column, the Tickets column, or both in `.crabshell/plan/INDEX.md`.

### Status Transitions

- `draft` → `approved` (the user approves; required before tickets)
- `approved` → `in-progress` (first ticket starts work)
- `in-progress` → `done` (only when all related tickets are `verified`)
- any → `abandoned`


## Rules (existing plans)

1. **Never modify existing content.** Only append to the Log section, the Tickets section, and the result sections: Analysis Results, Review Results, Intent Check.
2. **Plan checkboxes:** Never modify them. Track progress in Log entries.
3. **INDEX.md** is the only file where status may be modified.
4. **Mandatory work log:** After any work related to an existing plan, append a log entry (`### [{YYYY-MM-DD HH:MM}] {entry_type}`).
