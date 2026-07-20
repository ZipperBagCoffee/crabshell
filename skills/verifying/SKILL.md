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

---

## Create Mode

When invoked without arguments:

### Step 1: Check for existing manifest

Check if `.crabshell/verification/manifest.json` exists in the project root.

- **Exists:** Report current manifest contents and ask: "Manifest exists with N entries. Update or run?"
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

For each user-observable outcome in the current session, create a verification entry. Commands are object-form, repo-relative, and shell-free:
```json
{
  "id": "V001",
  "ia": "IA-1: {description}",
  "type": "behavioral|structural|manual",
  "command": {
    "file": "node",
    "args": ["scripts/behavior-test.js"]
  },
  "contract": {
    "exitCode": 0,
    "assertions": [
      { "kind": "jsonEquals", "path": "tmp/observed.json", "pointer": "/result", "equals": "expected" }
    ],
    "forbiddenChanges": ["user-owned.txt"]
  },
  "timeout": 30000
}
```

**Type classification:**
| Type | When | Example |
|------|------|---------|
| `behavioral` | Executes the actual surface and has an independent assertion or forbidden-side-effect snapshot | Run a CLI, parse its JSON result, compare state and protected paths |
| `structural` | Executes a static/schema/import check; never substitutes for a behavioral outcome | Parse a manifest or compile a module |
| `manual` | Requires human interaction (browser, GUI) | "Open browser, click button, observe result" |

Supported assertions are `jsonEquals`, `jsonMatches`, `stdoutJsonEquals`, `fileExists`, and `fileContains`. Prefer JSON/state comparisons over stdout. Positive text such as `PASS` and the legacy `expected` field never decide success. Every behavioral entry must contain at least one assertion or `forbiddenChanges` path.

### Step 6: Create verification runner script

Copy `${CLAUDE_PLUGIN_ROOT}/skills/verifying/scripts/run-verify.js` to `.crabshell/verification/run-verify.js`. This tracked file is the single runner implementation. Do not retype or fork it in the skill document.

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

---

## Rules

1. **EXECUTABLE only.** Every non-manual entry has a portable command object and exit contract; behavioral entries also need an independent assertion or forbidden-change snapshot.
2. **Manifest is source of truth.** All entries live in `manifest.json`.
3. **P/O/G alignment.** Run mode produces P/O/G table rows.
4. **No git commit.** `.crabshell/verification/` is local — do NOT commit.
5. **Timeout safety.** Default 30s. Destructive commands (rm, drop) PROHIBITED.
6. **Idempotent create.** Existing manifest is NOT overwritten.
