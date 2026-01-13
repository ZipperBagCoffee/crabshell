---
description: Manually save current session context to memory
allowed-tools: Bash, Read, Write
---

Save current session context to memory.

## Quick Save (Recommended)

Run to trigger auto-save instructions:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/counter.js" check
```

## Manual Save

1. **Append to memory.md:**
```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
echo -e "\n## $TIMESTAMP\n[Your summary here]" >> .claude/memory/memory.md
```

2. **Record decisions directly:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/counter.js" add-decision "what was decided" "why" "architecture|technology|approach"
```

3. **Record patterns directly:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/counter.js" add-pattern "pattern description" "convention|best-practice|anti-pattern"
```

4. **Record issues directly:**
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/counter.js" add-issue "issue description" "open|resolved" "bugfix|performance|security|feature"
```

## Optional: File References and Concepts

Add file references and concept tags at the end:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/counter.js" add-decision "Use React hooks" "Better state" "technology" "src/hooks/useAuth.ts" "auth,hooks"
```

## What to Record

- **Decisions**: Architectural choices, technology selections, approach decisions
- **Patterns**: Coding conventions, best practices, anti-patterns to avoid
- **Issues**: Bugs found/fixed, performance issues, security concerns
