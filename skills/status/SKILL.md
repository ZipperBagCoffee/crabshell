---
name: status
description: "Runs a healthcheck of the Crabshell plugin state. Reports memory, regressing, verification, counter values, and plugin version with ✓/!/✗ indicators. Invoke with /status."
---

`{PROJECT_DIR}` is the path after `Project root:` in the Project Root Anchor section; without one, use the current working directory.

# Crabshell Status Healthcheck

Read the plugin state files and report health. Use ✓ (healthy), ! (attention) or ✗ (error or missing).

## Step 1: Plugin Version

Read `{PROJECT_DIR}/.claude-plugin/plugin.json`. Report: `✓ Plugin: crabshell v{version}`

If missing: `✗ Plugin: .claude-plugin/plugin.json not found`

## Step 2: Memory Index

Read `{PROJECT_DIR}/.crabshell/memory/memory-index.json`. Report:
- `✓ Memory index: found` or `✗ Memory index: not found`
- `  lastMemoryUpdateTs: {value}` (or `(none)`)
- `  counter: {value}` (hook invocations)
- `  deltaReady: {true|false}`
- `  totalRotations: {stats.totalRotations}`
- `feedbackPressure.level: {value}` — `✓` if 0-1, `!` if 2, `✗` if 3+
- `feedbackPressure.oscillationCount: {value}` — `✓` if 0, `!` if 1-2, `✗` if ≥3
- `tooGoodSkepticism.retryCount: {value}` — `✓` if 0, `!` if 1-2, `✗` if ≥3

## Step 3: Tool Call Counter

Read `{PROJECT_DIR}/.crabshell/memory/counter.json`. Report:
- `✓ Counter: {counter} tool calls` or `! counter.json: not found`

## Step 4: Regressing Session

Read `{PROJECT_DIR}/.crabshell/memory/regressing-state.json`.
- If active: `! Regressing: ACTIVE — {discussion} cycle {cycle}/{totalCycles} phase:{phase}`
- If missing/inactive: `✓ Regressing: no active session`

## Step 5: Active Skill

Read `{PROJECT_DIR}/.crabshell/memory/skill-active.json`.
- If active: `! Skill: {skill} (TTL {ttl}ms)`
- If missing: `✓ No skill active`

## Step 6: Verification State

The runner's records decide which checks the current changes need.
- If `{PROJECT_DIR}/.crabshell/verification/run-verify.js` exists, run `node "{PROJECT_DIR}/.crabshell/verification/run-verify.js" --changed --dry-run` and read its JSON:
  - `selected` empty: `✓ Verification: no check waiting for the current changes`
  - otherwise: `! Verification: {selected.length} checks to rerun — {the distinct values of reasons}`
- If it does not exist: `! Verification: no runner (run /verifying)`
- Last observed check: in `{PROJECT_DIR}/.crabshell/memory/verification-state.json`, the `checkHistory.results` entry with the highest `order` → `  last check: {observation.command} — {observation.outcome}`; nothing recorded → `  last check: none recorded`

## Step 7: Verification Manifest

Read `{PROJECT_DIR}/.crabshell/verification/manifest.json`.
- Found: `✓ Manifest: {entries.length} entries ({projectType})`
- Missing: `! Manifest: not found (run /verifying)`

## Step 8: Directory Structure

Check that these exist under `.crabshell/`: memory/, verification/, discussion/, plan/, ticket/, investigation/

For each: `✓ .crabshell/{dir}/` or `✗ .crabshell/{dir}/ MISSING`

## Summary

Count the ✓, ! and ✗ marks and report:
- All ✓: `Everything healthy.`
- Any !: `{N} item(s) need attention.`
- Any ✗: `{N} error(s) found.`
