---
description: Search through past session memories and facts
allowed-tools: Bash, Read, Glob
---

Search through project memory for: $ARGUMENTS

1. Search facts.json (decisions, patterns, issues):
   ```bash
   node scripts/counter.js search "$ARGUMENTS"
   ```

2. Search session files in .claude/memory/sessions/:
   ```bash
   grep -r -i "$ARGUMENTS" .claude/memory/sessions/*.md 2>/dev/null || echo "No matches in sessions"
   ```

3. Search memory.md:
   ```bash
   grep -i "$ARGUMENTS" .claude/memory/memory.md 2>/dev/null || echo "No matches in memory.md"
   ```

Return matching excerpts with dates and context.

If no arguments provided, show summary of available memories:
- Number of sessions
- Number of facts (decisions/patterns/issues)
- Date range
