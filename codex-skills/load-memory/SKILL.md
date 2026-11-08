---
name: load-memory
description: Load Crabshell project memory into the current Codex conversation. Use when the user asks to load memory, resume context, or inspect saved project notes.
---

# Load Memory

`{SKILL_DIR}` is the folder holding this `SKILL.md`; `{PROJECT_ROOT}` is the active project root.
Run the bundled script by its absolute path, with the active project as the target:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" load --project-dir="{PROJECT_ROOT}"
```

Read the output and use it as project context. Do not claim the memory was loaded unless the command produced the relevant memory text or explicitly reported that no memory exists.

Other options:

```bash
node "{SKILL_DIR}/scripts/codex-memory.js" load --tail-lines=120 --project-dir="{PROJECT_ROOT}"
node "{SKILL_DIR}/scripts/codex-memory.js" status --project-dir="{PROJECT_ROOT}"
```
