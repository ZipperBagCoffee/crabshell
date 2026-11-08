---
name: claude-to-agents
description: Convert CLAUDE.md instructions into Codex-oriented AGENTS.md guidance. Use when the user wants Claude project rules made available to Codex.
---

# Claude To Agents

`{SKILL_DIR}` is the folder holding this `SKILL.md`; `{PROJECT_ROOT}` is the active project root. Run the bundled script by its absolute path:

```bash
node "{SKILL_DIR}/scripts/claude-to-agents.js" --project-dir="{PROJECT_ROOT}"
```

It reads `CLAUDE.md` and writes `AGENTS.md`. It keeps the project-specific rules below the Crabshell marker and rewrites obvious Claude-specific terms for Codex.
It refuses to overwrite an existing `AGENTS.md` unless `--force` is given.

Use a dry run before overwriting if requested:

```bash
node "{SKILL_DIR}/scripts/claude-to-agents.js" --project-dir="{PROJECT_ROOT}" --dry-run
```

Overwrite an existing target only on purpose:

```bash
node "{SKILL_DIR}/scripts/claude-to-agents.js" --project-dir="{PROJECT_ROOT}" --force
```
