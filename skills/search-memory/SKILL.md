---
name: search-memory
description: Search past sessions and facts
---

# Search Memory

Search through saved facts, session history, and memory archives.

## Usage

```
/memory-keeper:search-memory [query]
```

## Actions

### New: Search L1/L2/L3 layers (v13.0.0)
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

### Legacy: Search facts.json only
```bash
# Keyword search
node "scripts/counter.js" search "query"

# By type
node "scripts/counter.js" search --type=architecture

# By concept
node "scripts/counter.js" search --concept=authentication

# By file
node "scripts/counter.js" search --file=src/auth

# Combined
node "scripts/counter.js" search "react" --type=technology --concept=frontend
```

### Show summary (no query):
```bash
node "scripts/counter.js" search
```

## Examples

```bash
# Search all memory layers for "auth"
node scripts/counter.js search-memory "auth"

# Deep search including L1 sessions
node scripts/counter.js search-memory "auth" --deep

# Find all architecture decisions (legacy)
node scripts/counter.js search --type=architecture

# Find facts about authentication (legacy)
node scripts/counter.js search --concept=authentication
```

## Notes

- `search-memory` (v13.0.0): Searches L1, L2, and L3 layers
- `search` (legacy): Searches only facts.json
- Use `--deep` flag for thorough L1 session search
