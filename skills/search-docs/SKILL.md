---
name: search-docs
description: "BM25 full-text search across all D/P/T/I/W documents in .crabshell/. Returns ranked results by relevance. Use when looking for specific discussions, plans, tickets, or investigations by topic keyword. Invoke with /search-docs <query>."
---

## Node.js Path
Use the Node.js absolute path from your context's "Node.js Path" section (injected by the plugin on every prompt).
If not available in context, fall back to `node`.

## Script Path Resolution

**IMPORTANT:** The `scripts/` folder is in the plugin directory, NOT the current project.

From "Base directory for this skill:" above, derive the scripts path:
- Remove `/skills/search-docs` from the end
- Add `/scripts/` to get the scripts directory

Example: if Base directory is `~/.claude/plugins/cache/.../skills/search-docs`, then Scripts path is derived by removing `/skills/search-docs` and appending `/scripts/`.

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

# Search Documents

Search all D/P/T/I/W documents using BM25 relevance ranking with field boosts.

## Usage

```
/crabshell:search-docs [query]
```

## Actions

Use full path from above:
```bash
# Search top 5 documents matching query
"{NODE_PATH}" "{SCRIPTS_PATH}/search-docs.js" --query="<user query>" --project-dir="{PROJECT_DIR}"

# Search top N documents
"{NODE_PATH}" "{SCRIPTS_PATH}/search-docs.js" --query="<user query>" --top=10 --project-dir="{PROJECT_DIR}"
```

## After Running

1. Read the numbered results list.
2. If the user wants to see a full document, use the Read tool on the `filePath` shown in the result.
3. Offer to read the top 1-3 documents if the user wants more detail.

## Notes

- Field boosts: title (3x) > tags (2x) > id (1.5x) > body (1x)
- BM25 parameters: k1=1.5, b=0.75
- Searches: discussion/, investigation/, plan/, ticket/, worklog/ under .crabshell/
- Only documents with YAML frontmatter are indexed
- If .crabshell/ does not exist, exits cleanly with a message
