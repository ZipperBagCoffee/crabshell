---
name: discussing
description: "Creates and updates discussion documents for recording decisions and ongoing dialogues. Use when starting a new discussion, recording a decision, or when the regressing skill needs a top-level container. Invoke with /discussing \"topic\" to create, or /discussing D001 to update. Not for investigation — use investigating skill instead."
---

# Discussion Document Skill

## Modes

- **Create mode:** `/discussing "title"` creates a new discussion.
- **Update mode:** `/discussing D001` appends a log entry to an existing discussion.

---

## Create Mode

Use when the argument is a title, not a D-prefixed ID.

### Step 1: Ensure folder exists

- **No `.crabshell/discussion/` folder:** create it and `.crabshell/discussion/INDEX.md` with the content below.
- **Folder without INDEX.md:** create `.crabshell/discussion/backup/`, move all existing files into it, then create INDEX.md. Tell the user: "Moved N existing files to .crabshell/discussion/backup/"
- **Folder with INDEX.md:** proceed.

INDEX.md content:
```
# Discussion Index

| ID | Title | Status | Created | Related |
|----|-------|--------|---------|---------|
```

### Step 2: Determine next ID

Glob `.crabshell/discussion/D*.md`. The next ID is the highest number + 1, zero-padded to 3 digits (D012 → D013). With no files, start at 001.

### Step 3: Create discussion document

Filename: `.crabshell/discussion/D{NNN}-{slug}.md`. `{slug}` is the title in kebab-case. Keep a non-English title as is, with hyphens for spaces.

**Before the questions below, present constraints unprompted:**

1. Read the `## Constraints` section of `.crabshell/project.md`.
2. Infer task-specific constraints from context, such as the topic, related D/P/I documents and the regressing cycle.
3. Show the user:
```
Constraint Check:
- [Project] {each constraint from project.md}
- [Inferred] {constraints from task context, e.g., "Per D{NNN}'s cycle plan, scope limited to X"}
Additional constraints? Silence = proceed.
```
4. Write the confirmed constraints to the D document's `## Constraints` section.

Ask the user:
1. **Intent:** Why is this discussion needed? What decision is being made?
2. **Context:** Related files, issues, prior discussions?
3. **Intent Anchor:** What are the specific, measurable outcomes? (IA items)

**Convergence Criteria (auto-detect):** First check whether `.crabshell/memory/regressing-state.json` exists with `active === true`.
- **Regressing active:** do not ask the user. Write one measurable criterion per IA item that says how it is verified: recorded evidence in a cycle ticket, a command exit code, or a numeric threshold. Add "Final Report written and D status: concluded". Each item must be checkable by reading documents or running a command; subjective wording such as "no new issues found" is invalid. Tell the user: "Convergence criteria auto-applied (regressing context detected)."
- **Not regressing:** ask: "Convergence Criteria: What observable conditions would indicate the goal is fully achieved? (For non-regressing, write 'Not applicable.')"

Then create the document:

```
---
type: discussion
id: D{NNN}
title: "{title}"
status: open
created: {YYYY-MM-DD}
tags: []
---

# D{NNN} - {title}

## Intent
{user's answer about intent}

## Context
{user's answer about context}

## Constraints
- [Project] {constraints from project.md}
- [Inferred] {constraints from task context}
- [User] {additional constraints from user, if any}

## Intent Anchor
- IA-1: {first intent anchor item}
- IA-2: {second intent anchor item}
(Finalized after confirmation with user)

## IA Source Mapping
| IA Item | User Statement (verbatim or near-verbatim) | Mapping Type |
|---------|---------------------------------------------|-------------|

**Unmapped check:** Every user-stated goal MUST map to at least one IA item. If any user statement has no IA mapping → HALT and ask user to confirm exclusion.
Mapping Type: `direct` (user explicitly stated) or `inferred` (derived from context, requires user confirmation)

## Convergence Criteria
{If regressing active (regressing-state.json active===true): auto-filled measurable items — one per IA item with its verification method (documented evidence, command exit, numeric threshold) + "Final Report written and D status: concluded". Must be checkable by the host goal evaluator by reading documents or running a command.
If NOT regressing: user's answer — observable conditions for "done", or "Not applicable — non-regressing discussion."}

## Plan
{How it will be built, settled here before any ticket. If it is not known yet, write one line "(placeholder — plan before tickets)" and fill it once the discussion settles it.}
**Approach:** {how it will be built, and why this way}
**Changes (file → what):** {each file → the function/section → what changes; one line per ticket-sized part}
**Order:** {which part first, and what depends on what}
**Rejected alternatives:** {each alternative considered → why not}
**Risks:** {what could break, and how it will be checked}
**Reader Structure:** {if a person will see or read the result: what they will do (task → where they look → the words there) and every visible text, built with the structuring skill. If nobody will: "none: <reason>"}
**Values:** {every name, list and number the work puts into code, and where each comes from (what the project declares, or a parameter with a default)}
**Structure:** {which modules and functions change, and why no special case or second copy of code is added}
**Start state:** {what an existing user's project looks like the day after the update, and how it keeps working}
**User burden:** {what the user has to do}
**Design review:** {a reviewer of the same or a higher model tier who did not write the plan reads only the plan and its files: "findings → fixes"; "none: <reason>" when the risk is low}
**Analysis:** {the evidence inspected — files, functions, measurements}
**Intent Check:** {every IA item maps to a change; at least one risk; approve or reject}
**User confirmation:** {the user's words approving this plan, with date — or "pending"}

## Discussion Log

---
### [{YYYY-MM-DD HH:MM}] Started
{Initial discussion topic or opening statement}
```

- **Document-first rule:** Write the D document with the Write tool before reporting to the user.

### Step 4: Update INDEX.md

Append this row to `.crabshell/discussion/INDEX.md`:

```
| [[D{NNN}-{slug}|D{NNN}]] | {title} | open | {YYYY-MM-DD} | |
```
The link target `D{NNN}-{slug}` is the basename of `.crabshell/discussion/D{NNN}-*.md` without `.md`.

### Step 5: Confirm to user

Tell the user: "Created D{NNN}. Discussion is open." Then name the next steps: settle the `## Plan`, fill its design lines and get the design review. Show the Plan to the user and record their confirmation under **User confirmation**. Only then create tickets with `/ticketing D{NNN} "title"`. No file-changing work starts before that.

---

## Update Mode

Use when the argument matches `D\d{3}`.

### Step 1: Read existing document

Glob and read `.crabshell/discussion/D{NNN}-*.md`. If it is missing, tell the user and stop.

### Step 2: Append log entry

Append to the end of the document:

```

---
### [{YYYY-MM-DD HH:MM}] {entry_type}
{content}
```

`entry_type` is a summary of the point (default), `Conclusion` when a conclusion is reached, or `Status change: {old} → {new}`.

- **Document-first rule:** Append the entry with the Edit tool before acknowledging in chat.

### Step 3: Update INDEX.md if status changed

On a status change, update this ID's status column in `.crabshell/discussion/INDEX.md`.

### Status Transitions

- `open` → `concluded` (decision reached)
- `open` → `abandoned` (no longer relevant)

---

## Rules

1. **Never modify existing content** in a discussion; only append to the Discussion Log. Exception: the `## Plan` section may be filled and revised until the first ticket exists; after that, a plan change is a `Plan revision` log entry with what changed, why, and the user's confirmation.
2. **Timestamps** use local time: `[YYYY-MM-DD HH:MM]`
3. **INDEX.md** is the only file whose existing content may change (the status column).
4. **The discussion carries the plan.** The user confirms the `## Plan` before any ticket. The Plan holds the approach, files and functions, order, rejected alternatives, risks, analysis and intent check. The design lines are Values, Structure, Start state, User burden and Design review. The docs guard blocks a new ticket while a design line is empty. Each ticket's `## Implementation Details` carries the plan's specifics for its part, and its `## Intent Fidelity` compares the result with this discussion. In regressing, each `Cycle {n} plan` log entry uses the fields regressing Step 4a lists, and its Intent Check approves it; the design lines stay in the `## Plan`. Tickets name this discussion as parent (`D{NNN}_T{NNN}`, created with `/ticketing D{NNN} "title"`) and are listed in INDEX.md's Related column. A discussion linked to an existing plan keeps its "→ See [[P{NNN}-{slug}|P{NNN}]]" entries.
5. **No parent transition while children incomplete:** Do not set a D to `concluded` while any of its tickets is neither `verified` nor `abandoned`, or a related existing plan is not `done`. Exception: a regressing Final Report that records the cycle cap or a user stop concludes the D and lists the open tickets.
6. **Concluding:** A discussion that is its tickets' parent is never concluded by the ticketing cascade; it concludes with its regressing Final Report or an explicit status change entry. Only a discussion linked to an existing plan auto-concludes when that plan becomes `done`.
7. **Mandatory work log:** After any work related to this discussion or its purpose, append a Discussion Log entry (`### [{YYYY-MM-DD HH:MM}] {entry_type}`), even when this skill was not explicitly invoked.
8. **Intent Anchor reference:** The parent must reference this discussion's Intent Anchor when writing each plan entry and while executing tickets. IA items are read-only evaluation criteria; never change them.
9. **Regressing context passing:** In regressing, this discussion contains all cycles. It stays open through all cycles and closes with the Final Report. Each cycle's plan and feedback transfer are log entries here (cycle plan entries). A discussion created for regressing must include an Intent Anchor item requiring '/verifying each cycle'.
10. **Verification** is Predict → Execute → Compare, by observation. Evidence citations are required work product, not verbosity to cut.
11. **IA Source Mapping is mandatory in regressing:** every IA item must trace to a user statement. Fill the IA Source Mapping table before the first cycle.
