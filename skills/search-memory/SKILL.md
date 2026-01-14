---
name: search-memory
description: Search past sessions and memory
---

# Search Memory

Search through session history and memory archives.

## Usage

```
/memory-keeper:search-memory [query]
```

## Actions

```bash
# Search across all memory layers
node "scripts/counter.js" search-memory "query"

# Include L1 raw sessions (slower but thorough)
node "scripts/counter.js" search-memory "query" --deep

# Filter by type
node "scripts/counter.js" search-memory --type=decision
node "scripts/counter.js" search-memory --type=theme
node "scripts/counter.js" search-memory --type=issue
```

## Examples

```bash
# Search all memory layers for "auth"
node scripts/counter.js search-memory "auth"

# Deep search including L1 sessions
node scripts/counter.js search-memory "auth" --deep
```

## Notes

- Searches L1, L2, and L3 memory layers
- Use `--deep` flag for thorough L1 session search
