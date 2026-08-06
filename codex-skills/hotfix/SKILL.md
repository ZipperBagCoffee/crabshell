---
name: hotfix
description: Record directly-performed work in a Crabshell H hotfix document. Use for any task done in one pass that does not need a D/P/T workflow.
---

# Hotfix

After applying and verifying a direct fix or small task, create the hotfix record:

```bash
node scripts/codex-docs.js hotfix "title" --problem="..." --fix="..." --verification="..."
```

The script creates `.crabshell/hotfix/HNNN-*.md` and appends to `.crabshell/hotfix/INDEX.md`.
