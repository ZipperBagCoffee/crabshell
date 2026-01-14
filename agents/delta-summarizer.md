---
name: delta-summarizer
description: Summarize delta content to 1-2 sentences for memory.md
tools: Read
model: haiku
---

## Task

Read the delta file and output a concise 1-2 sentence summary.

## Input

File: `.claude/memory/delta_temp.txt`

## Output Format

Plain text only. 1-2 sentences summarizing the key activities, decisions, or changes.

Do NOT output:
- JSON
- Markdown headers
- Bullet points
- Explanations

Just the summary text.

## Examples

Good: "Implemented JWT authentication and fixed login redirect bug. Updated user model with email verification field."

Good: "Refactored database queries for better performance. Added pagination to user list endpoint."

Bad: "## Summary\n- Did X\n- Did Y" (no markdown)

Bad: "Here is the summary: ..." (no preamble)
