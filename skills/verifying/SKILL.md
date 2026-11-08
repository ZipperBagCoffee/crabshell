---
name: verifying
description: "Creates project-specific verification tools when they don't exist, or runs existing ones against Intent Anchor items. Use when verification is needed and no project verification tool exists. Invoke with /verifying to create verification manifest, or /verifying run to execute existing tools."
---

# Verification Tool Skill

## Purpose

Most projects lack executable verification tools. This skill analyzes the project and creates a verification manifest that maps user-observable outcomes to portable commands and independent contracts.

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

The parent inspects the project directly (a bounded read-only helper only when it adds coverage). Determine:

1. **Runtime type:** Web app (browser), Node CLI, Python, compiled binary, shell scripts, etc.
2. **Entry points:** Main files, test runners, build commands
3. **Test infrastructure:** Existing test framework (jest, pytest, mocha, etc.), existing test files
4. **Build/run commands:** How to build, how to run, how to test
5. **Checks the project already runs:** package.json scripts, Makefile targets, CI steps, README instructions — any language. Each becomes a `tools` command or an entry: Crabshell recognizes a check only from the manifest.

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

For a Claude Code plugin project (`hooks/hooks.json` exists): copy the wiring probe next to the manifest, run discovery, approve each candidate hop against the source and the user's intent (never copy discovery as the contract), save the approved contract, then add one structural entry per approved hop and one completeness entry. An architecture map (`arch-explorer:build`) is optional documentation, never a pass/fail input. Exact paths, commands and entry shapes: `references/wiring-inventory.md`.

### Step 3: Review analysis

The parent resolves entry points and decisive commands from the inspected files; for high-risk ambiguity an optional read-only reviewer may look too, and the parent compares its finding with the files and owns the manifest.

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
    "test": "node .crabshell/verification/run-verify.js",
    "changed": "node .crabshell/verification/run-verify.js --changed"
  },
  "changed": { "global": ["{files every check depends on, as globs, e.g. config/*.json}"] },
  "entries": []
}
```

`tools` commands are **required checks**: a passing run is recorded as completion evidence (commits are never blocked); single entries are evidence only for themselves. `changed.global` adds files to every check's inputs; files only some checks read belong in their records. Optional top-level fields: `wrappers` (command prefixes such as `["rtk"]`: `rtk node x.js` counts as `node x.js`), `exclude` (paths left out of the project snapshot), `slowAfterSeconds`, `suggestAfterSeconds` (an undeclared command that takes longer and runs twice on the same files gets one hint to declare it; default 15).

### Step 5: Populate entries from current context

For each user-observable outcome in the current session, create one entry; commands are object-form, repo-relative, and shell-free. Before writing any entry answer two questions. **Q1:** what kind of claim is it — behavioral (execute the real surface), structural (read the artifact), or manual (a human looks)? **Q2:** will the expected value change on the next release — then assert a structure, invariant or relation, never the value (exact literals only when the spelling itself is the contract). Full guidance, assertion kinds and example entries: `references/manifest-entries.md` — read it before writing entries.

### Step 6: Create verification runner script

Copy `${CLAUDE_PLUGIN_ROOT}/skills/verifying/scripts/run-verify.js` and the `runner/` folder beside it into `.crabshell/verification/`. The launcher and its modules are the single runner implementation. Do not retype or fork them in the skill document. Session start keeps the copy current after plugin updates: changed modules are copied, a launcher Crabshell released is replaced, an edited launcher is kept and named once.

Also copy `${CLAUDE_PLUGIN_ROOT}/skills/verifying/scripts/check-pipeline-wiring.js` to `.crabshell/verification/check-pipeline-wiring.js`. Keep both files next to the manifest; never retype either implementation.

The runner runs `node` as its own Node, without a shell, rejects machine-specific absolute paths, evaluates assertions itself, and snapshots `forbiddenChanges` around the command.

### Step 7: Confirm

Tell user: "Verification manifest created with N entries. Run `/verifying run` to execute."
- **Document-first rule:** the manifest and runner files exist before the confirmation is reported.

---

## Run Mode

When invoked with `run`:

### Step 1: Read manifest

Read `.crabshell/verification/manifest.json`. If not found: "No manifest. Run `/verifying` first."

### Step 2: Execute verification runner

```bash
node .crabshell/verification/run-verify.js --changed  # selects checks touched by changed files
node .crabshell/verification/run-verify.js            # selects every check, only when requested
```

Routine updates run `--changed` once after the last edit. Run every check only when the user asks; a release runs `--changed --slow` (passes kept). If a full run seems needed, ask first and say why. A hand rerun of a declared check on the files it last passed with is blocked and answered from its record (`CRABSHELL_RERUN=1` before the command runs it anyway); after a hand run, Crabshell hints once each when the entry needs `inputs`, `slow` or `outputs`.

`test-map.json` keeps each check's record: its inputs (files and folders required, read, listed or copied), the fingerprints it passed with, durations and failures. Passing checks refresh their records even in a failing run. Failures keep prior files, add no pass and remain selected for retry; [failure marks](references/runner-reuse-output.md#reuse-and-timing) distinguish check failures from unresolved HEAD comparisons.

**Entry fields that keep routine runs short (D143).**
- `inputs: ["src/game/**", "tools/check_x.py"]` — the files, folders (ending in `/`) or globs a check reads. Required for a check the Node tracer cannot see that does not report what it used: without it the check's inputs are unknown and any project change reruns it. Declared inputs enter its fingerprint and are recorded like traced files.
- `outputs: ["build/"]` — files the check writes: its products, not its inputs.
- `slow: true` — recordings, screenshots and golden renders, benchmarks, long simulations, real installs, whole-suite runs. `--changed` skips them and prints `Slow checks not run: … — run them with: node .crabshell/verification/run-verify.js --slow`; they run with `--slow`, on a full run (when the user asks) and at the project's release step.

`--changed` chooses by content, not Git: a check reruns only when its fingerprint (run fields, program, runner, platform, input contents) is not among those it passed with — new, failed last time, `always: true`, `reuse: false`, or changed inputs; unknown inputs mean the whole project. A changed file no check reads or declares runs the declared-input checks once. A record of another schema counts as none. Crabshell's storage (`.crabshell/` outside the verification folder) is never snapshotted. Records: [manifest changes](references/runner-reuse-output.md#manifest-changes-and-records). `--explain` prints each check `--changed` would run with its first reason, running nothing; `--dry-run` shows the selection (`/status` uses it). Blind spots: a non-Node check's reads outside its `inputs`, untraced computed paths. Many checks for one change: read `--explain`, then make checks report what they used ([select-by-use](references/select-by-use.md)); never answer with a time target or a check cap.

**Reuse and timing.** Before executing checks, read [reuse eligibility and timing](references/runner-reuse-output.md#reuse-and-timing) for fingerprint inputs, exclusions, controls, `coveredBy` duplicate suppression and dry-run estimates.

**Fail-before (opt-in, `--fail-before`).** With the flag, a changed test that passes and reads changed non-test files also runs on a temporary HEAD copy; use it for a test written to catch a bug. Passing there produces a failing `FAIL_BEFORE:<id>` result. Intentional behavior-preserving changes can be exempted by test hash in `fail-before-exempt.json`. Details, format and `--no-fail-before`: `references/fail-before.md`.

### Step 2b: When an entry fails, decide what is wrong before touching anything

A failing verifier means one of two things, and they have opposite fixes. Ask:

**Is this expected value an approved contract, or is it just what the implementation happened to produce?**

| Answer | Meaning | Fix |
|---|---|---|
| An approved contract, and it is unchanged | The code broke it | Fix the code. Changing the verifier here hides a regression |
| The contract was deliberately changed this release | The old expectation is obsolete | Update the verifier, and say so explicitly in the report with what the new contract is and who approved it |
| Neither — it was incidental output the verifier copied | The verifier was overspecified | Rewrite that assertion as structure, invariant, or relation so it stops breaking on unrelated changes |

Code is the likelier culprit (four in five regression failures in one industrial study were code defects). Treat "fix the verifier" as the named exception, never the reflex; silently re-recording what the code now outputs is not verification.

For a wiring entry, a FAIL means either the source broke a parent-approved hop, in which case fix the source, or the hop was deliberately removed or renamed in this release, in which case update `wiring-contract.json` and state the approved change in the report by naming the hop. Map staleness is never a wiring FAIL; it is only the documentation state recorded by Create Mode Step 2a(i).

### Step 3: Parse and record each result

For each entry, record the command run (or file read), its output line (runner output, state or hash) and pass/fail against its contract. A behavior claim needs an execution result; a structure claim (grep, file read, code inspection), what was read — say it was static.
For `reused: true`, cite the earlier passing observation and unchanged inputs; do not describe it as a new execution. Manual results await a person.
For `coveredBy: "<id>"`, cite that covering check's executed or reused PASS; the child did not run independently and has no pass fingerprint of its own.

- **Document-first rule:** If this verification run was invoked from within a T or P document context, append these records to that document's verification section using the Edit tool FIRST. After the document is updated, report the summary in conversation. Standalone invocations may report conversation-only.

### Step 4: Summary

Read [output and saved results](references/runner-reuse-output.md#output-and-saved-results) before reporting; it defines the summary, saved JSON, compatibility flags and commit-gate constraints.

### Step 5: Against the discussion's Intent Anchor

When the run serves a discussion (a ticket under `D{NNN}`, or a regressing cycle), passing entries are not yet proof that the discussion's goals were met. Read that discussion's Intent Anchor and map the results onto it:

```
| IA-n (from the discussion) | Entries / evidence that prove it | Covered? |
|---|---|---|
```

An IA item that no passing entry or other tool output proves is listed as "no evidence" — say so in the ticket's Intent Fidelity table and in the summary, and add an entry or a direct observation for it before calling the goal met. Manifest `ia` fields are outcome prose, not the discussion's IA numbers, so the mapping is this step's judgement, not the runner's.

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

---

## Rules

1. **EXECUTABLE only.** Every non-manual entry has a portable command object and exit contract; behavioral entries also need an independent assertion or forbidden-change snapshot.
2. **Match the method to the claim.** "It works" requires execution. "The artifact has this structure" is checked statically. Neither substitutes for the other.
3. **Never write down a value the next release will change.** Derive it from the authoritative source, or assert a relation, structure, or invariant instead. Exact literals are for spellings that are themselves the contract — protocol names, field names, command keywords.
4. **A failing entry means the code is wrong until shown otherwise.** Editing the verifier to make it pass is allowed only when the contract deliberately changed, and that must be stated in the report.
5. **Discover targets, do not list them.** Assert `discovered > 0` and `failures == 0`; never hardcode a count.
6. **Manifest is source of truth.** All entries live in `manifest.json`.
7. **Ticket record form.** Run mode records each result as a ticket's `## Verification Results` does.
8. **No git commit.** `.crabshell/verification/` is local — do NOT commit.
9. **Timeout safety.** Default 30s. Destructive commands (rm, drop) PROHIBITED.
10. **Idempotent create.** Existing manifest is NOT overwritten.
11. **External skills are optional:** Verification never depends on `arch-explorer` or any third-party plugin being installed; their absence is recorded, never fatal.
12. **The wiring contract is approved by the parent, never copied from discovery:** Every `hooks.json` command, agent file, and trigger token must be classified as approved or ignored with a reason, and the completeness entry fails otherwise.
