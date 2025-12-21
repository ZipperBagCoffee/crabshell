---
description: Clear old session memories (keeps recent ones)
allowed-tools: Bash
---

Clean up old session files from ~/.claude/memory-keeper/sessions/

Options based on $ARGUMENTS:
- "all": Delete ALL session files (ask for confirmation first)
- "old": Keep only last 10 sessions per project (default)
- "project [name]": Delete all sessions for specific project

Show what will be deleted and ask for confirmation before proceeding.
