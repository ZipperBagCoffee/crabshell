# Lessons

## Purpose

This directory stores project-specific lessons learned from repeated mistakes, user feedback, and important patterns discovered during development.

Lessons are distilled into CLAUDE.md project-specific rules to prevent the same issues from recurring.

---

## When to Create a Lesson

A lesson should be created when:

1. **Same mistake repeats 2+ times** — Pattern detected, needs documentation
2. **User explicitly marks something as important** — "Remember this", "Don't do X again"
3. **Project-specific instruction is repeatedly needed** — e.g., specific pipeline, naming convention, architectural decision

---

## Lesson Format

Each lesson file: `YYYY-MM-DD_short-description.md`

```markdown
# [Short Title]

## Context
[What happened, what was the task]

## Problem
[What went wrong or what was repeatedly needed]

## Lesson
[One or two sentences — the takeaway]

## CLAUDE.md Rule (if applicable)
[Condensed version for CLAUDE.md project-specific section]
```

---

## From Lesson to CLAUDE.md

1. Write the full lesson in this directory
2. Extract a 1-2 line rule for CLAUDE.md
3. Add to CLAUDE.md under project-specific section
4. Reference the lesson file for full context

**Warning:** Too many rules in CLAUDE.md may cause some to be ignored. Keep rules concise and prioritized.

---

## LLM Proposal Protocol

When Claude detects a potential lesson:

```
"This feedback appears to be a project-specific lesson:
[One-line summary]
Should I create a lesson in .claude/lessons/ and add a rule to CLAUDE.md?"
```

**Conditions for proposing:**
- Same issue occurred 2+ times, OR
- User explicitly indicated importance, OR
- Project-specific pattern that differs from general practice

**Never:** Add lessons without user approval.

---

## Reviewing Lessons

Periodically review lessons for:
- Obsolete rules (no longer applicable)
- Redundant rules (covered by other rules)
- Rules that should be generalized (move to workflow or critical rules)
