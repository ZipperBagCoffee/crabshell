# Verification runner reuse, timing and output

## Reuse and timing

**Reuse.** A selected check reuses its PASS when its fingerprint is among those it passed with: the last `passHistory` passes, default 10. The fingerprint covers:
- the record schema;
- the entry's `type`, `command`, `contract` and `timeout`;
- the program it runs: a project file by content, a PATH program by size and time;
- the runner code that runs and judges it (`contract.js`, `execute.js` and the tracer source), but not how inputs are recorded;
- the platform and architecture;
- the content of every input, with folders by their sorted names.

A pass is not recorded when one of its inputs was written while checks ran.

Never reuse failed or timed-out checks, manual entries, empty input records, `always: true`, `reuse: false`, explicit entry IDs, or changed tests that need fail-before (with `--fail-before`). A run that selects every check also reuses unchanged passes, because the fingerprint covers the entry, the runner and every input. `--no-reuse` forces every selected check to execute. A discovery entry can set `reuseExclude` to disable reuse for single files. Use these controls for external tools or other untracked inputs; see [manifest entry controls](manifest-entries.md).

**Failed runs.** When another check fails, passing checks still refresh their traced files, pass fingerprints and input hashes. Reused passes keep their execution evidence. A failed check keeps its prior dependency record, or its traced files when no prior files exist. It keeps its `passHistory` and gets an ISO `lastFailedAt` and a `failKey`, the fingerprint it failed on. `lastFailedKind` is `check` for a failed check, or `fail-before` when the check passes but its HEAD comparison fails; a check failure takes precedence. The next `--changed` selects it with reason `failed in the last run`, even with no file changes. Reuse and coverage cannot clear a failure. After saving the map, stderr names checks with unresolved failure marks.

An executed PASS clears a `check` mark. It clears a `fail-before` mark only when fail-before is enabled, the run is `--changed` with a known changed-file list, and either the entry is no longer a `failBeforeTargets()` target or its comparison passes. A hash-matched exemption counts as passing. The following keep the prior `lastFailedAt`, `lastFailedKind` and dependency `files`, and record no new pass: explicit-ID runs, full runs, `--no-fail-before` runs, unknown Git changes, and unresolved or manual comparisons. The latest execution duration can still be recorded.

**Flaky and forbidden-file failures.** A check that fails and then passes on a retry with the same inputs is PASS, named flaky, and marked in its record (`quarantine`: its test file and that file's content hash). A routine `--changed` run leaves a marked check out and names it in one line until its test file's content changes. A run by id, `--slow` and a full run still run it. A check with a standing failure (`lastFailedAt`) is never left out.

A failure whose exit code and assertions passed, and whose only reason is a `contract.forbiddenChanges` path, runs once more instead of a retry. If that run passes without writing those paths, the result is PASS and a notice names the files: another process wrote them. Writes are judged by size and times, so a check that writes the same bytes each time is still caught. Otherwise the first FAIL stands. Neither outcome counts as flaky.

**Coverage.** `coveredBy` names a check that also runs this test. When both are selected and the child has a nonempty file record, the covering check runs first. Its executed or reused PASS records the child as `status: "PASS"`, `coveredBy: "<id>"`, `durationMs: 0`, without `reused` or a pass fingerprint of its own. For a child with `reuse: false`, `reuseExclude` or `always: true`, only a covering check that actually executed and passed in this run covers it; a reused PASS makes the child execute. A failed or timed-out covering check makes the child execute, even with an older cached PASS. A missing record, missing `files` or empty `files` makes the child execute to record its own inputs first. Results keep manifest order. Established dependency records and execution durations are kept.

Coverage is off when the covering check is absent, an ID is named explicitly, `--no-reuse` is given, or the child test changed and fail-before is enabled. A covered result cannot cover another check; in a chain, that child executes. Declaration rules, unknown IDs and cycles: [manifest entry controls](manifest-entries.md).

`--dry-run` prints JSON and executes no check: `reasons` for each selection, `wouldReuse` and `wouldCover` counts, and `estimatedSeconds`, the sum of known execution durations. `estimatedWallSeconds` is how long the run itself would take: the checks that may share run side by side, up to the number the run starts at once on this machine, and the others one after another; `--explain` prints both. Unknown durations count as zero. With `--changed` and fail-before enabled, `failBeforeTargets` counts the selected changed tests whose recorded inputs cover changed non-test files, minus matching SHA-256 exemptions. Each target adds `lastDurationMs` twice for a test present in HEAD (baseline and attempt) and once for a new test. A Git lookup error assumes twice. `--no-fail-before` and full mode add no comparison time and report zero targets. Coverage estimates assume the covering check passes and leave out the covered child's duration; selection reasons stay unchanged.

`--replay N` estimates, from the records alone, what a routine `--changed` run would have cost on each of the last N commits. It matches the files each commit changed (git) against each check's recorded or declared inputs and leaves out heavy checks. It times the chosen checks side by side within `jobs` by their median pass times, and adds checks that run alone one after another. A change to the runner's decision modules counts as every check. It prints one line per commit and a median/longest line; `--json` prints the rows. Nothing runs and no record is written. Records made before a structural change hold the old inputs until the checks run again.

Results carry the actual `durationMs`, including time spent timing out. An `ETIMEDOUT` result also carries `timedOut: true`. The map then keeps the previous `lastDurationMs`, or leaves it absent if none was recorded. Reuse and coverage report zero without replacing it. Failed, timed-out and covered checks never add a pass fingerprint.

## Manifest changes and records

A change to an entry field that decides the run (`type`, `command`, `contract`, `timeout`), or to the program it runs, changes that check's fingerprint, so only that check runs again. Names, notes and selection hints do not. Top-level fields reach checks only through their inputs: `changed.global` adds files to every check, and `exclude` removes paths from the snapshot.

Each record (`test-map.json`, schema 4) keeps the check's input kind, its input hashes, `passHistory`, pass durations, runs and last failure. The median pass duration ranks checks and marks heavy ones. Input kinds:
- `reported`: what a passing run reported it used inside its `reportScope`, plus what it read or declared outside it; see [select-by-use](select-by-use.md).
- `traced`: the files it read, from the trace.
- `declared`: `inputs`, for a program the runner cannot trace. A traced check that starts such a program keeps its traced reads beside its `inputs`.
- `project`: inputs unknown, so the whole project counts, for that check only.

A record of another schema counts as missing, so every check runs once after a schema change. The schema is raised by hand when the runner starts recording more of what a check reads. New checks always run; removed entries need no run.

## Output and saved results

Default stdout shows a one-line verdict: executed and reused counts, `N covered by <id>` (or `N covered by other checks` for several covering IDs), manual checks waiting for a person, and elapsed seconds. Zero parts are omitted. Covered checks count as PASS, not as executed. Failures show their first failure line and last five stderr lines. Every chosen check runs even after a failure (v21.173.0): each failure is printed on stderr as `[VERIFY] FAIL <id> at <s>s — the run goes on.`, and a failing run ends with `[VERIFY] <n> failed: <ids> — after the fix, rerun only these: node <launcher> --failed; once they pass, run --changed once.` `--failed` runs only the checks whose last run failed (no reuse); with none it prints `No check failed in its last run.` An empty selection prints `No checks selected — nothing changed that a check reads (0.6s).` with the run's own time, the floor every change pays, and exits 0. When every check chosen for the changes is left out because it is heavy or flaky, the verdict says so and the lines below name them. `Verification Results: PASS: N / FAIL: N / Manual: N / Total: N` remains.

For a person's nonempty run (full, `--changed`, `--json` or explicit ID), the runner saves the full array atomically to `last-run.json` beside the runner. Each check that ran also has `startMs` and `endMs`, the milliseconds from the run's start over all its attempts, and `waitedFor`, the checks of this run it waited for: the check covering it, gates and the checks writing what it reads. `Full results: <path>` confirms the save; `Full results: not saved (<error>)` reports a failure. Internal calls with `CRABSHELL_VERIFY_JSON=1` or `--no-fail-before`, and runs with no results, leave the previous file byte-identical and print no `Full results:` line. Read the saved file instead of rerunning. `--json`, `CRABSHELL_VERIFY_JSON=1` or `--no-fail-before` also prints the current array. `--changed --json` does **not** count for the commit gate: use the declared `--changed` command and its saved JSON.
