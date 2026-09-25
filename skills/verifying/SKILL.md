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

For a Claude Code plugin project (`hooks/hooks.json` exists): copy the wiring probe next to the manifest, run discovery, approve each candidate hop against the source and the user's intent (never copy discovery as the contract), save the approved contract, then add one structural entry per approved hop and one completeness entry. An architecture map (`arch-explorer:build`) is optional documentation, never a pass/fail input. Exact paths, commands and entry shapes: `references/wiring-inventory.md`.

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
    "test": "node .crabshell/verification/run-verify.js",
    "changed": "node .crabshell/verification/run-verify.js --changed"
  },
  "changed": { "global": ["{files every check depends on, as globs, e.g. config/*.json}"] },
  "entries": []
}
```

`tools` commands (and the package.json `test` script) are the project's **required checks**: only they unlock the commit gate. A single entry's command still counts as evidence for that entry, but passing one entry does not unlock a commit. `changed.global` lists files whose change must run every check. Package manifests and lockfiles, the manifest, and the runner itself are always global.

### Step 5: Populate entries from current context

For each user-observable outcome in the current session, create one entry; commands are object-form, repo-relative, and shell-free. Before writing any entry answer two questions. **Q1:** what kind of claim is it — behavioral (execute the real surface), structural (read the artifact), or manual (a human looks)? **Q2:** will the expected value change on the next release — then assert a structure, invariant or relation, never the value (exact literals only when the spelling itself is the contract). Full guidance, assertion kinds and example entries: `references/manifest-entries.md` — read it before writing entries.

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
node .crabshell/verification/run-verify.js            # every check; rebuilds the load map when all pass
node .crabshell/verification/run-verify.js --changed  # only the checks the changed files touch
```

A full run records `test-map.json` beside the manifest. The map lists, for each check, the repository files and folders it requires, reads, lists, or copies. Child processes are included, along with path strings and relative requires in the test file and the files its assertions read. The map is kept only when every check passed.

`--changed` looks at the working tree against HEAD, including renames by old and new path and untracked files. `--files a,b` names the files instead, and `--dry-run` prints the selection as JSON without running anything. It selects checks whose test file changed, or whose recorded files or folders contain a changed file. Checks that record no files, and entries marked `always: true`, always run. It runs **every** check when:
- a changed file matches `changed.global` or the default globals;
- there is no map, or the map cannot be read;
- the manifest, the runner, a test, or any recorded file changed after the map was written (the map stores each file's content hash, so a file whose time moved but whose content is unchanged — a revert, a checkout — does not count);
- a changed non-prose file is not in the map;
- no changed file is found at all.

Prose that no check reads selects nothing. A release that changes a version file listed in `changed.global` therefore always runs everything. Remaining blind spots: reads made by non-Node processes, and paths computed from data a check never touches. Files git ignores (runtime state such as `.crabshell/memory/`) never count as changed and do not make the map stale, so a check whose input is an ignored file is not re-selected when that file changes; the manifest, runner and test files are still checked even when ignored. Run the full set before a release.

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
