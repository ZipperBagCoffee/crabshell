---
name: hotfix
description: "Record directly-performed one-pass work as a discussion with one ticket — Crabshell no longer creates H documents. Use /hotfix H001 only to append a log entry to an existing H document."
---

# Hotfix Skill (one-pass work → a discussion with one ticket)

## Purpose

Work the parent does in one direct pass — one-line fixes up to small multi-file changes — is recorded as a discussion (D) with one ticket, the same D → T workflow as everything else. Existing H documents under `.crabshell/hotfix/` stay readable and searchable; new H documents are not created.

---

## Mode A: New one-pass work — `/hotfix "description"`

Do not create an H document. After applying the change and verifying it directly:

1. `/discussing "description"` — Intent: what was broken or requested (the problem); Context: where it was found.
2. `/ticketing D{NNN} "description"` — one ticket under that discussion. Write the problem, the fix (what was changed and where — file:line) and the verification (prediction vs observed command output) into the ticket's Execution Results and Verification Results, then set the ticket to `verified` in the ticket INDEX and the discussion to `concluded` (a status-change log entry through `/discussing` plus the discussion INDEX).
3. Report the discussion and ticket IDs. Document-first: the document writes are the primary output.

The parent owns direct verification; no agents or review cycle are needed. If evidence is expected to change the plan across iterations, use regressing instead.

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

- **One workflow** — one-pass work uses D → T like everything else; the lightweight part is one ticket and no review cycle.
- **Existing H documents** keep their four sections (Problem, Fix, Verification, Log) and accept log entries through Mode B.
- **Document-first** — write to the documents before reporting in conversation.
