---
name: lint
description: "Runs Obsidian lint checks on .crabshell/ documents and reports violations. Use when you want to verify document health: missing frontmatter, broken wikilinks, INDEX.md sync issues, orphaned files. Invoke with /lint to run checks, or /lint fix to auto-apply safe fixes."
---

## Paths

- `{NODE_PATH}`: the absolute path in your context's "Node.js Path" section; without one, use `node`.
- `{SCRIPTS_PATH}`: this skill's base directory without `/skills/lint`, plus `/scripts/`. The script is in the plugin, not the project.
- `{PROJECT_DIR}`: the path after `Project root:` in the Project Root Anchor section; without one, use the current working directory.

# Lint Skill

Run `{SCRIPTS_PATH}/lint-obsidian.js` on the project's `.crabshell/` documents, read its report, and offer fixes.

- **Check mode:** `/lint` runs the checks, shows the report and offers fixes.
- **Fix mode:** `/lint fix` auto-fixes safe violations: missing frontmatter and stale INDEX rows.

---

## Check Mode

When invoked without arguments:

### Step 1: Run lint script

```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/lint-obsidian.js" --project-dir="{PROJECT_DIR}"
```

If `{SCRIPTS_PATH}/lint-obsidian.js` does not exist, tell the user it is missing and stop. This is a report, not an error.

### Step 2: Read the report

The script writes `.crabshell/lint-report.md` or prints to stdout. Read the output and sort violations into these categories:
- **MISSING_FRONTMATTER** — document file lacks YAML frontmatter
- **BROKEN_WIKILINK** — `[[target]]` where target file does not exist in `.crabshell/`
- **INDEX_SYNC** — document exists but has no corresponding INDEX.md row, or vice versa
- **ORPHAN** — document not reachable from any INDEX.md
- **STALE_STATUS** — document status in frontmatter differs from INDEX.md row

### Step 3: Show the report as a table

```
| Violation | File | Detail |
|-----------|------|--------|
| MISSING_FRONTMATTER | discussion/D001-... | No --- block |
...
Total: N violations (N errors, N warnings)
```

### Step 4: Offer fixes

```
Found N violations. Options:
1. /lint fix — auto-fix safe violations (MISSING_FRONTMATTER via migrate-obsidian.js --project-dir=., INDEX_SYNC updates)
2. Show details for a specific violation type
3. Skip — address manually
```

Wait for the user's choice. Never auto-fix without an explicit user request.

---

## Fix Mode

When invoked with `fix`:

### Step 1: Run migrate-obsidian.js for safe auto-fixes

For MISSING_FRONTMATTER violations:
```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/migrate-obsidian.js" --project-dir="{PROJECT_DIR}"
```

Only report BROKEN_WIKILINK and ORPHAN violations. Never auto-create or auto-delete files for them.

### Step 2: Re-run lint to confirm fixes

```bash
"{NODE_PATH}" "{SCRIPTS_PATH}/lint-obsidian.js" --project-dir="{PROJECT_DIR}"
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

1. Always read the actual script output before reporting. Never invent violation counts.
2. Auto-fix only by adding frontmatter and syncing INDEX rows. Never auto-delete files or rewrite content.
3. Every lint run that claims "no violations" shows the command run and its output line.
4. Inside a T or P document context, append the lint results to that document's verification section before reporting in chat.
