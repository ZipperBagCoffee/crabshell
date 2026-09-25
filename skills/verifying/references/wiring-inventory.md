# Verifying — Step 2a: architecture map and connection inventory

Moved out of SKILL.md so the skill body stays within what Claude Code re-attaches after compaction (the first 5,000 tokens of each skill). Read this file when the body points here.

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
