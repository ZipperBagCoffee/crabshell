---
name: search-memory
description: Search Crabshell memory and archived session context. Use when the user asks what happened before or asks to find prior decisions.
---

# Search Memory

`{SKILL_DIR}` is the folder holding this `SKILL.md`; `{PROJECT_ROOT}` is the active project root. Run:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" search "query" --project-dir="{PROJECT_ROOT}"
```

For a detailed L1 session search:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" search "query" --deep --project-dir="{PROJECT_ROOT}"
```

Report matches with source names and line numbers when present. With no matches, say the memory search found no matches.
