---
name: memory-save
description: Execute when you see "[MEMORY_KEEPER]" in hook output. Follow the numbered steps exactly to save session memory.
---

# Memory Save Skill (v6.3.0)

This skill activates when `[MEMORY_KEEPER]` appears in conversation.

## Trigger Message

```
═══════════════════════════════════════════════════════════════
[MEMORY_KEEPER] AUTO-SAVE TRIGGERED - N tool uses reached
═══════════════════════════════════════════════════════════════
```

## Required Actions

### Step 1: Save to memory.md
```bash
echo -e "\n## 2025-12-21_0300\n[1-2 sentence summary]" >> ".claude/memory/memory.md"
```

### Step 2: Save session file (EXACT FORMAT)
```bash
cat > ".claude/memory/sessions/2025-12-21_0300.md" << 'ENDSESSION'
# Session 2025-12-21_0300

## Summary
[What was accomplished in 2-3 sentences]

## Decisions
- [Decision 1]: [Reason]
- [Decision 2]: [Reason]

## Patterns
- [Pattern discovered]

## Issues
- [Issue found]: [open/resolved]

ENDSESSION
```

### Step 3: Extract facts
```bash
node "scripts/counter.js" extract-facts 2025-12-21_0300
```

## Session End (Stop Hook)

Additional step:
```bash
node "scripts/counter.js" compress
```

## Format Rules

- `## Decisions` - Each line: `- Content: Reason`
- `## Patterns` - Each line: `- Pattern description`
- `## Issues` - Each line: `- Issue: open` or `- Issue: resolved`

## Critical

- **DO NOT SKIP** any steps
- **USE EXACT FORMAT** for session file (extract-facts parses it)
- Counter resets automatically (no manual reset needed)

## How Extraction Works

```
session.md                    facts.json
─────────────                ────────────
## Decisions                 "decisions": [
- Use CLI: Reliable    ───>    {"content": "Use CLI", "reason": "Reliable"}
                             ]
## Patterns                  "patterns": [
- Test before commit   ───>    {"content": "Test before commit"}
                             ]
## Issues                    "issues": [
- Bug in X: resolved   ───>    {"content": "Bug in X", "status": "resolved"}
                             ]
```

See [Architecture](../../docs/ARCHITECTURE.md) for full details.
