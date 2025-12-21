---
name: memory-keeper
description: Background agent for session analysis (legacy - now handled by extract-facts command)
tools: Read
model: haiku
---

> **Note**: As of v6.3.0, fact extraction is handled by `counter.js extract-facts` command.
> This agent is kept for backward compatibility but is no longer actively used.

## Legacy Usage

This agent was designed to analyze sessions and return structured JSON:

```json
{
  "summary": "200-300 character summary",
  "decisions": [{"content": "...", "reason": "..."}],
  "patterns": [{"content": "..."}],
  "issues": [{"content": "...", "status": "open|resolved"}]
}
```

## Current Approach (v6.3.0+)

Facts are now extracted from structured session files:

1. Claude saves session file with ## Decisions, ## Patterns, ## Issues sections
2. `node counter.js extract-facts` parses the file
3. Facts are added to `.claude/memory/facts.json` automatically

See [Architecture](../docs/ARCHITECTURE.md) for details.
