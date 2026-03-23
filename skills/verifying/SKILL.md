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

Check if `.claude/verification/manifest.json` exists in the project root.

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

Launch a Review Agent (Task tool, SEPARATE from Work Agent) to verify the analysis independently. Devil's Advocate required.

### Step 4: Create verification manifest

Create `.claude/verification/` directory if it doesn't exist.

Create `.claude/verification/manifest.json`:
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

Create `.claude/verification/run-verify.js`:

```javascript
// Auto-generated verification runner
// Run: node .claude/verification/run-verify.js [entry-id]
// Run all: node .claude/verification/run-verify.js

const manifest = require('./manifest.json');
const { execSync } = require('child_process');

function runEntry(entry) {
  if (entry.type === 'manual') {
    console.log(`[MANUAL] ${entry.id}: ${entry.ia}`);
    console.log(`  Action: ${entry.command}`);
    console.log(`  Expected: ${entry.expected}`);
    return { id: entry.id, status: 'manual', message: 'Requires human verification' };
  }
  try {
    const output = execSync(entry.command, {
      timeout: entry.timeout || 30000,
      encoding: 'utf8',
      cwd: process.env.PROJECT_ROOT || process.cwd()
    });
    const pass = output.includes(entry.expected) || entry.expected === 'exit-0';
    return { id: entry.id, status: pass ? 'PASS' : 'FAIL', output: output.trim() };
  } catch (e) {
    return { id: entry.id, status: 'FAIL', error: e.message };
  }
}

const targetId = process.argv[2];
const entries = targetId
  ? manifest.entries.filter(e => e.id === targetId)
  : manifest.entries.filter(e => e.type !== 'manual');

const results = entries.map(runEntry);
console.log(JSON.stringify(results, null, 2));
process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
```

### Step 7: Confirm

Tell user: "Verification manifest created with N entries. Run `/verifying run` to execute."

---

## Run Mode

When invoked with `run`:

### Step 1: Read manifest

Read `.claude/verification/manifest.json`. If not found: "No manifest. Run `/verifying` first."

### Step 2: Execute verification runner

```bash
node .claude/verification/run-verify.js
```

### Step 3: Parse and report as P/O/G

| Item | Prediction (from manifest expected) | Observation (from runner output) | Gap |
|------|-------------------------------------|----------------------------------|-----|

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
4. **No git commit.** `.claude/verification/` is local — do NOT commit.
5. **Timeout safety.** Default 30s. Destructive commands (rm, drop) PROHIBITED.
6. **Idempotent create.** Existing manifest is NOT overwritten.
