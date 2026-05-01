---
name: claude-to-agents
description: Convert CLAUDE.md instructions into Codex-oriented AGENTS.md guidance. Use when the user wants Claude project rules made available to Codex.
---

# Claude To Agents

Run:

```bash
node scripts/claude-to-agents.js
```

This reads `CLAUDE.md` and writes `AGENTS.md`. It preserves project-specific rules below the Crabshell marker and rewrites obvious Claude-specific terms to Codex-oriented wording. If `AGENTS.md` already exists, the script refuses to overwrite it unless `--force` is provided.

Use a dry run before overwriting if requested:

```bash
node scripts/claude-to-agents.js --dry-run
```

Overwrite an existing target only when that is intentional:

```bash
node scripts/claude-to-agents.js --force
```
