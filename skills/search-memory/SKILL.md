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

# Match with a regular expression
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" search-memory "pattern" --regex --project-dir="{PROJECT_DIR}"

# Tune L1 context window and match limit per source
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" search-memory "query" --deep --context=2 --limit=10 --project-dir="{PROJECT_DIR}"
```

The search covers `logbook.md` and the L2/L3 memory layers. Add `--deep` to include L1 sessions, `--regex` for regular expression matching, `--context=N` for L1 surrounding entries (default 2), and `--limit=N` to cap matches per source (default 20).
