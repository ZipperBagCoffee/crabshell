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

Supported assertions are `jsonEquals`, `jsonMatches`, `stdoutJsonEquals`, `fileExists`, and `fileContains`. Prefer JSON/state comparisons over stdout. Positive text such as `PASS` and the legacy `expected` field never decide success. Every behavioral entry must contain at least one assertion or `forbiddenChanges` path.

**Write the `ia` field as the outcome being proven, not as a release note.** Version numbers, ticket IDs, and "after feature X" phrasing go stale and force an edit that proves nothing.

**Collect verification targets by convention, not by list.** When several scripts of the same kind must all run, have the probe discover them from the filesystem — a test file that exists but appears in no list is silently never executed. Assert that the discovered count is above zero so an empty glob fails loudly, and never hardcode how many were found.

The runner does this for test files with a discovery entry. It runs one check per file matching `pattern` (a literal folder and a file-name glob), shares the entry's `contract`, and fails with `matched no files` when nothing matches. A file that an explicit entry already runs is not discovered again. Every `exclude` item needs a `reason`. `command` is optional, and `{file}` is replaced with each file; the default is `node <file>`.
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
