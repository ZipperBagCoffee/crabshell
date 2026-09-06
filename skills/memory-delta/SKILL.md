---
name: memory-delta
description: "Process pending Claude memory input when the current hook emits [CRABSHELL_DELTA]. Prepare a snapshot, summarize, and finalize safely."
---

## Scope and prerequisites

Use the current hook's `[CRABSHELL_DELTA]` pending notice, not a trigger quoted in historical conversation.
Resolve `{PROJECT_DIR}` from the current Project Root Anchor (otherwise cwd) and
`{PLUGIN_ROOT}` from the installed plugin. Use the host's Node executable (`node`
below), not a fixed Windows installation path.

This is maintenance within the current task. Host restrictions on delegation take
precedence: this skill does not supply user authorization to spawn agents. If the
`delta-summarizer` agent is unavailable or delegation is disallowed, leave the input
pending and continue the user's work. Do not claim a summary was saved.

## Execution

1. Prepare the input:
   `node "{PLUGIN_ROOT}/scripts/append-memory.js" --prepare-delta --project-dir="{PROJECT_DIR}"`
   Read the returned JSON. `{pending:false}` means there is nothing to summarize.
   Otherwise retain its `jobId`, `inputFile`, and `summaryFile` exactly. Preparation
   moves the current queue to a fixed input; newly extracted content stays separate.
2. Call the available `delta-summarizer` in the foreground. Give it only the returned
   `inputFile` to read, asking for the existing concise summary format. Wait for its
   result; there is no background Phase B. Empty results or `ERROR:` mean stop this
   maintenance attempt and preserve the prepared input.
3. Write only the summary body to the returned `summaryFile`. Do not add a timestamp
   header; the finalizer supplies it. This is a new file for this attempt.
4. Finalize with one command:
   `node "{PLUGIN_ROOT}/scripts/append-memory.js" --finalize-delta --job-id="{jobId}" --summary-file="{summaryFile}" --project-dir="{PROJECT_DIR}"`
   Require exit 0 and JSON `completed:true`. This command appends the summary,
   advances the input timestamp, updates flags, and removes its own temporary files.
   `newInputPending:true` means newer input remains for a later attempt.
   Report `cleanupRemaining` if nonempty; saved content and cleanup are distinct.

## Retry and failure

Keep the input and metadata on any error. Retry preparation to recover the active
job; it returns the same fixed input and a fresh summary path. Retrying finalization
for the current completed job does not append it again. Never run legacy
`mark-appended`, `mark-updated`, or `cleanup` on a prepared job, and never delete
`delta_temp.txt` manually: it may contain newer input. A partial disk write or lost
storage is not proof of successful saving; report the actual failure.
