---
name: knowledge
description: "Create and manage project-specific knowledge pages in .crabshell/knowledge/. Stores verified facts and operational tips discovered through project work. Invoke with /knowledge 'title' to create, or /knowledge K001 to view."
---

# Knowledge Skill

## Purpose

Store and retrieve verified facts and operational tips discovered through project work. Knowledge pages (K-pages) capture "what we learned" in a retrievable format distinct from CLAUDE.md rules (which are behavioral countermeasures) and D/P/T/I documents (which track work in progress).

## Anti-Rule-Duplication Guard

Before creating a K-page, check if the "What" content overlaps with CLAUDE.md RULES keywords: scope, verification, understanding, concise, sycophancy, pressure, guard, hook, bailout, prohibited.

If overlap found, warn:
> "This sounds like a behavioral rule. Rules belong in CLAUDE.md, not knowledge/."

Ask user to confirm before proceeding. Facts about *how tools behave* (e.g., "Bash rm triggers permission prompts for .claude/ paths") belong in knowledge/. Rules about *how Claude must behave* belong in CLAUDE.md.

---

## Mode A: Create Mode — `/knowledge "title"`

### Step 1: Ensure Infrastructure

Check if `.crabshell/knowledge/` exists. If not, create it.
Check if `.crabshell/knowledge/INDEX.md` exists. If not, create it with header:

```
# Knowledge Index

| ID | Title | Cat | Tags | Source |
|----|-------|-----|------|--------|
```

### Step 2: Determine Next K{NNN} ID

Scan `.crabshell/knowledge/K*.md` filenames. Find the highest existing number. Next ID = that number + 1, zero-padded to 3 digits. If no K-pages exist, start at K001.

### Step 3: Gather Content from User

Ask the user for the following (or infer from context if the invocation includes enough detail):

1. **category**: `fact` (a verified observation about how something behaves) or `tip` (an operational best practice)
2. **What**: 1-3 sentences describing the fact or tip. Be specific and concrete.
3. **When**: When is this knowledge relevant? (e.g., "when writing hooks that touch .claude/ paths", "when choosing keywords for CLI user input")
4. **source**: Which document or observation is this from? (e.g., `I047`, `lesson`, `observation`)
5. **tags**: 2-4 lowercase tags (e.g., `[cli, bash, permissions]`)

### Step 4: Create K-Page

Write `.crabshell/knowledge/{K-ID}-{slug}.md` where slug is lowercase-hyphenated title:

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

Append a new row to `.crabshell/knowledge/INDEX.md`:

```
| {K-ID} | {title} | {cat} | {tags} | {source} |
```

---

## Mode B: View Mode — `/knowledge K001`

### Step 1: Read K-Page

Read `.crabshell/knowledge/K{NNN}-*.md` matching the given ID. Display full content.

If the ID does not exist, list all available K-page IDs from INDEX.md.

---

## Notes

- K-pages are append-only records. Do not edit existing K-pages; create a new one if the fact has changed.
- K-pages are stored under `.crabshell/` (gitignored, local only).
- search-docs.js indexes `.crabshell/knowledge/` — K-pages are searchable via `/crabshell:search-docs`.
