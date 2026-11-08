# Verifying — Step 5: writing manifest entries

### Step 5: Populate entries from current context

Create one entry per user-observable outcome in the current session. Commands are object-form, repo-relative and shell-free.

**Answer two questions before writing any entry. They decide the whole entry.**

**Q1 — What kind of claim is this?** Match the method to the claim.

| The claim is | Use |
|---|---|
| "Running this produces that output / state change" | `behavioral`: execute the real surface and observe what comes back. A static read does not show that code runs |
| "This artifact has this structure, wiring, or policy" | `structural`: read and parse the artifact. Running one script does not show that the host wired it to the right event |
| "A person must look at it" | `manual`: browser, GUI, visual judgment |

A `structural` entry that stands in for a behavioral claim is the most common defect. `grep 'process.exit(0)' script.js` does not verify fail-open. Injecting a malformed input and observing the exit code does.

**Q2 — Will this expected value change on the next release?** If yes, do not write the value down. A written-down value makes the check fail on every code change instead of on wrong behavior.

| Instead of | Assert |
|---|---|
| the current version string | every file that carries a version agrees with the single authoritative source (`jsonMatches`) |
| the current count of passing tests | discovered count > 0 **and** failure count == 0 |
| the full text a command prints | the shape it must always have: required fields, types, non-empty, expected sections present |
| one input/output pair | a relation across two runs: same input twice → same output; unrelated input field changed → that part of the output unchanged; a broken input still exits fail-open |

**Use exact literals only when the spelling itself is the contract:** protocol event names, JSON property names, CLI flag spellings, command keywords. These are promises to a consumer, so assert them exactly. Do not lock prose that only describes something.

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

In the first assertion, the probe script decides pass/fail and reports a boolean, so the manifest holds no expected value. The second compares two files, so it holds for any version. Put the detailed checks inside the probe script; keep only invariants in the manifest.

Supported assertions: `jsonEquals`, `jsonMatches`, `stdoutJsonEquals`, `stdoutMatches`, `fileExists`, `fileContains`. Prefer JSON/state comparisons over stdout. Positive text such as `PASS` and the legacy `expected` field never decide success. Every behavioral entry needs at least one assertion or `forbiddenChanges` path.

Use `{"kind": "stdoutMatches", "pattern": "named observation", "flags": "i"}` to require an observation in stdout. `pattern` is a regex source string; `flags` is optional. The runner tests `new RegExp(pattern, flags)` against stdout only, alongside the exit-code and other assertions. A mismatch reports `stdout: expected /<pattern>/`. Invalid patterns or flags are manifest errors; the runner checks them across expanded entries before any command runs.

**Write the `ia` field as the outcome being proven, not as a release note.** Leave out version numbers, ticket IDs and "after feature X" phrasing.

**Collect verification targets by convention, not by list.** When several scripts of one kind must all run, have the probe discover them from the filesystem; a list silently skips a new file. Assert that the discovered count is above zero, and never hardcode the count.

A discovery entry does this for test files. It runs one check per file that matches `pattern`: a literal folder plus a file-name glob. The checks share the entry's `contract`. It fails with `matched no files` when nothing matches. A file that an explicit entry already runs is not discovered again. Every `exclude` item needs a `reason`. `command` is optional; `{file}` is replaced with each file, and the default is `node <file>`.

For file-specific checks, add `"fileAssertions": { "scripts/_test-example.js": [{ "kind": "stdoutMatches", "pattern": "named observation" }] }` to the discovery entry. Each array is appended to that file's `contract.assertions`; other files keep the shared contract. Keys are exact repo-relative discovered paths, in either slash style. Slash aliases of the same file append both arrays. A key that is absent after discovery exclusions and explicit-entry precedence is a manifest error naming the entry and file. The coverage restrictions below apply to the appended assertions too.

A selected check may reuse an unchanged PASS; selection does not mean the command ran. Set `"reuse": false` on an entry whose external tools, live services or other inputs cannot be tracked. On a discovery entry it disables reuse for every discovered check. To disable reuse for single files, set `"reuseExclude": ["scripts/_test-live.js"]` on the discovery entry instead. Its paths are exact and repo-relative, in either slash style. Unlike `discover.exclude`, these files stay eligible for selection, but the setting does not select them. `"always": true` selects the check on every run and never reuses its pass. The other never-reuse cases: [reuse and timing](runner-reuse-output.md#reuse-and-timing).

With `jobs` above 1, `"exclusive": true` runs a check alone, and checks sharing a `"group": "<name>"` run one at a time.

Top-level run settings, all optional:
- `jobs`: how many checks run side by side. Default: half of what the machine can run in parallel, capped at all of it. With no `jobs`, a check runs alone unless its last run traced it as a check run by the runner's own Node. A check in another language therefore runs one at a time until it gets `"exclusive": false` or a `group`.
- `minFreeMemoryMB`: no further check starts while less memory than this is free. Default 2048. One check always runs.
- `memoryShare`: no further check starts while the share of memory in use is above it. No default.
- `startSpacingMs`: side by side, the next check starts after a check finishes or after this pause, so the memory a started check takes is seen first. Default 250.
- `copyLiteralMinChars`: the notices name a changed test that ran when it holds quoted prose of at least this many characters that is word for word in its own inputs. Quoted prose has four or more plain words that are at least half its tokens; a command, code or a path is not prose. Default 40. A rewording of that prose would break the test.
- `retries`: a check that fails on inputs it once passed with runs again up to this many times. Default 1. A pass on retry counts as PASS and is named flaky. Later routine `--changed` runs leave it out until its test file changes; see [flaky and forbidden-file failures](runner-reuse-output.md#reuse-and-timing). A declared-input check that fails this way uses the whole project until its `inputs` change.
- `riskPaths`: files, folders or globs. A change to one of them brings the heavy checks whose own inputs changed into a routine `--changed` run, and the summary names the changed file. Heavy means `slow`, or a median pass time over `slowAfterSeconds`. No default: heavy checks wait for `--slow`.
- `passHistory`: how many pass fingerprints and pass times each record keeps. Default 10.

When another check also executes this test, an explicit entry can declare `"coveredBy": "V200"`. A discovery entry instead maps exact repo-relative file paths, in either slash style, to covering check IDs: `"coveredBy": { "scripts/_test-live.js": "V200" }`. The target must be an existing expanded check ID (for a discovered target, `V100:scripts/_test-example.js`), not a discovery group ID. Unknown targets and cycles are errors. Declare coverage only after inspecting the covering command and confirming it actually runs the child's test.

A covered entry or discovered file must have no `contract.assertions`. Every exact path in its `contract.forbiddenChanges` must also be in the covering check's list. Otherwise the manifest error names both IDs. When coverage applies at run time: [runner reuse and output](runner-reuse-output.md#reuse-and-timing).

A manifest edit reruns a check only when it changes that check's fingerprint: its run fields, or its inputs through `changed.global` and `exclude`. This includes edits already committed without a run: [manifest changes](runner-reuse-output.md#manifest-changes-and-records).

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

### Fields for checks that report what they used

How to design such checks: [select-by-use.md](select-by-use.md). Without these fields, the runner chooses checks by what they read or declare.

- `reportScope: ["data/**"]` (entry): the files, folders or globs inside which the check's report decides what it used. Default: the entry's `inputs`. An empty scope means the report is ignored. Files the check reads outside the scope stay inputs. An entry with no `inputs` needs `reportScope` for its report to narrow anything.
- `itemIdentity: { "file": "<program>", "args": ["<identity script>"], "timeout": 30000 }` (top level; `timeout` in milliseconds, default 60000): a project command, run from the project root with the files appended as relative paths. It prints `item<TAB>path<TAB>item<TAB>fingerprint` for every item and `rest<TAB>path<TAB>fingerprint` for the rest of each file. It must use the same fingerprint function as the checks' reports. Without it, or on a non-zero exit, a file with any used item counts as used whole. Hooks never run it.
- `"gate": true` (entry): marks the check that runs the program's start-up validation. A check narrowed by its report is reused only while the gate has passed on the current files. When the gate fails, those checks are NOT_RUN. A run without the gate runs the waiting checks themselves.
- `{cases}`: an argument in `command.args` that is exactly `{cases}`; it is not a field. The runner replaces it with the case names to run again, or drops it for a whole run. It keeps each case's files and result in the entry's record. The case list comes from the last report. When the test file changes, every case runs.
