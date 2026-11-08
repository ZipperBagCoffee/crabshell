---
name: memory-delta
description: "Save pending Claude session memory whenever the current hook emits [CRABSHELL_DELTA]: prepare a fixed input, summarize it with delta-summarizer, finalize it into logbook.md."
user-invocable: false
---

## Scope and prerequisites

Run this when the current hook prints `[CRABSHELL_DELTA]`, on every kind of turn. A copy quoted from earlier conversation is not a trigger.
The notice comes once per turn and says when. On a work request, or when the previous turn skipped the save, run this before other work. Otherwise answer the user first, then run this in the same response.
Installing Crabshell is the user's authorization for this save and its `delta-summarizer` workers; the current message need not ask for it.
Skipping the save drops this session from the memory the next session loads.

`{PROJECT_DIR}`: the current Project Root Anchor path, else the current working directory. `{PLUGIN_ROOT}`: this skill's base directory minus `/skills/memory-delta`. Use the host's `node`, not a fixed Windows path.

## Steps

1. Prepare the input:
   `node "{PLUGIN_ROOT}/scripts/append-memory.js" --prepare-delta --project-dir="{PROJECT_DIR}"`
   Read the returned JSON. `{pending:false}` means nothing to save; stop. Otherwise keep `jobId`, `inputFile`, `summaryFile` and `parts` exactly.
   `reused:true` means an earlier attempt left this job open, possibly in a turn or session that ended before results arrived. If this session launched its workers and still waits on them, do not relaunch. Otherwise go on; this covers a new session and failed workers.
2. Launch one `delta-summarizer` per entry of `parts`, all in one message, in the background. Pass `run_in_background: true` when the Agent tool offers it.
   Give each worker the exact `inputFile` path and only its range: "Read ONLY lines {offset} through
   {offset + limit - 1} of {inputFile} (Read with offset and limit); read no other file
   or range; summarize in your existing format."
   Continue the user's work; results arrive as notifications. An empty result or `ERROR:` ends this attempt; the input stays prepared for a retry.
3. When every part has returned, write one summary body to the returned `summaryFile`: parts in order, duplicate lines merged, anything this conversation shows wrong corrected. Add no timestamp header; finalize adds it.
4. Finalize with one command:
   `node "{PLUGIN_ROOT}/scripts/append-memory.js" --finalize-delta --job-id="{jobId}" --summary-file="{summaryFile}" --project-dir="{PROJECT_DIR}"`
   Require exit 0 and JSON `completed:true`. It appends the summary, advances the input timestamp, updates flags and removes its own temporary files.
   `newInputPending:true`: newer input waits for the next notice. Report `cleanupRemaining` if nonempty; saved content and cleanup are separate results.

## Failure

- Skill or Agent tool unavailable or denied: leave the input prepared and tell the user memory was not saved.
- On any error, keep the input and its metadata. Rerun step 1 to recover the open job; it returns the same input and a new summary path.
- Rerunning finalize for the current completed job does not append it again.
- Never run legacy `mark-appended`, `mark-updated` or `cleanup` on a prepared job. Never delete `delta_temp.txt` by hand.
- A partial disk write or lost storage is not proof of a successful save; report the actual failure.
