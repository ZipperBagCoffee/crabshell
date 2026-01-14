---
name: clear-memory
description: Clean up old memory files
---

# Clear Memory

Clean up old session files.

## Usage

```
/memory-keeper:clear-memory [all|old]
```

## Actions

### Archive old files (recommended):
```bash
node "scripts/counter.js" compress
```

This archives session files older than 30 days into monthly archives:
```
sessions/2025-10-15_0300.md -> sessions/archive/2025-10.md
```

### Clear everything (manual):

**WARNING: Destructive operation**

```bash
# Remove all session files
rm -rf .claude/memory/sessions/*.md
rm -rf .claude/memory/sessions/*.jsonl

# Optionally clear memory.md
rm .claude/memory/memory.md
```

## Recommendations

1. **Regular maintenance**: Run `compress` monthly
2. **Before major changes**: Create backup first

## Notes

- `compress` is non-destructive (archives, doesn't delete)
- Archived files can be manually reviewed in `sessions/archive/`
