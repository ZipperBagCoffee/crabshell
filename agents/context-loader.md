---
name: context-loader
description: Searches facts.json for relevant context (legacy - use CLI search instead)
tools: Read, Glob
model: haiku
---

> **Note**: As of v6.2.0, searching is handled by `counter.js search` command.
> This agent is kept for backward compatibility.

## Current Approach (v6.2.0+)

Use CLI for searching:

```bash
# Search for keyword
node scripts/counter.js search "query"

# View summary
node scripts/counter.js search
```

## Storage Location

Project-local: `.claude/memory/facts.json`

## facts.json Structure

```json
{
  "_meta": {
    "counter": 0,
    "lastSave": "2025-12-21_0300"
  },
  "decisions": [
    {"id": "d001", "date": "2025-12-21", "content": "...", "reason": "..."}
  ],
  "patterns": [
    {"id": "p001", "date": "2025-12-21", "content": "..."}
  ],
  "issues": [
    {"id": "i001", "date": "2025-12-21", "content": "...", "status": "open|resolved"}
  ]
}
```

See [Architecture](../docs/ARCHITECTURE.md) for details.
