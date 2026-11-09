# Verifying — Step 2a: architecture map and connection inventory

### Step 2a: Architecture map and connection inventory

Use these project-local paths:

```text
VERIFICATION_ARCHITECTURE_INDEX = {PROJECT_ROOT}/.crabshell/verification/architecture/index.html
VERIFICATION_PROBE             = {PROJECT_ROOT}/.crabshell/verification/check-pipeline-wiring.js
VERIFICATION_CANDIDATE         = {PROJECT_ROOT}/.crabshell/verification/wiring-contract.candidate.json
VERIFICATION_CONTRACT          = {PROJECT_ROOT}/.crabshell/verification/wiring-contract.json
```

#### (i) Architecture map (optional, documentation only)

If a skill named `arch-explorer:build` appears in the available skills, invoke it with the whole repository as scope and `VERIFICATION_ARCHITECTURE_INDEX` as output path. Its README goes next to the HTML file. Record exactly one state in the verification record:

- `generated` — the skill was invoked and `VERIFICATION_ARCHITECTURE_INDEX` exists
- `unavailable` — the skill is not installed, or the current runtime (such as Codex) has no such skill
- `generation-failed` — the skill was invoked but the HTML file was not produced

The map is a coverage hint for the parent when approving hops, and a document for people. Never parse it, and never let it decide pass/fail. Verification continues in every state.

#### (ii) Connection inventory

A hop is one part starting, loading or signaling another, such as a hook, entry point, plugin or route.

1. Find candidate hops with a deterministic probe, or by hand from the code and the map's edges. Save them as `VERIFICATION_CANDIDATE`.
2. The parent reviews every candidate hop against the source, the user's IA, and the architecture map when available. Remove candidates that are not part of an approved pipeline, or list them under `ignore` and record the reason in the verification record.
3. Save the parent-approved list as `VERIFICATION_CONTRACT`.

Never copy discovery as the contract. A deleted hop also vanishes from discovery; only an approved contract catches a deletion.

Example, a Claude Code plugin (`hooks/hooks.json` exists): copy the bundled probe `${CLAUDE_PLUGIN_ROOT}/skills/verifying/scripts/check-pipeline-wiring.js` to `VERIFICATION_PROBE`; never retype or fork it. Save the stdout of `node .crabshell/verification/check-pipeline-wiring.js discover` as `VERIFICATION_CANDIDATE`. It finds hook commands, agent files and Crabshell trigger tokens. Other projects do not fake a `hooks.json` file.

#### (iii) Manifest entries

Create one `structural` entry per approved hop. Every hop entry calls the same probe for one hop. With the bundled probe it passes `--hop <id>`, expects exit code 0, and asserts `stdoutJsonEquals` at `/passed`. Write an outcome in `ia`, with no version or ticket number:

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

Add one completeness entry that fails when a discovered hop is neither approved nor ignored:

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

These command objects run from the project root: `run-verify.js` resolves `command.file: "node"` to `process.execPath`, uses the project root as the default `cwd`, and passes `PROJECT_ROOT` and `CLAUDE_PROJECT_DIR` to the child process.
