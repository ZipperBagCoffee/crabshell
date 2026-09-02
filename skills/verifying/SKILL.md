---
name: verifying
description: "Creates project-specific verification tools when they don't exist, or runs existing ones against Intent Anchor items. Use when verification is needed and no project verification tool exists. Invoke with /verifying to create verification manifest, or /verifying run to execute existing tools."
---

# Verification Tool Skill

## Purpose

Bridge the gap between VERIFICATION-FIRST principles and project reality. Most projects lack executable verification tools. This skill analyzes the runtime environment and creates a verification manifest that maps user-observable outcomes to portable commands and independent contracts.

## Modes

- **Create mode:** `/verifying` — analyze project, create verification manifest + scripts
- **Run mode:** `/verifying run` — execute existing verification tools against current IA items
- **Update mode:** `/verifying add "IA item description"` — add a new verification entry to manifest
- **Wiring update mode:** `/verifying wiring` — refresh and review the project connection inventory

---

## Create Mode

When invoked without arguments:

### Step 1: Check for existing manifest

Check if `.crabshell/verification/manifest.json` exists in the project root.

- **Exists:** Report current manifest contents and ask: "Manifest exists with N entries. Update, refresh wiring, or run?" If the user chooses "refresh wiring", jump to Step 2a.
- **Does not exist:** Proceed to Step 2.

### Step 2: Analyze project runtime environment

The parent inspects the project directly. Delegate a bounded read-only exploration only when it materially improves coverage; delegation is not a gate. Determine:

1. **Runtime type:** Web app (browser), Node CLI, Python, compiled binary, shell scripts, etc.
2. **Entry points:** Main files, test runners, build commands
3. **Test infrastructure:** Existing test framework (jest, pytest, mocha, etc.), existing test files
4. **Build/run commands:** How to build, how to run, how to test

Record the parent-owned analysis as:
```
## Project Analysis
- Runtime: {type}
- Entry points: {list}
- Test framework: {name or "none"}
- Build command: {command}
- Run command: {command}
- Test command: {command or "none"}
```

### Step 2a: Architecture map and connection inventory

Use these project-local paths:

```text
VERIFICATION_ARCHITECTURE_INDEX = {PROJECT_ROOT}/.crabshell/verification/architecture/index.html
VERIFICATION_PROBE             = {PROJECT_ROOT}/.crabshell/verification/check-pipeline-wiring.js
VERIFICATION_CANDIDATE         = {PROJECT_ROOT}/.crabshell/verification/wiring-contract.candidate.json
VERIFICATION_CONTRACT          = {PROJECT_ROOT}/.crabshell/verification/wiring-contract.json
```

#### (i) Architecture map (optional, documentation only)

If a skill named `arch-explorer:build` appears in the available skills, invoke it with scope set to the whole repository and output path set to `VERIFICATION_ARCHITECTURE_INDEX`. Its README goes next to the HTML file. Record exactly one state in the P/O/G report:

- `generated` — the skill was invoked and `VERIFICATION_ARCHITECTURE_INDEX` exists
- `unavailable` — the skill is not installed, or the current runtime such as Codex has no such skill
- `generation-failed` — the skill was invoked but the HTML file was not produced

The map is a coverage hint for the parent when approving hops and a document for humans. Never parse it, and never let it decide verification pass/fail. Verification continues in every state.

#### (ii) Connection inventory

For a Claude Code plugin project where `hooks/hooks.json` exists:

1. Copy `${CLAUDE_PLUGIN_ROOT}/skills/verifying/scripts/check-pipeline-wiring.js` to `VERIFICATION_PROBE`. Copy it; never retype or fork it.
2. Run `node .crabshell/verification/check-pipeline-wiring.js discover` and save its stdout as `VERIFICATION_CANDIDATE`.
3. The parent reviews every candidate hop against the architecture map when available, the source, and the user's IA. Remove candidates that are not part of an approved pipeline, or list them under `ignore` and record the reason in the P/O/G notes.
4. Save the parent-approved list as `VERIFICATION_CONTRACT`.

The contract is approved by the parent, not copied from discovery. Discovery reflects the current source, so a deleted hop vanishes from discovery too; only an approved contract can catch a deletion.

For other project types, derive hops by hand from the map's edges or directly from the code, create one manifest entry per approved hop with a project-specific deterministic probe, and do not fake a `hooks.json` file.

#### (iii) Manifest entries

Create one `structural` entry per approved hop. Every hop entry calls the same probe with `--hop <id>`, expects exit code 0, and asserts `stdoutJsonEquals` at `/passed`. Use an outcome in `ia`, with no version or ticket number:

```json
{
  "id": "V017",
  "ia": "hook PostToolUse to scripts/counter.js check is wired and loadable",
  "type": "structural",
  "command": {
    "file": "node",
    "args": [
      ".crabshell/verification/check-pipeline-wiring.js",
      "check",
      "--contract",
      ".crabshell/verification/wiring-contract.json",
      "--hop",
      "posttooluse:counter:check"
    ]
  },
  "contract": {
    "exitCode": 0,
    "assertions": [
      { "kind": "stdoutJsonEquals", "pointer": "/passed", "equals": true }
    ],
    "forbiddenChanges": []
  },
  "timeout": 30000
}
```

Add one completeness entry that classifies every discovered hook command, agent file, and trigger token:

```json
{
  "id": "V018",
  "ia": "every discovered pipeline hook, trigger, and agent is approved or ignored with a reason",
  "type": "structural",
  "command": {
    "file": "node",
    "args": [
      ".crabshell/verification/check-pipeline-wiring.js",
      "check",
      "--contract",
      ".crabshell/verification/wiring-contract.json",
      "--completeness"
    ]
  },
  "contract": {
    "exitCode": 0,
    "assertions": [
      { "kind": "stdoutJsonEquals", "pointer": "/passed", "equals": true }
    ],
    "forbiddenChanges": []
  },
  "timeout": 30000
}
```

These command objects run from the project root because `run-verify.js` resolves `command.file: "node"` to `process.execPath`, uses the project root as the default `cwd`, and supplies `PROJECT_ROOT` and `CLAUDE_PROJECT_DIR` to the child process.

### Step 3: Review analysis

The parent resolves entry points and decisive commands from inspected project evidence. For high-risk ambiguity, an optional read-only reviewer may independently inspect the project, but the parent must compare the finding with the actual files and remains responsible for the manifest.

### Step 4: Create verification manifest

Create `.crabshell/verification/` directory if it doesn't exist.

Create `.crabshell/verification/manifest.json` using schema version 2:
```json
{
  "schemaVersion": 2,
  "projectType": "{runtime type}",
  "created": "{ISO timestamp}",
  "updated": "{ISO timestamp}",
  "tools": {
    "build": "{build command or null}",
    "run": "{run command or null}",
    "test": "{test command or null}"
  },
  "entries": []
}
```

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

### Step 6: Create verification runner script

Copy `${CLAUDE_PLUGIN_ROOT}/skills/verifying/scripts/run-verify.js` to `.crabshell/verification/run-verify.js`. This tracked file is the single runner implementation. Do not retype or fork it in the skill document.

Also copy `${CLAUDE_PLUGIN_ROOT}/skills/verifying/scripts/check-pipeline-wiring.js` to `.crabshell/verification/check-pipeline-wiring.js`. Keep both files next to the manifest; never retype either implementation.

The runner resolves `node` from `process.execPath`, runs without a shell, rejects machine-specific absolute paths, evaluates assertions itself, snapshots `forbiddenChanges` before and after the command, and emits machine-readable results before its summary.

### Step 7: Confirm

Tell user: "Verification manifest created with N entries. Run `/verifying run` to execute."
- **Document-first rule:** The manifest.json and run-verify.js files must be fully created before any confirmation is reported in conversation.

---

## Run Mode

When invoked with `run`:

### Step 1: Read manifest

Read `.crabshell/verification/manifest.json`. If not found: "No manifest. Run `/verifying` first."

### Step 2: Execute verification runner

```bash
node .crabshell/verification/run-verify.js
```

### Step 2b: When an entry fails, decide what is wrong before touching anything

A failing verifier means one of two things, and they have opposite fixes. Ask:

**Is this expected value an approved contract, or is it just what the implementation happened to produce?**

| Answer | Meaning | Fix |
|---|---|---|
| An approved contract, and it is unchanged | The code broke it | Fix the code. Changing the verifier here hides a regression |
| The contract was deliberately changed this release | The old expectation is obsolete | Update the verifier, and say so explicitly in the report with what the new contract is and who approved it |
| Neither — it was incidental output the verifier copied | The verifier was overspecified | Rewrite that assertion as structure, invariant, or relation so it stops breaking on unrelated changes |

Code is the more likely culprit — in one industrial study of regression failures, roughly four out of five traced to a code defect rather than an obsolete test. Treat "fix the verifier" as the exception that must be named, never the reflex. Silently re-recording whatever the code now outputs is not verification.

For a wiring entry, a FAIL means either the source broke a parent-approved hop, in which case fix the source, or the hop was deliberately removed or renamed in this release, in which case update `wiring-contract.json` and state the approved change in the report by naming the hop. Map staleness is never a wiring FAIL; it is only the documentation state recorded by Create Mode Step 2a(i).

### Step 3: Parse and report as P/O/G

| Item | Type | Prediction (from manifest contract) | Observation (from runner output/state/hash) | Gap |
|------|------|-------------------------------------|----------------------------------|-----|

Type: `behavioral` = runtime execution observed (ran command, triggered feature, checked output)
Type: `structural` = static check (grep, file read, code inspection)
- **Document-first rule:** If this verification run was invoked from within a T or P document context, append the P/O/G results to that document's verification section using the Edit tool FIRST. After the document is updated, report the summary in conversation. Standalone invocations may report conversation-only.

### Step 4: Summary

```
Verification Results: PASS: N / FAIL: N / Manual: N / Total: N
```

---

## Update Mode

When invoked with `add "description"`:

1. Read manifest. If not found: "Run `/verifying` first."
2. Determine next entry ID (V001, V002, ...)
3. Create an entry with IA, type, portable command object, structured contract, and timeout
4. Append to manifest entries array
5. Update `updated` timestamp

When invoked with `wiring`:

1. Read the existing approved `wiring-contract.json`. If it does not exist, run Create Mode Step 2a.
2. Re-run `check-pipeline-wiring.js discover` and save the new candidate output.
3. Diff the candidate against the approved contract and present every new and removed hop to the parent for approval. Do not copy the candidate over the contract.
4. After approval, update the contract, hop entries, completeness entry, and manifest `updated` timestamp together.
5. Optionally regenerate the architecture map when `arch-explorer:build` is available. The map remains documentation only.

`/verifying add` is unchanged and continues to add one IA entry as described above.

---

## Rules

1. **EXECUTABLE only.** Every non-manual entry has a portable command object and exit contract; behavioral entries also need an independent assertion or forbidden-change snapshot.
2. **Match the method to the claim.** "It works" requires execution. "The artifact has this structure" is checked statically. Neither substitutes for the other.
3. **Never write down a value the next release will change.** Derive it from the authoritative source, or assert a relation, structure, or invariant instead. Exact literals are for spellings that are themselves the contract — protocol names, field names, command keywords.
4. **A failing entry means the code is wrong until shown otherwise.** Editing the verifier to make it pass is allowed only when the contract deliberately changed, and that must be stated in the report.
5. **Discover targets, do not list them.** Assert `discovered > 0` and `failures == 0`; never hardcode a count.
6. **Manifest is source of truth.** All entries live in `manifest.json`.
7. **P/O/G alignment.** Run mode produces P/O/G table rows.
8. **No git commit.** `.crabshell/verification/` is local — do NOT commit.
9. **Timeout safety.** Default 30s. Destructive commands (rm, drop) PROHIBITED.
10. **Idempotent create.** Existing manifest is NOT overwritten.
11. **External skills are optional:** Verification never depends on `arch-explorer` or any third-party plugin being installed; their absence is recorded, never fatal.
12. **The wiring contract is approved by the parent, never copied from discovery:** Every `hooks.json` command, agent file, and trigger token must be classified as approved or ignored with a reason, and the completeness entry fails otherwise.
