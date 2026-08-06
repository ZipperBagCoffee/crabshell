---
name: hotfix
description: Record directly-performed work in an H document. Use for any task done in one pass — from one-line fixes to small multi-file changes — that doesn't need a D/P/T workflow. Invoke with /hotfix "description" to create, or /hotfix H001 to update.
---

# Hotfix Skill

## Purpose

Record work performed directly by the parent — one-line fixes up to small multi-file changes — that doesn't warrant D/P/T regressing treatment. Hotfixes are already applied when recorded — this skill captures what was broken (or requested), what was changed, and how it was verified.

This is the single lightweight work-record channel: the former light-workflow skill was retired in v21.112.0 (D113). Existing W documents under `.crabshell/worklog/` remain as read-only history. For iterative multi-cycle work, use regressing.

---

## Mode A: Create Mode — `/hotfix "description"`

### Step 1: Ensure Infrastructure

Check if `.crabshell/hotfix/` exists. If not, create it.
Check if `.crabshell/hotfix/INDEX.md` exists. If not, create it with header:

```
# Hotfix Index

| ID | Title | Status | Date |
|----|-------|--------|------|
```

### Step 2: Determine Next H{NNN} ID

Glob `.crabshell/hotfix/H*.md` filenames. Find the highest existing number. Next ID = that number + 1, zero-padded to 3 digits. If no H-pages exist, start at H001.

### Step 3: Generate Slug

Convert the description to a lowercase-hyphenated slug (strip special characters, max 40 chars).

### Step 4: Create Hotfix Document

Write `.crabshell/hotfix/H{NNN}-{slug}.md` with this content:

```markdown
---
type: hotfix
id: H{NNN}
title: "{description}"
status: done
created: {YYYY-MM-DD}
tags: []
---

# H{NNN} — {description}

## Problem
{1-2 sentences: what was broken}

## Fix
{what was changed and where — file:line reference}

## Verification
{how it was verified — prediction vs observed command output, at least one line}

## Log
### [{YYYY-MM-DD HH:MM}] Created
{creation context}
```

Fill in Problem, Fix, and Verification from context. If context is insufficient, use placeholder text and inform the user to update.

### Step 5: Update INDEX.md

Append a new row to `.crabshell/hotfix/INDEX.md`:

```
| [[H{NNN}-{slug}|H{NNN}]] | {description} | done | {YYYY-MM-DD} |
```

### Step 6: Report

State the created file path, ID, and title. Document-first: the file write in Steps 4-5 is the primary output.

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

---

## Design Principles

- **Status defaults to `done`** — hotfixes are already applied when recorded.
- **No agents, no review cycle** — just record what happened. The parent still owns direct verification (run the check, record prediction vs observation).
- **Minimal template** — 4 sections only (Problem, Fix, Verification, Log).
- **Document-first** — write to file before reporting in conversation.
- **Scope** — anything done in one direct pass qualifies; if evidence is expected to change the plan across iterations, use regressing instead.
