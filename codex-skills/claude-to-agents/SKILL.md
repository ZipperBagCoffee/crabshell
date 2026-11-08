---
name: claude-to-agents
description: Convert CLAUDE.md instructions into Codex-oriented AGENTS.md guidance. Use when the user wants Claude project rules made available to Codex.
---

# Claude To Agents

Run:

```bash
node scripts/claude-to-agents.js
```

It reads `CLAUDE.md` and writes `AGENTS.md`. It keeps the project-specific rules below the Crabshell marker and rewrites obvious Claude-specific terms for Codex.
It refuses to overwrite an existing `AGENTS.md` unless `--force` is given.

Use a dry run before overwriting if requested:

```bash
node scripts/claude-to-agents.js --dry-run
```

Overwrite an existing target only on purpose:

```bash
node scripts/claude-to-agents.js --force
```
