---
name: search-memory
description: Search Crabshell memory and archived session context. Use when the user asks what happened before or asks to find prior decisions.
---

# Search Memory

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md` and
`{PROJECT_ROOT}` to the active project root, then run:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" search "query" --project-dir="{PROJECT_ROOT}"
```

For detailed L1 session search:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" search "query" --deep --project-dir="{PROJECT_ROOT}"
```

Report matches with source names and line numbers when present. If there are no matches, say that the memory search found no matches.
