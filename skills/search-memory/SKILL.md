---
name: search-memory
description: "Searches past sessions, memory archives, and session history for keywords, decisions, or context. Use when looking up previous session content, finding historical decisions, or querying memory by topic. Invoke with /search-memory \"keyword\"."
---

## Node.js Path
Use the Node.js absolute path from your context's "Node.js Path" section (injected by the plugin on every prompt).
If not available in context, fall back to `node`.

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

From "Base directory for this skill:" above, derive the scripts path:
- Remove `/skills/search-memory` from the end
- Add `/scripts/` to get the scripts directory

Example: if Base directory is `~/.claude/plugins/cache/.../skills/search-memory`, then Scripts path is derived by removing `/skills/search-memory` and appending `/scripts/`.

Use this full path when running node commands below.

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

# Search Memory

Search through session history and memory archives.

## Usage

```
/memory-keeper:search-memory [query]
```

## Actions

Use full path from above:
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

## Examples

```bash
# Search all memory layers for "auth"
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" search-memory "auth" --project-dir="{PROJECT_DIR}"

# Deep search including L1 sessions
"{NODE_PATH}" "{SCRIPTS_PATH}/counter.js" search-memory "auth" --deep --project-dir="{PROJECT_DIR}"
```

## Notes

- Searches L1, L2, and L3 memory layers
- Use `--deep` flag for thorough L1 session search
