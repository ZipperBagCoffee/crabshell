---
description: Manually save current session context to memory
allowed-tools: Bash, Read, Write
---

Save a session summary to .claude/memory/sessions/

Run the save commands:
```bash
node scripts/counter.js check
```

Or manually save with timestamp:
```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
echo -e "\n## $TIMESTAMP\n[Your summary here]" >> .claude/memory/memory.md
echo "[Full session summary]" > .claude/memory/sessions/$TIMESTAMP.md
```

Include in summary:
1. **Summary**: 1-2 sentence overview
2. **Changes**: Files modified/created with brief description
3. **Decisions**: Key decisions and rationale (also add to facts.json)
4. **Discoveries**: Patterns, insights, or issues found
5. **Next Steps**: Actionable TODOs

Add facts via CLI:
```bash
node scripts/counter.js add-decision "decision" "reason"
node scripts/counter.js add-pattern "pattern"
node scripts/counter.js add-issue "issue" "open|resolved"
```
