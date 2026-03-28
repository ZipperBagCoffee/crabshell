---
name: lessons
description: "Creates and manages project-specific lessons stored in .crabshell/lessons/. Use when proposing a new lesson after patterns repeat 2+ times, or when checking lesson format guidelines. Invoke with /lessons."
---

# Lessons Management

## Purpose

Project-specific lessons capture repeated mistakes, user feedback, and important patterns. They prevent the same issues from recurring.

Lessons are stored locally in `.crabshell/lessons/` — they are project-specific and never overwritten by plugin updates.

---

## When to Create a Lesson

1. **Same mistake repeats 2+ times** — pattern detected, needs documentation
2. **User explicitly marks something as important** — "Remember this", "Don't do X again"
3. **Project-specific instruction is repeatedly needed** — e.g., specific pipeline, naming convention, architectural decision

---

## Lesson File Format

**Filename:** `YYYY-MM-DD_short-description.md`

**Required format for every lesson:**

```markdown
# {Title — action verb, not description}

## Problem
{What went wrong — 1-2 sentences max}

## Rule
{DO this / DON'T do that — imperative, context-free}

## Example
Bad: {concrete example of the wrong way}
Good: {concrete example of the right way}
```

**Prohibited content:**
- Reflective narratives ("completion drive caused...", "RLHF bias led to...")
- Context-dependent explanations that require knowing the original failure
- Abstract principles without concrete action ("be more careful about...", "be more mindful of...")
- `## Context` / `## Lesson` sections (replaced by Problem / Rule / Example)

**Quality test:** "Would a Claude in a completely different project understand what to DO from this lesson?"
If NO → rewrite as context-free rule.

---

## From Lesson to CLAUDE.md

1. Write the full lesson in `.crabshell/lessons/`
2. Extract a 1-2 line rule for CLAUDE.md
3. Add to CLAUDE.md under the project-specific section (below the marker line)
4. Reference the lesson file for full context

**Warning:** Too many rules in CLAUDE.md may cause some to be ignored. Keep rules concise and prioritized.

---

## Proposal Protocol

When you detect a potential lesson:

```
"This feedback appears to be a project-specific lesson:
[One-line summary]
Should I create a lesson in .crabshell/lessons/ and add a rule to CLAUDE.md?"
```

**Conditions for proposing:**
- Same issue occurred 2+ times, OR
- User explicitly indicated importance, OR
- Project-specific pattern that differs from general practice

**Never:** Add lessons without user approval.

---

## When User Proposes a Lesson

Before adding, verify:
1. What is the lesson trying to prevent?
2. Is it genuinely project-specific or should it be general?
3. Does it conflict with existing rules?

Add directly without asking for permission. Do NOT ask "should I add this lesson?" — just add it.

---

## Reviewing Lessons

Periodically review lessons for:
- Obsolete rules (no longer applicable)
- Redundant rules (covered by other rules)
- Rules that should be generalized (move to light-workflow or critical rules)
