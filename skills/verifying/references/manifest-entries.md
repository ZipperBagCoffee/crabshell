# Verifying — Step 5: writing manifest entries

Moved out of SKILL.md so the skill body stays within what Claude Code re-attaches after compaction (the first 5,000 tokens of each skill). Read this file when the body points here.

### Step 5: Populate entries from current context

For each user-observable outcome in the current session, create a verification entry. Commands are object-form, repo-relative, and shell-free.

**Before writing any entry, answer two questions. They decide the whole entry.**

**Q1 — What kind of claim is this?** Match the method to the claim.

| The claim is | Use | Why |
|---|---|---|
| "Running this produces that output / state change" | `behavioral` — execute the real surface, observe what comes back | A static read is not evidence that code runs. Software that has only been statically analysed has no proof of functional correctness |
| "This artifact has this structure, wiring, or policy" | `structural` — read and parse the artifact | There is nothing to execute; and running one script does not prove the host wired it to the right event |
| "A human must look at it" | `manual` | Browser, GUI, visual judgment |

A `structural` entry that stands in for a behavioral claim is the most common defect. `grep 'process.exit(0)' script.js` does not verify fail-open — injecting a malformed input and observing the exit code does.

**Q2 — Will this expected value change on the next release?** If yes, do not write the value down.

| Instead of | Assert |
|---|---|
| the current version string | every file that carries a version agrees with the single authoritative source (`jsonMatches`) |
| the current count of passing tests | discovered count > 0 **and** failure count == 0 |
| the full text a command prints | the shape it must always have: required fields, types, non-empty, expected sections present |
| one input/output pair | a relation across two runs: same input twice → same output; unrelated input field changed → that part of the output unchanged; a broken input still exits fail-open |

Writing an expected value that the next release will change turns the verifier into a change detector: it fails whenever the code changes rather than whenever the behavior is wrong, so it reports churn instead of regressions.

**Exact literal values are correct in one case only — when the spelling itself is the contract.** Protocol event names, JSON property names, CLI flag spellings, command keywords: these are promises to a consumer, so assert them exactly. Prose that merely describes something is not a contract; do not lock it.

Entry shape:
```json
{
  "id": "V001",
  "ia": "IA-1: {what user-observable outcome this proves}",
  "type": "behavioral",
  "command": {
    "file": "node",
    "args": ["scripts/behavior-test.js"]
  },
  "contract": {
    "exitCode": 0,
    "assertions": [
      { "kind": "stdoutJsonEquals", "pointer": "/passed", "equals": true },
      { "kind": "jsonMatches",
        "actual":   { "path": "consumer.json", "pointer": "/version" },
        "expected": { "path": "source-of-truth.json", "pointer": "/version" } }
    ],
    "forbiddenChanges": ["user-owned.txt"]
  },
  "timeout": 30000
}
```

The first assertion is an invariant — the probe script decides pass/fail and reports it as a boolean, so the manifest holds no expected value at all. The second compares two files against each other, so it keeps working whatever the version becomes. Put the detailed checks inside the probe script, and keep the manifest holding only invariants.

Supported assertions are `jsonEquals`, `jsonMatches`, `stdoutJsonEquals`, `stdoutMatches`, `fileExists`, and `fileContains`. Prefer JSON/state comparisons over stdout. Positive text such as `PASS` and the legacy `expected` field never decide success. Every behavioral entry must contain at least one assertion or `forbiddenChanges` path.

Use `{"kind": "stdoutMatches", "pattern": "named observation", "flags": "i"}` to require an observation in stdout. `pattern` is a regex source string; `flags` is optional. The runner tests `new RegExp(pattern, flags)` against stdout only, alongside the exit-code and other assertions. A mismatch reports `stdout: expected /<pattern>/`. Invalid patterns or flags are manifest errors, validated across expanded entries before any command runs.

**Write the `ia` field as the outcome being proven, not as a release note.** Version numbers, ticket IDs, and "after feature X" phrasing go stale and force an edit that proves nothing.

**Collect verification targets by convention, not by list.** When several scripts of the same kind must all run, have the probe discover them from the filesystem — a test file that exists but appears in no list is silently never executed. Assert that the discovered count is above zero so an empty glob fails loudly, and never hardcode how many were found.

The runner does this for test files with a discovery entry. It runs one check per file matching `pattern` (a literal folder and a file-name glob), shares the entry's `contract`, and fails with `matched no files` when nothing matches. A file that an explicit entry already runs is not discovered again. Every `exclude` item needs a `reason`. `command` is optional, and `{file}` is replaced with each file; the default is `node <file>`.

For file-specific checks, add `"fileAssertions": { "scripts/_test-example.js": [{ "kind": "stdoutMatches", "pattern": "named observation" }] }` to the discovery entry. Each array is appended to that file's `contract.assertions`; other files retain the shared contract. Keys are exact repo-relative discovered paths, accepting either slash style. Slash aliases of the same file append both arrays. A key absent after discovery exclusions and explicit-entry precedence is a manifest error naming the entry and file. The coverage restrictions below apply to the appended assertions too.

Selected checks may reuse an unchanged PASS; selection alone does not mean the command ran. Set `"reuse": false` on an entry whose external tools, live services or other inputs cannot be tracked. On a discovery entry this disables reuse for every discovered check. To disable cached reuse for particular files, set `"reuseExclude": ["scripts/_test-live.js"]` on the discovery entry instead: paths are exact and repo-relative, with either slash style accepted. Unlike `discover.exclude`, these files remain eligible for selection; the setting does not itself select them. `always: true` both selects the entry and prevents reuse. Run mode in `SKILL.md` describes key validity, expiry and the other never-reuse cases.

`"always": true` runs a check on every run and never reuses its pass. With `jobs` above 1, `"exclusive": true` runs a check alone and checks sharing a `"group": "<name>"` run one at a time.

Top-level run settings (all optional): `jobs` — how many checks run side by side (default half of what the machine can run in parallel, capped at all of it); with no `jobs`, a check runs alone unless its last run traced it as a check run by the runner's own Node, so a check in another language stays one at a time until it gets `"exclusive": false` or a `group`; `minFreeMemoryMB` — no further check starts while less memory than this is free (default 2048; one check always runs); `memoryShare` — also no further start while the share of memory in use is above it (no default); `startSpacingMs` — side by side, the next check starts after a check finishes or this pause has passed (default 250), so the memory a started check takes is seen first; `copyLiteralMinChars` — a changed test that ran is named in the notices when it holds quoted prose (four or more plain words, at least half its tokens — not a command, code or a path) of at least this many characters that is word for word in its own inputs (default 40; a rewording there would break the test); `retries` — a check that fails on inputs it once passed with runs again up to this many times (default 1); a pass on retry counts as PASS, is named flaky and is left out of later routine `--changed` runs until its test file changes (see [flaky and forbidden-file failures](runner-reuse-output.md#reuse-and-timing)), and a declared-input check that fails this way uses the whole project until its `inputs` change; `riskPaths` — files, folders or globs whose change brings the heavy checks (`slow`, or a median pass time over `slowAfterSeconds`) whose own inputs changed into a routine `--changed` run, the changed file named in the summary (no default: heavy checks wait for `--slow`); `passHistory` — how many pass fingerprints and pass times each record keeps (default 10).

When another check also executes this test, an explicit entry can declare `"coveredBy": "V200"`. A discovery entry instead maps exact repo-relative file paths to covering check IDs: `"coveredBy": { "scripts/_test-live.js": "V200" }`; either slash style is accepted. The target must be an existing expanded check ID (for a discovered target, `V100:scripts/_test-example.js`), not just a discovery group ID. Unknown targets and cycles are errors. Only declare coverage after inspecting the covering command and confirming it actually runs the child's test.

A covered entry or discovered file must have no `contract.assertions`. Its `contract.forbiddenChanges` must be a subset of the covering check's list (each exact path must be present); otherwise the manifest error names both IDs. This prevents coverage from discarding the child's own contract.

With a nonempty file record, a child can be covered by a selected target's executed or reused PASS, without adding a pass fingerprint of its own. A child with no record, missing `files` or empty `files` executes to record its inputs first. Failure or timeout makes the child run for its own evidence. Explicit IDs, `--no-reuse` and changed tests with fail-before enabled disable coverage; absent targets never cover. For `reuse: false`, `reuseExclude` and `always: true`, the covering check must actually execute and pass in this run; its reused PASS cannot cover the child. Coverage preserves result order. Timing, chain handling and output details: [runner reuse and output](runner-reuse-output.md).

A manifest edit reruns a check only when it changes that check's fingerprint (its run fields or, through `changed.global` and `exclude`, its inputs), including edits already committed without a run: [manifest changes](runner-reuse-output.md#manifest-changes-and-records).

```json
{
  "id": "V100",
  "ia": "every test file passes",
  "type": "behavioral",
  "discover": { "pattern": "scripts/_test-*.js", "exclude": [{ "file": "scripts/_test-slow.js", "reason": "needs a live service" }] },
  "contract": { "exitCode": 0, "assertions": [], "forbiddenChanges": ["data/user-owned.json"] },
  "timeout": 180000
}
```
