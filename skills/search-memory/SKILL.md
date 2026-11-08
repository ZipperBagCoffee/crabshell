---
name: search-memory
description: "Searches past sessions, memory archives, and session history for keywords, decisions, or context. Use when looking up previous session content, finding historical decisions, or querying memory by topic. Invoke with /search-memory \"keyword\"."
---

## Paths

- `{NODE_PATH}`: the absolute path in your context's "Node.js Path" section; without one, use `node`.
- `{SCRIPTS_PATH}`: this skill's base directory without `/skills/search-memory`, plus `/scripts/`. The scripts are in the plugin, not the project.
- `{PROJECT_DIR}`: the path after `Project root:` in the Project Root Anchor section; without one, use the current working directory.

# Search Memory

Usage: `/crabshell:search-memory [query]`

```bash
# Search across all memory layers
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" search-memory "query" --project-dir="{PROJECT_DIR}"

# Include L1 raw sessions (slower but thorough)
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" search-memory "query" --deep --project-dir="{PROJECT_DIR}"

# Filter by type
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" search-memory --type=decision --project-dir="{PROJECT_DIR}"
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" search-memory --type=theme --project-dir="{PROJECT_DIR}"
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" search-memory --type=issue --project-dir="{PROJECT_DIR}"
```

The search covers the L1, L2 and L3 memory layers. Use `--deep` for a thorough search of L1 sessions.
