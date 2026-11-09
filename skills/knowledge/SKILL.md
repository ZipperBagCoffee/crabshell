---
name: knowledge
description: "Create and manage project-specific knowledge pages in .crabshell/knowledge/. Stores verified facts and operational tips discovered through project work. Invoke with /knowledge 'title' to create, or /knowledge K001 to view."
---

# Knowledge Skill

This skill stores and retrieves verified facts and operational tips discovered through project work.

## Rule check

Before creating a K-page, ask whether its "What" says how Claude must behave rather than how something behaves.

If it does, warn:
> "This sounds like a behavioral rule. Rules belong in CLAUDE.md, not knowledge/."

Then ask the user to confirm before going on.
Facts about how tools behave belong in knowledge/, for example "Bash rm triggers permission prompts for .claude/ paths". Rules about how Claude must behave belong in CLAUDE.md.

---

## Mode A: Create Mode — `/knowledge "title"`

### Step 1: Ensure Infrastructure

Create `.crabshell/knowledge/` if it does not exist.
Create `.crabshell/knowledge/INDEX.md` if it does not exist, with this header:

```
# Knowledge Index

| ID | Title | Cat | Tags | Source |
|----|-------|-----|------|--------|
```

### Step 2: Determine Next K{NNN} ID

Scan the `.crabshell/knowledge/K*.md` file names. Next ID = highest number + 1, zero-padded to 3 digits. With no K-pages, start at K001.

### Step 3: Gather Content from User

Ask the user for these fields. Infer them from context instead when the invocation gives enough detail.

1. **category**: `fact` (a verified observation about how something behaves) or `tip` (an operational best practice)
2. **What**: 1-3 specific, concrete sentences stating the fact or tip.
3. **When**: when the knowledge applies, for example "when writing hooks that touch .claude/ paths".
4. **source**: the document or observation it comes from, for example `I047`, `lesson`, `observation`.
5. **tags**: 2-4 lowercase tags, for example `[cli, bash, permissions]`.

### Step 4: Create K-Page

Write `.crabshell/knowledge/{K-ID}-{slug}.md`. The slug is the title in lowercase with hyphens.

```markdown
---
type: knowledge
id: {K-ID}
category: fact | tip
title: "{title}"
source: {source}
created: {YYYY-MM-DD}
tags: [{tag1}, {tag2}]
---

# {K-ID} - {title}

## What
{1-3 sentences: the fact or tip, concrete and specific}

## When
{when this knowledge is relevant to apply or recall}
```

### Step 5: Update INDEX.md

Append a row to `.crabshell/knowledge/INDEX.md`:

```
| {K-ID} | {title} | {cat} | {tags} | {source} |
```

---

## Mode B: View Mode — `/knowledge K001`

Read `.crabshell/knowledge/K{NNN}-*.md` for the given ID and show its full content.
If the ID does not exist, list all K-page IDs from INDEX.md.

---

## Notes

- K-pages are append-only. Never edit an existing K-page; create a new one when the fact has changed.
- `/crabshell:search-docs` searches K-pages.
