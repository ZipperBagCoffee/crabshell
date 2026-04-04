---
name: status
description: "Runs a healthcheck of the Crabshell plugin state. Reports memory, regressing, verification, counter values, and plugin version with ✓/!/✗ indicators. Invoke with /status."
---

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

# Crabshell Status Healthcheck

Read plugin state files and report health. Use ✓ (healthy), ! (attention), ✗ (error/missing).

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
- feedbackPressure.level: `✓` if 0-1, `!` if 2, `✗` if 3+

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

Read `{PROJECT_DIR}/.crabshell/memory/verification-state.json`.
- CLEAN: `✓ Verification: CLEAN`
- EDITED: `! Verification: EDITED — unverified: {editsSinceTest.join(', ')}`
- BLOCKED or missing: `✗ Verification: {state or 'not found'}`

## Step 7: Verification Manifest

Read `{PROJECT_DIR}/.crabshell/verification/manifest.json`.
- Found: `✓ Manifest: {entries.length} entries ({projectType})`
- Missing: `! Manifest: not found (run /verifying)`

## Step 8: Directory Structure

Check existence of: memory/, verification/, discussion/, plan/, ticket/, investigation/, lessons/

For each: `✓ .crabshell/{dir}/` or `✗ .crabshell/{dir}/ MISSING`

## Summary

Count ✓, !, ✗ symbols and report:
- All ✓: `Everything healthy.`
- Any !: `{N} item(s) need attention.`
- Any ✗: `{N} error(s) found.`
