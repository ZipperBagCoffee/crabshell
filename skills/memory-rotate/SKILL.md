---
name: memory-rotate
description: "Summarize pending memory archives reported by the current Claude hook. Archive rotation itself is performed by code."
---

## Trigger and scope

Use a current `[CRABSHELL_ROTATE]` hook notice, not a quoted historical trigger.
Read `.crabshell/memory/memory-index.json` in the current project and select entries
in `rotatedFiles` whose `summaryGenerated` is false. The index is authoritative;
the notice may give a count instead of a `file=` path.

If `memory-summarizer` is unavailable or host delegation rules disallow it, preserve
the archives and continue the user's task. This skill does not grant permission to
spawn agents and does not make archive summaries a prerequisite for responding.

## Execution

For each pending entry, call the available `memory-summarizer` in the foreground
with `.crabshell/memory/{entry.file}`. Validate the returned JSON before writing the
corresponding `.summary.json` file. Preserve existing files with a backup before
overwriting. After a successful write, reread the index and update only that
entry's `summaryGenerated` to true; preserve all other fields. On failure, retain
the archive and its pending state for retry. Do not claim rotation or summarization
occurred merely because a notice was printed.
