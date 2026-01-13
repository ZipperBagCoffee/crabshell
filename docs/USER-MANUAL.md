# Memory Keeper User Manual (v12.2)

## Why Use This?

Claude Code **forgets everything when a session ends**. Memory Keeper saves and loads context using a 4-layer hierarchical memory system with **blocking enforcement**.

## Installation

```bash
/plugin marketplace add ZipperBagCoffee/memory-keeper-plugin
/plugin install memory-keeper@memory-keeper-marketplace
```

---

## How It Works

### 4-Layer Hierarchical Memory

| Layer | Content | Algorithm |
|-------|---------|-----------|
| **L1** | Refined transcripts | Auto-removes metadata (95% size reduction) |
| **L2** | Verified facts | ProMem 3-step extraction via haiku |
| **L3** | Concept groups | LiSA semantic assignment |
| **L4** | Permanent rules | Reflection pattern detection |

### Session Lifecycle

1. **Session Start** → Loads memory.md + permanent rules
2. **Every 5 Tool Uses** → Instructions to spawn haiku for L2
3. **Session End** → **BLOCKED** until L2/L3/L4/memory.md all complete

### Blocking Enforcement (v12.2)

When you try to stop a session, the hook checks:

```
✓L2 | ✓L3 | ✗L4 | ✓mem
```

- ✓ = Complete
- ✗ = Missing, must complete before stop allowed

**Follow the STEP instructions shown to complete each missing item.**

---

## Storage Structure

```
[project]/.claude/memory/
├── memory.md           # Session summaries (rolling)
├── facts.json          # Decisions, patterns, issues, L4 permanent
├── concepts.json       # L3 concept groups
├── .l4-done            # L4 completion marker
├── config.json         # Settings (optional)
└── sessions/
    ├── *.l1.jsonl      # L1 refined transcripts
    └── *.l2.json       # L2 verified facts
```

---

## Recording Facts

### Decisions
```bash
node scripts/counter.js add-decision "Use JWT" "Better scalability" technology
```
Types: `architecture`, `technology`, `approach`

### Patterns
```bash
node scripts/counter.js add-pattern "API responses in try-catch" convention
```
Types: `convention`, `best-practice`, `anti-pattern`

### Issues
```bash
node scripts/counter.js add-issue "Login redirect bug" "resolved" bugfix
```
Types: `bugfix`, `performance`, `security`, `feature`

---

## Search

```bash
node scripts/counter.js search                    # Summary
node scripts/counter.js search "auth"             # Keyword
node scripts/counter.js search --type=technology  # By type
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

### Complete L2/L3/L4 Manually

If blocked on session end:

```bash
# L3 - Update concepts
node scripts/counter.js update-concepts sessions/YYYY-MM-DD.l2.json

# L4 - Run reflection
node scripts/counter.js compress
echo done > .claude/memory/.l4-done
```

### Other
```bash
node scripts/counter.js reset        # Reset counter
node scripts/counter.js clear-facts  # Reset facts.json
```

---

## Troubleshooting

### Session Won't End (Blocked)
1. Check status: `✓L2 | ✓L3 | ✗L4 | ✓mem`
2. Complete missing steps shown in STEP instructions
3. Each ✗ must become ✓

### Memory Not Loading
1. Check `.claude/memory/` folder exists
2. Run `/memory-keeper:load-memory`

### tmpclaude Files Appearing
- Known Claude Code bug (#17600)
- Memory Keeper auto-cleans these
