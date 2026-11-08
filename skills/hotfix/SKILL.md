---
name: hotfix
description: "One-pass work goes through a discussion whose Plan the user confirms, then one ticket, then the change — Crabshell no longer creates H documents. Use /hotfix H001 only to append a log entry to an existing H document."
---

# Hotfix Skill (one-pass work → a discussion with one ticket)

## Purpose

Work the parent does in one pass, from a one-line fix to a small multi-file change, goes through a discussion (D) with one ticket: plan first, then build. Existing H documents under `.crabshell/hotfix/` stay readable and searchable. Do not create new H documents.

---

## Mode A: New one-pass work — `/hotfix "description"`

Create no H document, and change no files before step 2.

1. `/discussing "description"`. Intent: the problem, what was broken or requested. Context: where it was found. `## Plan`: the fix (file → what changes), any rejected alternative, the risk and how it will be checked. Show the plan to the user and record their confirmation. For a one-line fix, one sentence is enough.
2. `/ticketing D{NNN} "description"`: one ticket under that discussion, with the fix in `## Implementation Details`.
3. Apply the change and verify it directly: prediction against observed command output. Fill Execution Results, Verification Results, Intent Fidelity and Final Verification; Intent Fidelity compares the fix with the problem and the plan. Set the ticket to `verified` in the ticket INDEX. Set the discussion to `concluded` with a status-change log entry through `/discussing` and in the discussion INDEX.
4. Write the documents first, then report the discussion and ticket IDs.

The parent owns direct verification; no workers or review cycle are needed. When evidence is expected to change the plan across iterations, use regressing instead.

---

## Mode B: Update Mode — `/hotfix H001`

### Step 1: Find Document

Glob `.crabshell/hotfix/H{NNN}-*.md` matching the given ID. If not found, list available IDs from INDEX.md.

### Step 2: Read Document

Read the full content and display it.

### Step 3: Append Log Entry

Append a new log entry under the `## Log` section:

```markdown
### [{YYYY-MM-DD HH:MM}] Updated
{update context from user}
```


## Design Principles

- **Existing H documents** keep their four sections (Problem, Fix, Verification, Log) and accept log entries through Mode B.
