# Verification runner reuse, timing and output

Read the relevant section when Run Mode in `SKILL.md` points here.

## Reuse and timing

**Reuse.** A selected check reuses PASS when its key matches: normalized entry, runner bytes, Node version, platform, architecture, test bytes and input hashes (folders use sorted names). Fingerprints taken immediately before each check must match after it passes; newly traced inputs must predate its start. Changed or unreadable inputs get no key. `passedAt` expires after seven days; reuse does not renew it.

Never reuse failed or timed-out checks, manual entries, empty input records, `always: true`, `reuse: false`, explicit entry IDs, changed tests requiring fail-before, or full `--changed` fallbacks. `--no-reuse` forces all selected checks to execute. Discovery entries can use `reuseExclude` to disable reuse for individual files; use these controls for external tools or other untracked inputs (see [manifest entry controls](manifest-entries.md)).

`--dry-run` prints JSON without executing: `reasons` for each selection, `wouldReuse` count, and `estimatedSeconds` from durations of checks that would execute (unknowns contribute zero). Results carry `durationMs`; the map keeps `lastDurationMs` from execution. Reuse reports zero without replacing it.

## Output and saved results

Default stdout shows a one-line verdict: executed/reused counts, manual checks waiting for a person, elapsed seconds; zero parts are omitted. Failures show their first failure line and last five stderr lines. Empty selection says `No checks selected — nothing changed that a check reads.` and exits 0. `Verification Results: PASS: N / FAIL: N / Manual: N / Total: N` remains.

The full array is saved atomically to `last-run.json` beside the runner: `Full results: <path>` confirms success; `Full results: not saved (<error>)` reports failure. Read it instead of rerunning. `--json` or `CRABSHELL_VERIFY_JSON=1` also prints the array; `--no-fail-before` does so for older guards. `--changed --json` does **not** count for the commit gate: use the declared `--changed` command and its saved JSON.
