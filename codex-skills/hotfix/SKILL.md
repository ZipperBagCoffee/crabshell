---
name: hotfix
description: Record a small completed fix in a Crabshell H hotfix document. Use for narrow fixes that do not need a full W or D/P/T workflow.
---

# Hotfix

After applying and verifying a small fix, create the hotfix record:

```bash
node scripts/codex-docs.js hotfix "title" --problem="..." --fix="..." --verification="..."
```

The script creates `.crabshell/hotfix/HNNN-*.md` and appends to `.crabshell/hotfix/INDEX.md`.
