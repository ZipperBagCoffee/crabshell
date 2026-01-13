---
description: Clear old session memories (keeps recent ones)
allowed-tools: Bash
---

Clean up old session files from .claude/memory/sessions/

Options based on $ARGUMENTS:
- "all": Delete ALL session files (ask for confirmation first)
- "old": Keep only last 10 sessions (default) - run compression
- "facts": Clear facts.json arrays (keep _meta)

For "old" option, run compression:
```bash
node scripts/counter.js compress
```

For "all" option (DESTRUCTIVE):
```bash
rm -rf .claude/memory/sessions/*.md .claude/memory/sessions/*.jsonl
```

For "facts" option:
```bash
node scripts/counter.js clear-facts
```

Show what will be deleted and ask for confirmation before proceeding.
