---
name: verifying
description: "Creates project-specific verification tools when they don't exist, or runs existing ones against Intent Anchor items. Use when verification is needed and no project verification tool exists. Invoke with /verifying to create verification manifest, or /verifying run to execute existing tools."
---

# Verification Tool Skill

## Purpose

Analyze the project and create a verification manifest. It maps user-observable outcomes to portable commands and independent contracts.

## Modes

- **Create mode:** `/verifying` — analyze the project; create the manifest and scripts.
- **Run mode:** `/verifying run` — run the existing tools against the current IA items.
- **Update mode:** `/verifying add "IA item description"` — add one entry to the manifest.
- **Wiring update mode:** `/verifying wiring` — refresh and review the project connection inventory.

---

## Create Mode

When invoked without arguments:

### Step 1: Check for existing manifest

Check whether `.crabshell/verification/manifest.json` exists in the project root.

- **Exists:** Report its contents and ask: "Manifest exists with N entries. Update, refresh wiring, or run?" If the user chooses "refresh wiring", go to Step 2a.
- **Does not exist:** Go to Step 2.

### Step 2: Analyze project runtime environment

The parent inspects the project directly. Use a bounded read-only worker only when it adds coverage. Determine:

1. **Runtime type:** web app (browser), Node CLI, Python, compiled binary, shell scripts, or other.
2. **Entry points:** main files, test runners, build commands.
3. **Test infrastructure:** the test framework (jest, pytest, mocha, ...) and test files.
4. **Build/run commands:** how to build, run and test.
5. **Checks the project already runs:** package.json scripts, Makefile targets, CI steps, README instructions, in any language. Make each one a `tools` command or an entry. Crabshell recognizes a check only from the manifest.

Record the analysis as:
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

Find every hop: one part starting, loading or signaling another, such as a hook, entry point, plugin or route. Approve each candidate hop against the source and the user's intent; never copy discovery as the contract. Save the approved contract. Add one structural entry per approved hop, proving it is wired and loads, and one completeness entry. An architecture map (`arch-explorer:build`) is optional documentation, never a pass/fail input. Discovery (a bundled probe covers Claude Code plugins), paths and entry shapes: `references/wiring-inventory.md`.

### Step 3: Review analysis

The parent resolves entry points and decisive commands from the inspected files. For high-risk ambiguity, a read-only worker may also review them. The parent compares its finding with the files and owns the manifest.

### Step 4: Create verification manifest

Create `.crabshell/verification/` if it does not exist. Create `.crabshell/verification/manifest.json` with schema version 2:
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

`tools` commands are **required checks**: a passing run is recorded as completion evidence. Commits are never blocked. A single entry is evidence only for itself. `changed.global` adds files to every check's inputs. Files that only some checks read belong in those checks' records. Optional top-level fields:
- `wrappers`: command prefixes such as `["rtk"]`. `rtk node x.js` then counts as `node x.js`.
- `exclude`: paths left out of the project snapshot.
- `slowAfterSeconds`.
- `suggestAfterSeconds`: an undeclared command that takes longer than this and runs twice on the same files gets one hint to declare it. Default 15.

### Step 5: Populate entries from current context

Create one entry per user-observable outcome in the current session. Commands are object-form, repo-relative and shell-free. Before writing an entry, answer two questions:
- **Q1:** What kind of claim is it? Behavioral: execute the real surface. Structural: read the artifact. Manual: a person looks. "It works" needs execution; "the artifact has this structure" is checked statically. Neither substitutes for the other.
- **Q2:** Will the expected value change on the next release? Then derive it from the authoritative source, or assert a structure, invariant or relation, never the value. Use exact literals only when the spelling itself is the contract: protocol names, field names, command keywords.

Read `references/manifest-entries.md` before writing entries. It holds the full guidance, assertion kinds and example entries.

### Step 6: Create verification runner script

Copy `${CLAUDE_PLUGIN_ROOT}/skills/verifying/scripts/run-verify.js` and the `runner/` folder beside it into `.crabshell/verification/`, next to the manifest. Never retype the implementation, and never fork it in the skill document.

Session start keeps the copy current after plugin updates. It copies changed modules and replaces a launcher Crabshell released. It keeps an edited launcher and names it once.

The runner runs `node` as its own Node, without a shell. It rejects machine-specific absolute paths, evaluates assertions itself, and snapshots `forbiddenChanges` around the command.

### Step 7: Confirm

Tell the user: "Verification manifest created with N entries. Run `/verifying run` to execute."
- **Document-first rule:** the manifest and runner files exist before you report this.

---

## Run Mode

When invoked with `run`:

### Step 1: Read manifest

Read `.crabshell/verification/manifest.json`. If it is missing, say: "No manifest. Run `/verifying` first."

### Step 2: Execute verification runner

```bash
node .crabshell/verification/run-verify.js --changed  # selects checks touched by changed files
node .crabshell/verification/run-verify.js            # selects every check, only when requested
```

For routine updates, run `--changed` once after the last edit. Run every check only when the user asks. If a full run seems needed, ask first and say why. A release runs `--changed --slow`, which keeps passes.

A hand rerun of a declared check on the files it last passed with is blocked and answered from its record. Put `CRABSHELL_RERUN=1` before the command to run it anyway. After a hand run, Crabshell hints once each when the entry needs `inputs`, `slow` or `outputs`.

`test-map.json` keeps each check's record: its inputs (files and folders it required, read, listed or copied), the fingerprints it passed with, durations and failures. Passing checks refresh their records even in a failing run. A failure keeps the prior files, adds no pass and stays selected for retry. [Failure marks](references/runner-reuse-output.md#reuse-and-timing) tell check failures apart from unresolved HEAD comparisons.

**Entry fields that keep routine runs short.**
- `inputs: ["src/game/**", "tools/check_x.py"]` — the files, folders (ending in `/`) or globs a check reads. Required when the Node tracer cannot see the check and the check does not report what it used. Without it, the check's inputs are unknown and any project change reruns it. Declared inputs enter its fingerprint and are recorded like traced files.
- `outputs: ["build/"]` — files the check writes. They are its products, not its inputs. A check whose recorded inputs include one waits for the writer when the writer runs, and is then reused if the content is what it passed with.
- `slow: true` — a check too long for every change, such as a real install. A median pass time over `slowAfterSeconds` makes a check slow without the flag. `--changed` skips them and prints `Slow checks not run: … — run them with: node .crabshell/verification/run-verify.js --slow`. They run with `--slow`, on a full run the user asked for, and at the project's release step.

`--changed` chooses by content, not Git. A check reruns only when its fingerprint is not among those it passed with. The fingerprint covers run fields, program, runner, platform and input contents. So a check reruns when it is new, failed last time, has `always: true` or `reuse: false`, or its inputs changed. Unknown inputs mean the whole project. A changed file that no check reads or declares runs the declared-input checks once. A record of another schema counts as none. Crabshell's storage (`.crabshell/` outside the verification folder) is never snapshotted. Records: [manifest changes](references/runner-reuse-output.md#manifest-changes-and-records).

`--explain` prints each check `--changed` would run, with its reason and every other input that changed, and runs nothing. `--dry-run` shows the selection; `/status` uses it. Blind spots: a non-Node check's reads outside its `inputs`, and untraced computed paths. When one change selects many checks, read `--explain`, then make checks report what they used ([select-by-use](references/select-by-use.md)). When the run itself takes long, find where the time goes first ([check cost](references/check-cost.md)). Never answer with a time target or a check cap.

**Reuse and timing.** Before executing checks, read [reuse eligibility and timing](references/runner-reuse-output.md#reuse-and-timing). It covers fingerprint inputs, exclusions, controls, `coveredBy` duplicate suppression and dry-run estimates.

**Fail-before (opt-in, `--fail-before`).** With the flag, a changed test that passes and reads changed non-test files also runs on a temporary HEAD copy. Use it for a test written to catch a bug. If the test passes there too, `FAIL_BEFORE:<id>` fails. A change that keeps behavior on purpose can be exempted by test hash in `fail-before-exempt.json`. Details, format and `--no-fail-before`: `references/fail-before.md`.

### Step 2b: When an entry fails, decide what is wrong before touching anything

Ask: **is this expected value an approved contract, or only what the implementation happened to produce?**

| Answer | Meaning | Fix |
|---|---|---|
| An approved contract, and it is unchanged | The code broke it | Fix the code. Changing the check here hides a regression |
| The contract was changed on purpose this release | The old expectation is obsolete | Update the check (apply Create Mode Step 5 Q2: no value the next release will change), and say so explicitly in the report: the new contract and who approved it |
| Neither: incidental output the check copied | The check was overspecified | Rewrite that assertion as a structure, invariant or relation |

Treat the code as wrong until shown otherwise. Fixing the check is the named exception, never the reflex. Silently re-recording what the code now outputs is not verification.

A wiring entry FAIL means one of two things. If the source broke a parent-approved hop, fix the source. If the hop was removed or renamed on purpose in this release, update `wiring-contract.json` and name the approved hop change in the report. A stale map is never a wiring FAIL; it is only the documentation state from Create Mode Step 2a(i).

### Step 3: Parse and record each result

For each entry, record the command run or the file read, its output line (runner output, state or hash), and pass/fail against its contract. A behavior claim needs an execution result. A structure claim (grep, file read, code inspection) records what was read and says the check was static.
For `reused: true`, cite the earlier passing observation and the unchanged inputs; do not call it a new execution. For `coveredBy: "<id>"`, cite that covering check's executed or reused PASS; the child did not run on its own and has no pass fingerprint. Manual results wait for a person.

- **Document-first rule:** When this run was invoked from a T or P document context, append these records to that document's verification section with the Edit tool FIRST. Then report the summary in chat. A standalone run may report in chat only.

### Step 4: Summary

Before reporting, read [output and saved results](references/runner-reuse-output.md#output-and-saved-results). It defines the summary, the saved JSON, compatibility flags and commit-gate constraints.

### Step 5: Against the discussion's Intent Anchor

When the run serves a discussion (a ticket under `D{NNN}`, or a regressing cycle), passing entries do not yet prove the discussion's goals. Read its Intent Anchor and map the results onto it:

```
| IA-n (from the discussion) | Entries / evidence that prove it | Covered? |
|---|---|---|
```

Mark an IA item that no passing entry or other tool output proves as "no evidence". Say so in the ticket's Intent Fidelity table and in the summary. Add an entry or a direct observation for it before calling the goal met. Manifest `ia` fields are outcome prose, not the discussion's IA numbers, so this mapping is this step's judgement, not the runner's.

---

## Update Mode

When invoked with `add "description"`:

1. Read the manifest. If it is missing: "Run `/verifying` first."
2. Take the next entry ID (V001, V002, ...).
3. Create an entry with IA, type, a portable command object, a structured contract and a timeout. Apply Create Mode Step 5 Q1 and Q2 to it (match the method to the claim; never write down a value the next release will change).
4. Append it to the manifest's entries array.
5. Update the `updated` timestamp.

When invoked with `wiring`:

1. Read the existing approved `wiring-contract.json`. If it does not exist, run Create Mode Step 2a.
2. Rerun discovery and save the new candidate output.
3. Diff the candidate against the approved contract. Present every new and removed hop to the parent for approval. Do not copy the candidate over the contract.
4. After approval, update the contract, the hop entries, the completeness entry and the manifest `updated` timestamp together.
5. Optionally regenerate the architecture map when `arch-explorer:build` is available. The map stays documentation only.

---

## Rules

1. **EXECUTABLE only.** Every non-manual entry has a portable command object and an exit contract. A behavioral entry also needs an independent assertion or a forbidden-change snapshot.
2. **Discover targets, do not list them.** Assert `discovered > 0` and `failures == 0`; never hardcode a count.
3. **Manifest is source of truth.** All entries live in `manifest.json`.
4. **Ticket record form.** Run mode records each result the way a ticket's `## Verification Results` does.
5. **No git commit.** `.crabshell/verification/` is local; do NOT commit it.
6. **Timeout safety.** Default 30s. Destructive commands (rm, drop) PROHIBITED.
7. **Idempotent create.** Never overwrite an existing manifest.
8. **External skills are optional.** Verification never depends on `arch-explorer` or any third-party plugin being installed. Record their absence; it is never fatal.
9. **The parent approves the wiring contract; never copy it from discovery.** Classify every discovered hop as approved, or ignored with a reason. Otherwise the completeness entry fails.
