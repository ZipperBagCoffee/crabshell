---
name: ticketing
description: "Creates and updates ticket documents as executable work units tied to a discussion (or an existing plan). Use when breaking planned work into session-sized tasks with acceptance criteria and verification steps. Invoke with /ticketing D001 \"topic\" to create, or /ticketing D001_T001 to update. Each ticket uses parent-owned execution and verification with optional bounded delegation."
---

# Ticket Document Skill

## Modes

- **Create mode:** `/ticketing D001 "title"` — creates a new ticket under discussion D001 (the discussion carries the plan). `/ticketing P001 "title"` still creates a ticket under an existing plan P001.
- **Update mode:** `/ticketing D001_T001` (or `P001_T001`) — appends a log entry to an existing ticket

`{PARENT}` below is the parent ID: `D{NNN}` for a discussion, `P{NNN}` for an existing plan.

---

## Create Mode

When arguments are a parent ID (D### or P###) + title string:

### Step 1: Validate the parent

- **Discussion parent (`D{NNN}`):** read `.crabshell/discussion/INDEX.md` and find the row. If it is missing → error: "Discussion {ID} does not exist." If its status is `concluded` or `abandoned` → warn before creating. Its latest plan entry (for regressing, the `Cycle {n} plan` log entry) should hold the Analysis and Intent Check before tickets are created.
- **Plan parent (`P{NNN}`, existing plans):** read `.crabshell/plan/INDEX.md` and find the row. If it is missing → error: "Plan {ID} does not exist." If its status is `draft` → warn: "Plan {ID} is not yet approved. Create ticket anyway? (not recommended)". If `approved` or `in-progress` → proceed.

### Step 2: Ensure ticket folder exists

Check if `.crabshell/ticket/` exists.

- **Folder does not exist:** Create it and create `.crabshell/ticket/INDEX.md` with content below.
- **Folder exists but INDEX.md does NOT exist:** Pre-existing files detected. Create `.crabshell/ticket/backup/`, move ALL existing files into it, then create INDEX.md. Report to user: "Moved N existing files to .crabshell/ticket/backup/"
- **Folder exists and INDEX.md exists:** Already managed. Proceed.

INDEX.md content:
```
# Ticket Index

| ID | Title | Status | Created | Parent |
|----|-------|--------|---------|--------|
```

### Step 3: Determine next ticket ID

Glob `.crabshell/ticket/{PARENT}_T*.md` where {PARENT} is the parent ID.
Extract ticket numbers. Next = max + 1, zero-padded to 3 digits.
If no tickets for this parent, start at 001. A discussion that spans several regressing cycles keeps counting (`D119_T001`, `D119_T002`, …).

### Step 4a: Line-number pre-flight (MANDATORY for Scope authoring)

Before writing line-number references (e.g., "USER-MANUAL.md L290", "scripts/inject-rules.js:636") in the Scope or Acceptance Criteria sections, **verify each line number via grep or Read**:

1. For a target file + expected content (e.g., "where canonical phrase appears"), run `grep -n '<phrase>' <file>` — capture actual line number.
2. Include line number in Scope only if confirmed; otherwise use a semantic reference (e.g., "§Pressure System section" or "the `classifyAgent` function").
3. If line numbers drift due to subsequent edits, the ticket's Scope retains validity via semantic anchor.

This prevents ticket-Scope line-number drift (as observed when D100 T003 Scope cited STRUCTURE.md L350 but actual target was L70).

### Step 4: Create ticket document

Ask the user:
1. **Intent:** What part of the parent plan does this ticket fulfill? What changes after completion?
2. **Scope:** What to do / not do in this session?
3. **Acceptance Criteria:** Specific conditions for "done"
4. **Verification:** How to verify each acceptance criterion? (Must be executable commands or observable behavior. "File contains X" is NOT acceptable.)

Then create `.crabshell/ticket/{PARENT}_T{NNN}-{slug}.md`:

Read `references/ticket-template.md` (next to this file) and create the document from it, filling every `{…}` field. The template carries the execution flow each ticket records (Steps A, B, B.5, B.9, C): the parent owns implementation, decisive verification, and completion; delegation is optional and bounded.

### Step 5: Update ticket INDEX.md

Append row to `.crabshell/ticket/INDEX.md`:

```
| [[{PARENT}_T{NNN}-{slug}|{PARENT}_T{NNN}]] | {title} | todo | {YYYY-MM-DD} | [[{PARENT}-{slug}|{PARENT}]] |
```

### Step 6: Update the parent

- **Discussion parent:** add the ticket ID to the discussion's row in `.crabshell/discussion/INDEX.md` (Related column, when the INDEX has one — Codex-created INDEX files may not). Do not edit the discussion body here — the next `/discussing` log entry (the cycle's feedback transfer or a work log) lists the tickets.
- **Plan parent:** append to the **Tickets section** of the plan document:

```
- [[{PARENT}_T{NNN}-{slug}|{PARENT}_T{NNN}]]: {title}
```

  and add the ticket ID to the plan's Tickets column in `.crabshell/plan/INDEX.md`.

### Step 7: Confirm

Tell user: "Created {PARENT}_T{NNN}. Status: todo. Ready for execution."

---

## Update Mode

When argument matches `[DP]\d{3}_T\d{3}` (a discussion or plan parent):

### Step 1: Read existing ticket

Glob `.crabshell/ticket/{PARENT}_T{NNN}-*.md`. If not found, stop.

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

- **Discussion parent:** no cascade. A discussion parent is never concluded by this cascade — it spans several cycles and concludes only with its Final Report (regressing Step 5) or an explicit `/discussing` status change.
- **Plan parent (existing plans):**
  1. **Check parent plan:** Read `.crabshell/ticket/INDEX.md`, find ALL tickets for the same parent plan. Are ALL of them `verified`?
     - If NO → stop here.
     - If YES → continue cascade.
  2. **Close parent plan:** Update parent plan's status to `done` in `.crabshell/plan/INDEX.md`. Append log entry to plan document: `Status Change: in-progress → done (all tickets verified)`
  3. **Cascade to D/I:** Read parent plan's `Related` column in `.crabshell/plan/INDEX.md`. For each related D/I ID (stored as wikilinks `[[D{NNN}-{slug}|D{NNN}]]` or bare IDs — extract the ID portion). **Skip a discussion that is the active regressing discussion (`regressing-state.json` `discussion`) or that parents its own tickets (`D{NNN}_T{NNN}` rows in the ticket INDEX)** — it spans cycles and concludes only with its Final Report:
     - **Cross-check:** Read that D/I's Related column in its INDEX.md. If it references OTHER plans besides the one just completed, check those plans' statuses too. ALL related plans must be `done` before concluding.
     - If all related plans done → update D/I status to `concluded`, append log entry: `Status Change: open → concluded (all related plans completed)`
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
7. **Plan propagation (plan parents only):** When all tickets of a plan are verified → auto-update the plan status. Discussion parents are not propagated.
8. **1 Ticket = 1 independent execution cycle:** Each ticket is executed as a separate, independent agent cycle. Never batch multiple tickets into a single execution. 3 tickets = 3 separate executions.
9. **Mandatory work log:** After performing any work related to this document, append a log entry to the Log section using the existing format (`### [{YYYY-MM-DD HH:MM}] {entry_type}`). This applies regardless of whether this skill was explicitly invoked — if the work touched or advanced this ticket's purpose, log it.
10. **Mandatory append of results:** The parent must append execution, direct verification, and final evaluation to the corresponding T sections. If delegation/review was used, its evidence and the parent's disposition must also be recorded. Verification not recorded in the document is treated as not performed. Before completion, the parent reads the T document and confirms all three required sections no longer contain `placeholder`; optional review notes are not a completion gate.
11. **Exhaustive verification standard:** Verification follows the VERIFICATION-FIRST principle in RULES (Predict → Execute → Compare). When no project verification tool exists, invoke the 'verifying' skill. Direct → indirect → explicitly "unverified".
12. **Regressing context transfer:** In the regressing loop, this T document's `## Final Verification > Next Direction` content is passed to the next cycle plan entry's Context (in the D log; for sessions still using plans, the next P document's Context). The Orchestrator must explicitly perform this transfer. (D is the top-level container and does not receive per-cycle context.)
13. **Regressing state update:** If `.crabshell/memory/regressing-state.json` exists and is active, and the ticket belongs to that workflow (its parent is the state's `discussion` or `planId`), update it after ticket creation using: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.ticketIds.push('{T-ID}');s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"`. Phase transition is handled automatically by the PostToolUse hook. Only applies when regressing-state.json exists — standalone ticketing usage is unaffected. Tickets for other work (a one-pass record in another session) are not added to the cycle.
14. **No autonomous code writes:** Every Write/Edit to a code file must trace to an explicit Acceptance Criterion in this ticket. If a code file write is not covered by an AC, STOP — either add an AC (if in scope) or raise an Open Question. Completion drive = writing beyond the ticket's AC scope.
