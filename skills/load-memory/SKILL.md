---
name: load-memory
description: Reload memory context from files
---

# Load Memory

Reload memory context into current session.

## Usage

```
/memory-keeper:load-memory
```

## Actions

Run the load-memory script:
```bash
node "scripts/load-memory.js"
```

This will output the current memory state to context:

1. **Hierarchical Memory** (if exists):
   - `project.md` - Project overview
   - `architecture.md` - Architecture decisions
   - `conventions.md` - Coding conventions

2. **L3 Summaries**:
   - JSON summaries of rotated memory archives

3. **Rolling Memory**:
   - Last 50 lines of `memory.md`

## When to Use

- After manually editing memory files
- To refresh context if it seems stale
- To verify what memory is currently loaded

## Notes

- Memory is automatically loaded on session start
- This command reloads without restarting session
