---
name: lint
description: "Runs Obsidian lint checks on .crabshell/ documents and reports violations. Use when you want to verify document health: missing frontmatter, broken wikilinks, INDEX.md sync issues, orphaned files. Invoke with /lint to run checks, or /lint fix to auto-apply safe fixes."
---

# Lint Skill

## Purpose

Run `scripts/lint-obsidian.js` against the project's `.crabshell/` documents, read the report, and offer to fix violations. This is the primary tool for maintaining document hygiene in the Obsidian integration layer.

## Modes

- **Check mode:** `/lint` — run lint checks, display report, offer fixes
- **Fix mode:** `/lint fix` — run lint with auto-fix for safe violations (missing frontmatter, stale INDEX rows)

---

## Check Mode

When invoked without arguments:

### Step 1: Run lint script

```bash
node scripts/lint-obsidian.js --project-dir="<project root>"
```

If `scripts/lint-obsidian.js` does not exist, report: "lint-obsidian.js not found. This script is implemented in T002. Cannot run lint checks until T002 is complete."

### Step 2: Read the report

The script writes a lint report to `.crabshell/lint-report.md` (or prints to stdout). Read the output.

Parse violation categories:
- **MISSING_FRONTMATTER** — document file lacks YAML frontmatter
- **BROKEN_WIKILINK** — `[[target]]` where target file does not exist in `.crabshell/`
- **INDEX_SYNC** — document exists but has no corresponding INDEX.md row, or vice versa
- **ORPHAN** — document not reachable from any INDEX.md
- **STALE_STATUS** — document status in frontmatter differs from INDEX.md row

### Step 3: Display report as table

```
| Violation | File | Detail |
|-----------|------|--------|
| MISSING_FRONTMATTER | discussion/D001-... | No --- block |
...
Total: N violations (N errors, N warnings)
```

### Step 4: Offer fixes

After displaying the report:

```
Found N violations. Options:
1. /lint fix — auto-fix safe violations (MISSING_FRONTMATTER via migrate-obsidian.js --project-dir=., INDEX_SYNC updates)
2. Show details for a specific violation type
3. Skip — address manually
```

Wait for user selection. Do not auto-fix without explicit user request.

---

## Fix Mode

When invoked with `fix`:

### Step 1: Run migrate-obsidian.js for safe auto-fixes

For MISSING_FRONTMATTER violations:
```bash
node scripts/migrate-obsidian.js --project-dir="<project root>"
```

For BROKEN_WIKILINK and ORPHAN violations: report only, do not auto-delete or auto-create files.

### Step 2: Re-run lint to confirm fixes

```bash
node scripts/lint-obsidian.js --project-dir="<project root>"
```

### Step 3: Report delta

```
Before: N violations
After : M violations
Fixed : N-M
Remaining: M (list types)
```

---

## Rules

1. **Read before reporting.** Always read the actual script output — never invent violation counts.
2. **Safe fixes only.** Auto-fix = frontmatter addition and INDEX sync. Never auto-delete files or rewrite content.
3. **P/O/G required.** Every lint run that claims "no violations" must show tool output as Observation.
4. **Script missing = report, not error.** If lint-obsidian.js is absent, inform the user and stop gracefully.
5. **Document-first rule.** If invoked within a T or P document context, append lint results to that document's verification section before reporting in conversation.
