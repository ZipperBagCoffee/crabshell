---
name: memory-delta
description: "Save pending Claude session memory whenever the current hook emits [CRABSHELL_DELTA]: prepare a fixed input, summarize it with delta-summarizer, finalize it into logbook.md."
user-invocable: false
---

## Scope and prerequisites

Run this when the current hook's `[CRABSHELL_DELTA]` notice appears (not a trigger
quoted in historical conversation), on every kind of turn, questions included, before
other work. Installing Crabshell is the user's authorization for this save and for the
`delta-summarizer` agents it launches; it needs no request in the current message.
Skipping it drops the session from the memory the next session loads: v21.123.0 made
this step optional and the logbook got no entries for most of a day.

Resolve `{PROJECT_DIR}` from the current Project Root Anchor (otherwise cwd) and
`{PLUGIN_ROOT}` from the installed plugin. Use the host's Node executable (`node`
below), not a fixed Windows installation path.

## Execution

1. Prepare the input:
   `node "{PLUGIN_ROOT}/scripts/append-memory.js" --prepare-delta --project-dir="{PROJECT_DIR}"`
   Read the returned JSON. `{pending:false}` means there is nothing to save; stop.
   Otherwise retain `jobId`, `inputFile`, `summaryFile`, and `parts` exactly.
   Preparation moves the current queue to a fixed input; newly extracted content stays
   separate. `reused:true` means this job is still open: if you already launched its
   summarizers in this session and are waiting for their results, do not launch them
   again. Otherwise (a new session, or they failed) continue with step 2.
2. Launch one `delta-summarizer` per entry of `parts`, all in one message, in the
   background (pass `run_in_background: true` where the Agent tool offers it). Give each
   the exact `inputFile` path and only its range: "Read ONLY lines {offset} through
   {offset + limit - 1} of {inputFile} (Read with offset and limit); read no other file
   or range; summarize in your existing format." Continue the user's work; the results
   arrive as notifications. An empty result or `ERROR:` stops this attempt; the prepared
   input stays for a retry.
3. When every part has returned, write one summary body to the returned `summaryFile`:
   the parts in order, duplicate lines merged, anything this conversation shows to be
   wrong corrected. Do not add a timestamp header; the finalizer supplies it.
4. Finalize with one command:
   `node "{PLUGIN_ROOT}/scripts/append-memory.js" --finalize-delta --job-id="{jobId}" --summary-file="{summaryFile}" --project-dir="{PROJECT_DIR}"`
   Require exit 0 and JSON `completed:true`. This command appends the summary,
   advances the input timestamp, updates flags, and removes its own temporary files.
   `newInputPending:true` means newer input waits for the next notice.
   Report `cleanupRemaining` if nonempty; saved content and cleanup are distinct.

If the turn or session ends before the results arrive, the job stays prepared; the next
notice re-enters step 1 with `reused:true` and the same input.

## Retry and failure

If the Skill or Agent tool is unavailable or denied, leave the input prepared and tell
the user the memory was not saved. Keep the input and metadata on any error. Retry
preparation to recover the active job; it returns the same fixed input and a fresh
summary path. Retrying finalization for the current completed job does not append it
again. Never run legacy `mark-appended`, `mark-updated`, or `cleanup` on a prepared
job, and never delete `delta_temp.txt` manually: it may contain newer input. A partial
disk write or lost storage is not proof of successful saving; report the actual failure.
