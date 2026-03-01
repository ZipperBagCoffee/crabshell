---
name: save-memory
description: Manually save current session memory to files
---

## Project Root Resolution

**IMPORTANT:** Get the project root from your context's "Project Root Anchor" section.
Look for: `Your ACTUAL project root is: <path>`

Use this value as `{PROJECT_DIR}` in all commands below.
If not available in context, use your current working directory.

# Save Memory

Force immediate save of session memory.

## Usage

```
/memory-keeper:save-memory
```

## Actions

1. **Save to memory.md:**
```bash
printf '\n## %s\n%s\n' "$(date +%Y-%m-%d_%H%M)" "[Summary of current session progress]" >> "{PROJECT_DIR}/.claude/memory/memory.md"
```

2. **Create session file:**
```bash
cat > "{PROJECT_DIR}/.claude/memory/sessions/$(date +%Y-%m-%d_%H%M).md" << 'ENDSESSION'
# Session TIMESTAMP

## Summary
[What has been accomplished so far]

## Decisions
- [type] Decision: Reason
  - files: affected files
  - concepts: relevant concepts

## Patterns
- [type] Pattern observed
  - concepts: tags

## Issues
- [type] Issue: open|resolved
  - files: affected files

ENDSESSION
```

## Notes

- Uses same format as auto-save
- Does NOT reset counter (auto-save will still trigger normally)
- Use when you want to checkpoint progress mid-session
