---
name: investigating
description: Create and run a Crabshell I investigation document from Codex. Use for evidence-heavy research that needs multiple source types, cross-review, and documented conclusions; not for quick questions.
---

# Investigating

Use this when a question needs a durable investigation record, not just a chat answer.

## Create The I Document First

Run:

```bash
node scripts/codex-docs.js investigation "topic" --topic="what is being investigated and why" --questions="Q1; Q2; Q3" --sources="Internet: TBD; Local: TBD; User-specified: TBD" --constraints="[Project] ...; [Inferred] ..."
```

The script creates `.crabshell/investigation/INNN-*.md` and appends to `.crabshell/investigation/INDEX.md`.

## Investigation Workflow

1. Read the new I document before researching.
2. Use at least two source types unless the user explicitly restricts scope:
   - Internet or external documentation when current/public facts matter.
   - Local files, code, tests, configs, or logs when project behavior matters.
   - User-provided URLs/files when supplied.
3. Fill `## Investigation Log` with separate workstreams. Each workstream needs evidence: commands, file paths, URLs, dates, or direct observations.
4. Fill `## Cross-Review` before synthesis. Challenge the workstreams for contradictions, missing sources, stale facts, and weak evidence.
5. Fill `## Synthesis` and `## Conclusions` in the document before summarizing in chat.
6. In `## Conclusions`, answer each question individually, include confidence level, and list remaining gaps.

The document update is the primary output. The chat response should be a short summary pointing to the I document.
