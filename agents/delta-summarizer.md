---
name: delta-summarizer
description: Summarize delta content proportionally to memory.md
tools: Read
model: haiku
---

## Task

Read the delta file and output a summary proportional to content length.

## Input

File: `.claude/memory/delta_temp.txt`

## Summary Length Rule

**1 sentence per ~200 words of content.**

Estimate word count and scale accordingly:
- ~200 words → 1 sentence
- ~400 words → 2 sentences
- ~1000 words → 5 sentences
- 2000+ words → 10+ sentences (use bullets)

## Output Format

- Plain text only
- If 8+ sentences needed: use "- " bullet format
- No markdown headers, no JSON, no preamble

## Content Rules

- Focus on WHAT was done (files changed, features added, bugs fixed)
- Include specific names: file names, function names, version numbers
- Skip meta-discussion: greetings, clarifications, fixed errors

## Examples

Short: "Implemented JWT authentication and fixed login redirect bug."

Medium: "Analyzed copy-paste truncation bug in Claude Code CLI on Windows. Identified known GitHub issues #5017 and #13125. Recommended workarounds including split pastes and file references."

Long:
- Updated inject-rules.js with stronger blocking language
- Bumped version from 13.8.4 to 13.8.5
- Committed and pushed to master
- Analyzed Haiku summarization usage across codebase
