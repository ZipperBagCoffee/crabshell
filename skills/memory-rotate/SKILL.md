---
name: memory-rotate
description: "Summarize pending memory archives reported by the current Claude hook. Archive rotation itself is performed by code."
user-invocable: false
---

## Trigger and scope

Run this when the current hook prints `[CRABSHELL_ROTATE]`, on every kind of turn. A copy quoted from earlier conversation is not a trigger.
The notice comes once per turn and says when. On a work request, or when the previous turn skipped it, run this before other work. Otherwise answer the user first, then run this in the same response.
Installing Crabshell is the user's authorization for this and its `memory-summarizer` workers.
Skill or Agent tool unavailable or denied: keep the archives and tell the user no summary was made.

## Steps

1. Read `.crabshell/memory/memory-index.json` in the current project. Pick the `rotatedFiles` entries whose `summaryGenerated` is false. The index decides; the notice may give a count instead of a `file=` path.
2. For each pending entry, call `memory-summarizer` with `.crabshell/memory/{entry.file}`. Continue the user's work; results may arrive later as notifications.
3. Validate the returned JSON before writing its `.summary.json` file. Back up an existing file before overwriting it.
4. After a successful write, reread the index and set only that entry's `summaryGenerated` to true. Keep all other fields.
5. On failure, keep the archive and its pending state for a retry.

Do not claim rotation or summarization happened only because a notice was printed.
