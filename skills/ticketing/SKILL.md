---
name: ticketing
description: "Creates and updates ticket documents as executable work units tied to a discussion (or an existing plan). Use when breaking planned work into session-sized tasks with acceptance criteria and verification steps. Invoke with /ticketing D001 \"topic\" to create, or /ticketing D001_T001 to update. Each ticket uses parent-owned execution and verification; independent parts go to parallel workers."
---

# Ticket Document Skill

## Modes

- **Create mode:** `/ticketing D001 "title"` creates a ticket under discussion D001. `/ticketing P001 "title"` creates one under an existing plan P001.
- **Update mode:** `/ticketing D001_T001` or `/ticketing P001_T001` appends a log entry to an existing ticket.

`{PARENT}` is the parent ID: `D{NNN}` for a discussion, `P{NNN}` for an existing plan.

---

## Create Mode

Use when the arguments are a parent ID (D### or P###) and a title.

### Step 1: Validate the parent

- **Discussion parent (`D{NNN}`):** find its row in `.crabshell/discussion/INDEX.md`. No row → error: "Discussion {ID} does not exist." Status `concluded` or `abandoned` → warn before creating. Then read the plan: the `## Plan` section, or in regressing the latest `Cycle {n} plan` log entry. STOP and tell the user the Plan comes first when any of these holds:
  - The plan is missing or still `(placeholder`.
  - Outside regressing, **User confirmation** is missing or "pending".
  - One of the design lines is empty: **Values:**, **Structure:**, **Start state:**, **User burden:**, **Design review:**. `none: <reason>` counts as filled.

  Then write the plan with `/discussing D{NNN}`, show it to the user, record their confirmation, and create the ticket. The docs guard also blocks a new ticket when the plan, the Reader Structure line or one of the design lines is missing.
- **Plan parent (`P{NNN}`, existing plans):** find its row in `.crabshell/plan/INDEX.md`. No row → error: "Plan {ID} does not exist." Status `draft` → warn: "Plan {ID} is not yet approved. Create ticket anyway? (not recommended)". Status `approved` or `in-progress` → proceed.

### Step 2: Ensure ticket folder exists

- **No `.crabshell/ticket/` folder:** create it and `.crabshell/ticket/INDEX.md` with the content below.
- **Folder without INDEX.md:** create `.crabshell/ticket/backup/`, move all existing files into it, then create INDEX.md. Tell the user: "Moved N existing files to .crabshell/ticket/backup/"
- **Folder with INDEX.md:** proceed.

INDEX.md content:
```
# Ticket Index

| ID | Title | Status | Created | Parent |
|----|-------|--------|---------|--------|
```

### Step 3: Determine next ticket ID

Glob `.crabshell/ticket/{PARENT}_T*.md`. The next number is the highest + 1, zero-padded to 3 digits. With no tickets for this parent, start at 001. Numbering continues across the regressing cycles of one discussion.

### Step 4a: Line-number pre-flight (MANDATORY for Scope authoring)

Before writing line numbers (such as `scripts/inject-rules.js:636`) in Scope or Acceptance Criteria, confirm each one with `grep -n '<phrase>' <file>` or Read. Write a line number only if confirmed. Otherwise name the section or function, such as "the `classifyAgent` function".

### Step 4: Create ticket document

Ask the user:
1. **Intent:** What part of the parent plan does this ticket fulfill? What changes after completion?
2. **Scope:** What to do / not do in this session?
3. **Acceptance Criteria:** Specific conditions for "done"
4. **Verification:** How to verify each acceptance criterion? Rule 5 sets what counts.

Then create `.crabshell/ticket/{PARENT}_T{NNN}-{slug}.md` from `references/ticket-template.md` (next to this file), filling every `{…}` field. Fill `## Implementation Details` with this ticket's part of the discussion's plan: each file → function/section → what changes, formats, order. Make it specific enough to build from the ticket alone. A new ticket with empty or "TBD" Implementation Details is blocked. The template carries the execution flow (Steps A, B, B.5, C).

### Step 5: Update ticket INDEX.md

Append row to `.crabshell/ticket/INDEX.md`:

```
| [[{PARENT}_T{NNN}-{slug}|{PARENT}_T{NNN}]] | {title} | todo | {YYYY-MM-DD} | [[{PARENT}-{slug}|{PARENT}]] |
```

### Step 6: Update the parent

- **Discussion parent:** add the ticket ID to the Related column of the discussion's row in `.crabshell/discussion/INDEX.md`, when that column exists. Do not edit the discussion body here; the next `/discussing` log entry lists the tickets.
- **Plan parent:** append to the **Tickets section** of the plan document:

```
- [[{PARENT}_T{NNN}-{slug}|{PARENT}_T{NNN}]]: {title}
```

  and add the ticket ID to the plan's Tickets column in `.crabshell/plan/INDEX.md`.

### Step 7: Confirm

Tell user: "Created {PARENT}_T{NNN}. Status: todo. Ready for execution."

---

## Update Mode

Use when the argument matches `[DP]\d{3}_T\d{3}`.

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

When a ticket becomes `verified`:

- **Discussion parent:** no cascade. A discussion parent is never concluded by this cascade; it concludes only with its Final Report (regressing Step 5) or an explicit `/discussing` status change.
- **Plan parent (existing plans):**
  1. **Check parent plan:** in `.crabshell/ticket/INDEX.md`, if any ticket of the same plan is not `verified`, stop.
  2. **Close parent plan:** set the plan's status to `done` in `.crabshell/plan/INDEX.md`. Append a log entry to the plan: `Status Change: in-progress → done (all tickets verified)`
  3. **Cascade to D/I:** take each D/I ID from the plan's `Related` column in `.crabshell/plan/INDEX.md`; it is a wikilink `[[D{NNN}-{slug}|D{NNN}]]` or a bare ID. Skip a discussion that is the active regressing discussion (`regressing-state.json` `discussion`) or has its own `D{NNN}_T{NNN}` rows in the ticket INDEX.
     - **Cross-check:** read that D/I's Related column in its INDEX.md. Every plan listed there must be `done` before it concludes.
     - All done → set the D/I status to `concluded` and append a log entry to it: `Status Change: open → concluded (all related plans completed)`
     - Any still open → do not conclude. Append a log entry to it: `P{NNN} completed, conclusion deferred due to other related plans still incomplete`

### Status Transitions

- `todo` → `in-progress` (work begins)
- `in-progress` → `done` (work complete, pending verification)
- `done` → `verified` (verification passed)
- `in-progress` → `blocked` (external dependency)
- `blocked` → `in-progress` (unblocked)

---

## Rules

1. **Never modify existing content.** Only append to the Log and the result sections: Execution Results, Verification Results, Reader Check, Intent Fidelity, Final Verification.
2. **Acceptance criteria checkboxes:** Never modify them. Track completion in Log entries.
3. **`done` ≠ `verified`:** Log work completion and verification as separate entries.
4. **Verification at creation:** Fill the Verification section when creating the ticket, before work starts.
5. **"File contains X" is forbidden** in the Verification section. Describe runnable commands or observable behavior.
6. **INDEX.md** is the only file whose existing content may change.
7. **Plan propagation (plan parents only):** When all tickets of a plan are verified, update the plan status (Update Mode Step 4). Discussion parents are not propagated.
8. **1 Ticket = 1 independent execution cycle:** Run each ticket as its own independent execution. Never batch several tickets into one execution.
9. **Mandatory work log:** After any work related to this ticket or its purpose, append a Log entry (`### [{YYYY-MM-DD HH:MM}] {entry_type}`), even when this skill was not explicitly invoked.
10. **Mandatory append of results:** The parent must append execution, direct verification and final evaluation to their T sections. When workers or reviewers were used, record their evidence and the parent's disposition. Verification not recorded in the document counts as not performed. Before completion, the parent reads the T document and confirms that no result section from Rule 1 still contains `placeholder`; the log guard blocks `verified` otherwise. Optional review notes are not a completion gate.
11. **Verification record:** Record each criterion in `## Verification Results` as the template's Step B says. Use direct evidence; if only indirect evidence exists, say why; otherwise write "unverified". With no project verification tool, invoke the 'verifying' skill. The project's checks run once, at Step B; later steps read that result instead of running them again.
12. **Regressing context transfer:** In regressing, the parent must explicitly copy this ticket's `## Final Verification > Next Direction` into the next cycle plan entry's Context in the D log. A session still using plans copies it into the next P document's Context.
13. **Regressing state update:** When `.crabshell/memory/regressing-state.json` exists and is active, and the ticket's parent is the state's `discussion` or `planId`, update it after creating the ticket: `"{NODE_PATH}" -e "const f='{PROJECT_DIR}/.crabshell/memory/regressing-state.json';const s=JSON.parse(require('fs').readFileSync(f,'utf8'));s.ticketIds.push('{T-ID}');s.lastUpdatedAt=new Date().toISOString();require('fs').writeFileSync(f,JSON.stringify(s,null,2))"`. Tickets of other work are not added to the cycle. The PostToolUse hook handles the phase transition.
14. **No autonomous code writes:** Every Write/Edit to a code file must trace to an explicit Acceptance Criterion of this ticket. When no AC covers a code write, stop: add an AC if it is in scope, or raise an Open Question.
