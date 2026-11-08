---
name: search-docs
description: "BM25 full-text search across all D/P/T/I/H/W/K documents in .crabshell/. Returns ranked results by relevance. Use when looking for specific discussions, plans, tickets, or investigations by topic keyword. Invoke with /search-docs <query>."
---

## Paths

- `{NODE_PATH}`: the absolute path in your context's "Node.js Path" section; without one, use `node`.
- `{SCRIPTS_PATH}`: this skill's base directory without `/skills/search-docs`, plus `/scripts/`. The scripts are in the plugin, not the project.
- `{PROJECT_DIR}`: the path after `Project root:` in the Project Root Anchor section; without one, use the current working directory.

# Search Documents

Usage: `/crabshell:search-docs [query]`

```bash
# Search top 5 documents matching query
"{NODE_PATH}" "{SCRIPTS_PATH}/search-docs.js" --query="<user query>" --project-dir="{PROJECT_DIR}"

# Search top N documents
"{NODE_PATH}" "{SCRIPTS_PATH}/search-docs.js" --query="<user query>" --top=10 --project-dir="{PROJECT_DIR}"
```

The search covers discussion/, investigation/, plan/, ticket/, worklog/, knowledge/ and hotfix/ under `.crabshell/`. Only documents with YAML frontmatter are indexed. If `.crabshell/` does not exist, the script exits cleanly with a message.

## After running

1. Read the numbered results list.
2. If the user wants to see a full document, Read the `filePath` shown in its result.
3. If the user wants more detail, offer to read the top 1-3 documents.
