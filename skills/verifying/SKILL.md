---
name: verifying
description: "Creates project-specific verification tools when they don't exist, or runs existing ones against Intent Anchor items. Use when verification is needed and no project verification tool exists. Invoke with /verifying to create verification manifest, or /verifying run to execute existing tools."
---

# Verification Tool Skill

## Purpose

Bridge the gap between VERIFICATION-FIRST principles and project reality. Most projects lack executable verification tools. This skill analyzes the project's runtime environment and creates a verification manifest — a mapping of IA items to executable commands with expected results.

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

Launch a Work Agent (Task tool) to determine:

1. **Runtime type:** Web app (browser), Node CLI, Python, compiled binary, shell scripts, etc.
2. **Entry points:** Main files, test runners, build commands
3. **Test infrastructure:** Existing test framework (jest, pytest, mocha, etc.), existing test files
4. **Build/run commands:** How to build, how to run, how to test

Work Agent appends results as:
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

- **Independence Protocol (MANDATORY):** The Review Agent prompt MUST NOT include Work Agent's Project Analysis results. Provide only: (1) the project directory path, (2) instruction to independently determine runtime type, entry points, test infrastructure, and build/run/test commands. After Review Agent completes, the Orchestrator cross-references RA findings against WA Project Analysis — discrepancies are findings.
- Launch a Review Agent (Task tool, SEPARATE from Work Agent) to verify the analysis independently. Devil's Advocate required.

### Step 4: Create verification manifest

Create `.crabshell/verification/` directory if it doesn't exist.

Create `.crabshell/verification/manifest.json`:
```json
{
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

For each IA item in the current session, create a verification entry:
```json
{
  "id": "V001",
  "ia": "IA-1: {description}",
  "type": "direct|indirect|manual",
  "command": "{executable command}",
  "expected": "{expected output or behavior}",
  "timeout": 30000
}
```

**Type classification:**
| Type | When | Example |
|------|------|---------|
| `direct` | Can run a command and observe output | `node scripts/inject-rules.js`, `npm test` |
| `indirect` | Cannot execute directly; trace paths, read state | Check file content after hook runs |
| `manual` | Requires human interaction (browser, GUI) | "Open browser, click button, observe result" |

### Step 6: Create verification runner script

Create `.crabshell/verification/run-verify.js`:

```javascript
// Auto-generated verification runner
// Run: node .crabshell/verification/run-verify.js [entry-id]
// Run all: node .crabshell/verification/run-verify.js

const manifest = require('./manifest.json');
const { execSync } = require('child_process');
const path = require('path');
const { classify, shouldWarn } = require('./verify-classify');

const projectRoot = process.env.PROJECT_ROOT || path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const parsed = {
    targetId: null,
    flat: process.env.CRABSHELL_VERIFY_FLAT === '1',
    error: null
  };

  for (const arg of argv) {
    if (arg === '--flat' || arg === '-f') {
      parsed.flat = true;
    } else if (arg.startsWith('-')) {
      parsed.error = `Unknown flag: ${arg}`;
      break;
    } else if (!parsed.targetId) {
      parsed.targetId = arg;
    } else {
      parsed.error = `Unexpected extra argument: ${arg}`;
      break;
    }
  }

  return parsed;
}

function runEntry(entry) {
  if (entry.type === 'manual') {
    console.log(`[MANUAL] ${entry.id}: ${entry.ia}`);
    console.log(`  Action: ${entry.command}`);
    console.log(`  Expected: ${entry.expected}`);
    return { id: entry.id, status: 'manual', message: 'Requires human verification', failureClass: null };
  }
  try {
    const output = execSync(entry.command, {
      timeout: entry.timeout || 30000,
      encoding: 'utf8',
      cwd: projectRoot,
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, CRABSHELL_VERIFY_RUNNING: '1' }
    }).trim();
    const pass = output.includes(entry.expected) || entry.expected === 'exit-0';
    const r = { id: entry.id, status: pass ? 'PASS' : 'FAIL', output, expected: entry.expected, failureClass: null };
    if (r.status === 'FAIL') r.failureClass = classify(null, r.output);
    return r;
  } catch (e) {
    const errMsg = e.stderr ? e.stderr.trim() : e.message;
    const r = { id: entry.id, status: 'FAIL', error: errMsg, expected: entry.expected, failureClass: null };
    r.failureClass = classify(r.error, e.stdout || '');
    return r;
  }
}

function selectEntries(targetId) {
  return targetId
    ? manifest.entries.filter(e => e.id === targetId)
    : manifest.entries.filter(e => e.type !== 'manual');
}

function failRunner(id, error, expected) {
  const result = { id, status: 'FAIL', error, expected, failureClass: classify(error, '') };
  console.log(JSON.stringify([result], null, 2));
  console.log('\nVerification Results: PASS: 0 / FAIL: 1 / Total: 1');
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    failRunner('RUNNER_ARGS', args.error, 'valid run-verify arguments');
    return;
  }

  if (process.env.CRABSHELL_VERIFY_RUNNING === '1' && !args.targetId) {
    failRunner(
      'RUNNER_RECURSION',
      'Nested full-manifest verification is blocked. Pass an explicit entry id for nested runner checks.',
      'explicit entry id'
    );
    return;
  }

  const entries = selectEntries(args.targetId);
  const results = entries.map(runEntry);
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;

  // JSON array output MUST come before any other lines (verify-guard regex /\[[\s\S]*\]/ must match)
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nVerification Results: PASS: ${passCount} / FAIL: ${failCount} / Total: ${results.length}`);

  // Category grouping (suppressed in flat mode)
  if (!args.flat) {
    const categories = ['env-incompatible', 'missing-file', 'data-drift', 'assertion-fail', 'unknown'];
    const fails = results.filter(r => r.status === 'FAIL');
    const counts = {};
    for (const cat of categories) counts[cat] = 0;
    for (const f of fails) { if (f.failureClass && counts[f.failureClass] !== undefined) counts[f.failureClass]++; }
    const hasAnyCat = Object.values(counts).some(n => n > 0);
    if (hasAnyCat) {
      console.log('\nFailure Categories:');
      for (const cat of categories) {
        if (counts[cat] > 0) console.log(`  ${cat}: ${counts[cat]}`);
      }
    }
  }

  // Unknown-ratio warning to stderr (AC4)
  const w = shouldWarn(results);
  if (w.warn) console.error(`[VERIFY] WARN: ${w.unknownCount}/${w.failCount} (${w.ratio}%) failures unclassified; classifier rules may need update`);

  process.exit(failCount > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, selectEntries, runEntry };
```

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

| Item | Type | Prediction (from manifest expected) | Observation (from runner output) | Gap |
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
3. Create entry with user input (IA, type, command, expected)
4. Append to manifest entries array
5. Update `updated` timestamp

---

## Rules

1. **EXECUTABLE only.** Every entry must have a runnable command or be explicitly `manual`.
2. **Manifest is source of truth.** All entries live in `manifest.json`.
3. **P/O/G alignment.** Run mode produces P/O/G table rows.
4. **No git commit.** `.crabshell/verification/` is local — do NOT commit.
5. **Timeout safety.** Default 30s. Destructive commands (rm, drop) PROHIBITED.
6. **Idempotent create.** Existing manifest is NOT overwritten.
