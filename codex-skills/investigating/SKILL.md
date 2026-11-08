---
name: investigating
description: Create and run a Crabshell I investigation document from Codex. Use for evidence-heavy research that needs multiple source types, cross-review, and documented conclusions; not for quick questions.
---

# Investigating

## Create The I Document First

`{SKILL_DIR}` is the folder holding this `SKILL.md`; `{PROJECT_ROOT}` is the absolute active project root.
Run the bundled script by its absolute path, with that project as the explicit target:

```bash
node "{SKILL_DIR}/scripts/codex-docs.js" investigation "topic" --topic="what is being investigated and why" --questions="Q1; Q2; Q3" --sources="Internet: TBD; Local: TBD; User-specified: TBD" --constraints="[Project] ...; [Inferred] ..." --project-dir="{PROJECT_ROOT}"
```

The script creates `.crabshell/investigation/INNN-*.md` and appends to `.crabshell/investigation/INDEX.md`.

## Investigation Workflow

1. Read the new I document before researching.
2. Use at least two source types, unless the user explicitly restricts scope:
   - Internet or external documentation, when current or public facts matter.
   - Local files, code, tests, configs or logs, when project behavior matters.
   - User-provided URLs or files, when supplied.
3. Fill `## Investigation Log` with separate workstreams. Each workstream needs evidence: commands, file paths, URLs, dates or direct observations.
4. Fill `## Cross-Review` before synthesis. Challenge the workstreams for contradictions, missing sources, stale facts and weak evidence.
5. Fill `## Synthesis` and `## Conclusions` in the document before summarizing in chat.
6. In `## Conclusions`, answer each question on its own, give a confidence level, and list the remaining gaps.

The document is the primary output. The chat reply is a short summary that points to the I document.
