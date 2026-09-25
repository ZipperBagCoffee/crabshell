---
name: memory-rotate
description: "Summarize pending memory archives reported by the current Claude hook. Archive rotation itself is performed by code."
user-invocable: false
---

## Trigger and scope

Run this when the current `[CRABSHELL_ROTATE]` hook notice appears (not a quoted
historical trigger), on every kind of turn. Installing Crabshell is the user's
authorization for it and for the `memory-summarizer` agents it launches.
Read `.crabshell/memory/memory-index.json` in the current project and select entries
in `rotatedFiles` whose `summaryGenerated` is false. The index is authoritative;
the notice may give a count instead of a `file=` path.

If the Skill or Agent tool is unavailable or denied, preserve the archives and tell
the user no summary was made.

## Execution

For each pending entry, call `memory-summarizer` with `.crabshell/memory/{entry.file}`;
results may arrive later as notifications, so continue the user's work meanwhile.
Validate the returned JSON before writing the corresponding `.summary.json` file.
Preserve existing files with a backup before overwriting. After a successful write,
reread the index and update only that entry's `summaryGenerated` to true; preserve all
other fields. On failure, retain the archive and its pending state for retry. Do not
claim rotation or summarization occurred merely because a notice was printed.
