---
name: memory-save
description: Execute when you see "[MEMORY_KEEPER]" in hook output. Follow the numbered steps exactly to save session memory.
---

# Memory Save Skill (v6.4.0)

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
- [architecture|technology|approach] Decision content: Reason why
- [architecture] Another decision: Its reason

## Patterns
- [convention|best-practice] Pattern description
- [convention] Another pattern

## Issues
- [bugfix|performance|security] Issue description: open|resolved
- [bugfix] Fixed something: resolved

ENDSESSION
```

**Privacy:** Use `<private>API key here</private>` to exclude sensitive data from facts.json.

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

- `## Decisions` - Each line: `- [type] Content: Reason`
  - Types: architecture, technology, approach, other
- `## Patterns` - Each line: `- [type] Pattern description`
  - Types: convention, best-practice, anti-pattern, other
- `## Issues` - Each line: `- [type] Issue: open|resolved`
  - Types: bugfix, performance, security, feature, other
- **Privacy**: `<private>...</private>` content excluded from facts.json

## Critical

- **DO NOT SKIP** any steps
- **USE EXACT FORMAT** for session file (extract-facts parses it)
- Counter resets automatically (no manual reset needed)

## How Extraction Works

```
session.md                              facts.json
──────────────────                     ────────────
## Decisions                           "decisions": [
- [architecture] Use CLI: Reliable ───>  {"type":"architecture", "content":"Use CLI", "reason":"Reliable"}
                                       ]
## Patterns                            "patterns": [
- [convention] Test before commit  ───>  {"type":"convention", "content":"Test before commit"}
                                       ]
## Issues                              "issues": [
- [bugfix] Bug in X: resolved      ───>  {"type":"bugfix", "content":"Bug in X", "status":"resolved"}
                                       ]

Privacy: - Use key <private>sk-xxx</private> ───> {"content":"Use key [PRIVATE]"}
```

See [Architecture](../../docs/ARCHITECTURE.md) for full details.
