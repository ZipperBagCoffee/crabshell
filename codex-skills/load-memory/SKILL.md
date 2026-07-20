---
name: load-memory
description: Load Crabshell project memory into the current Codex conversation. Use when the user asks to load memory, resume context, or inspect saved project notes.
---

# Load Memory

Resolve `{SKILL_DIR}` to the directory containing this `SKILL.md`, resolve
`{PROJECT_ROOT}` to the active project root, then run the bundled script by its
absolute path while keeping the active project as the target:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" load --project-dir="{PROJECT_ROOT}"
```

Read the output and use it as project context. Do not claim the memory was loaded unless the command produced the relevant memory text or explicitly reported that no memory exists.

Useful options:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" load --tail-lines=120 --project-dir="{PROJECT_ROOT}"
node "{SKILL_DIR}/scripts/codex-memory.js" status --project-dir="{PROJECT_ROOT}"
```
