# Memory Keeper User Manual (v12)

## Why Use This?

Claude Code **forgets everything when a session ends**. Memory Keeper automatically saves and loads context using a 4-layer hierarchical memory system.

## Installation

```bash
/plugin marketplace add ZipperBagCoffee/memory-keeper-plugin
/plugin install memory-keeper
```

**That's it.** It works automatically.

---

## How It Works

### 4-Layer Hierarchical Memory

| Layer | Content | Algorithm |
|-------|---------|-----------|
| **L1** | Refined transcripts | Auto-removes metadata (95% size reduction) |
| **L2** | Verified facts | ProMem 3-step extraction (max 10/session) |
| **L3** | Concept groups | LiSA semantic assignment |
| **L4** | Permanent rules | Reflection pattern detection |

### Session Lifecycle

1. **Session Start** → Loads memory.md + permanent rules from facts.json
2. **Every 5 Tool Uses** → Haiku subagent extracts L2 facts in background
3. **Session End** → L1 refined transcript saved, L2/L3 updated

---

## Storage Structure

```
[project]/.claude/memory/
├── memory.md           # Session summaries (rolling)
├── facts.json          # Decisions, patterns, issues, L4 permanent
├── concepts.json       # L3 concept groups
├── project.md          # Project info (optional, via memory-set)
├── architecture.md     # Architecture (optional)
├── conventions.md      # Coding rules (optional)
├── config.json         # Settings (optional)
└── sessions/
    ├── *.l1.jsonl      # L1 refined transcripts
    └── *.l2.json       # L2 verified facts
```

---

## Setting Project Information

Set info Claude should know at every session start:

```bash
# Project overview
node scripts/counter.js memory-set project "
React + TypeScript web app.
Backend: Node.js + PostgreSQL.
Currently developing user authentication.
"

# Architecture
node scripts/counter.js memory-set architecture "
src/
  components/  - React components
  hooks/       - Custom hooks
  services/    - API calls

API: REST, /api/v1/ prefix
"

# Conventions
node scripts/counter.js memory-set conventions "
- Functional components only
- Tests required before commit
- camelCase variables
"
```

---

## Recording Facts

### Decisions
```bash
node scripts/counter.js add-decision "Use JWT" "Better scalability" technology
node scripts/counter.js add-decision "Add Redis cache" "API speed" technology "src/lib/cache.ts" "caching,performance"
```

Types: `architecture`, `technology`, `approach`

### Patterns
```bash
node scripts/counter.js add-pattern "API responses in try-catch" convention
node scripts/counter.js add-pattern "Never use any type" anti-pattern
```

Types: `convention`, `best-practice`, `anti-pattern`

### Issues
```bash
node scripts/counter.js add-issue "Login redirect bug" "resolved" bugfix
node scripts/counter.js add-issue "Slow payment page" "open" performance
```

Types: `bugfix`, `performance`, `security`, `feature`

---

## Search

```bash
node scripts/counter.js search                    # Summary
node scripts/counter.js search "auth"             # Keyword
node scripts/counter.js search --type=technology  # By type
node scripts/counter.js search --concept=security # By concept
node scripts/counter.js search-keywords "cache"   # L4 keyword index
```

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/memory-keeper:save-memory` | Manual save |
| `/memory-keeper:load-memory` | Reload memory |
| `/memory-keeper:search-memory <query>` | Search |
| `/memory-keeper:clear-memory` | Cleanup old files |

---

## Maintenance

### Compress (L4 Reflection)
```bash
node scripts/counter.js compress
```
- Archives old sessions (30+ days)
- Detects patterns for L4 promotion
- Utility-based cleanup of stale rules

### Other
```bash
node scripts/counter.js reset        # Reset counter
node scripts/counter.js clear-facts  # Reset facts.json
node scripts/counter.js refine-all   # Process raw → L1
```

---

## Configuration

`.claude/memory/config.json`:
```json
{
  "saveInterval": 5,
  "keepRaw": false,
  "quietStop": true
}
```

- `saveInterval`: Tool uses before auto-save (default: 5)
- `keepRaw`: Keep raw.jsonl after L1 conversion (default: false)
- `quietStop`: Minimal output on session end (default: true)

---

## Troubleshooting

### Memory Not Loading
1. Check `.claude/memory/` folder exists
2. Check `memory.md` file exists
3. Run `/memory-keeper:load-memory`

### Auto-save Not Triggering
1. Check `facts.json._meta.counter`
2. Run `node scripts/counter.js reset`

### tmpclaude Files Appearing
- Known Claude Code bug (#17600)
- Memory Keeper auto-cleans these on each hook execution
