# Memory Keeper v12

**Claude Code forgets everything when a session ends.** Memory Keeper automatically saves and loads session context using a 4-layer hierarchical memory system.

## Installation

```bash
/plugin marketplace add ZipperBagCoffee/memory-keeper-plugin
/plugin install memory-keeper
```

After installation, **it works automatically**. No configuration needed.

## How It Works

### 4-Layer Hierarchical Memory

| Layer | What | When | Algorithm |
|-------|------|------|-----------|
| **L1** | Refined transcripts | Auto on session end | Removes metadata, keeps essentials |
| **L2** | Verified facts | Auto via haiku subagent | ProMem 3-step extraction |
| **L3** | Concept groups | Auto when L2 saved | LiSA semantic assignment |
| **L4** | Permanent memory | Auto on compress | Reflection pattern detection |

### Session Lifecycle

1. **Start** → Loads `memory.md` + permanent rules
2. **Every 5 tools** → Haiku subagent extracts L2 facts in background
3. **End** → L1 refined, L2/L3 updated, L4 candidates detected

## Storage

```
[project]/.claude/memory/
├── memory.md           # Session summaries
├── facts.json          # Decisions, patterns, issues, L4 permanent
├── concepts.json       # L3 concept groups
├── sessions/
│   ├── *.l1.jsonl      # L1 refined transcripts
│   └── *.l2.json       # L2 verified facts
└── config.json         # Settings (optional)
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/memory-keeper:save-memory` | Manual save (don't wait for auto) |
| `/memory-keeper:load-memory` | Reload memory |
| `/memory-keeper:search-memory <query>` | Search past sessions |
| `/memory-keeper:clear-memory` | Cleanup old files |

## CLI Commands

```bash
# Memory management
node scripts/counter.js memory-set project "description"
node scripts/counter.js memory-set architecture "structure"
node scripts/counter.js memory-set conventions "rules"
node scripts/counter.js memory-get [name]
node scripts/counter.js memory-list

# Facts
node scripts/counter.js add-decision "what" "why" [type]
node scripts/counter.js add-pattern "pattern" [type]
node scripts/counter.js add-issue "issue" "status" [type]
node scripts/counter.js search [query]

# Maintenance
node scripts/counter.js compress    # L4 Reflection + cleanup
node scripts/counter.js reset       # Reset counter
```

## Configuration

`.claude/memory/config.json`:
```json
{
  "saveInterval": 5,
  "keepRaw": false,
  "quietStop": true
}
```

## Research-Based Algorithms

### L2: ProMem (arxiv:2601.04463)
- 3-step: Extract → Verify → Save
- Max 10 facts per session
- 73%+ memory integrity

### L3: LiSA (ACL 2025)
- Semantic concept assignment
- 70% similarity threshold
- No keyword overlap calculation

### L4: Reflection
- Pattern detection (3+ occurrences)
- Utility-based cleanup
- Auto-promotion candidates

## Documentation

- [User Manual](docs/USER-MANUAL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Changelog](CHANGELOG.md)

## License

MIT
