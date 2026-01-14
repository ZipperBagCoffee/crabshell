# Memory-Keeper Plugin Structure

**Version**: 13.0.0 | **Author**: TaWa | **License**: MIT

## Overview

Memory Keeper is a Claude Code plugin that automatically saves and manages session memory. Supports token-based rotation, L3 Haiku summaries, structured facts storage, and hierarchical memory structure.

## Directory Structure

```
memory-keeper-plugin/
├── .claude/                          # Claude Code local storage
│   ├── settings.local.json           # Local plugin settings
│   └── memory/                       # Project memory storage
│       ├── memory.md                 # Rolling session summary (auto-rotates)
│       ├── memory_*.md               # Rotated archives (L2)
│       ├── *.summary.json            # L3 summaries (Haiku-generated)
│       ├── index.json                # Rotation tracking
│       ├── project.md                # Project overview (optional)
│       ├── architecture.md           # Architecture decisions (optional)
│       ├── conventions.md            # Coding conventions (optional)
│       ├── facts.json                # Structured decisions/patterns/issues
│       └── sessions/                 # Per-session archive
│           └── *.l1.jsonl            # L1 session transcripts
│
├── .claude-plugin/                   # Plugin configuration
│   ├── plugin.json                   # Plugin metadata
│   └── marketplace.json              # Marketplace registration
│
├── agents/                           # Background agent definitions
│   └── memory-summarizer.md          # L3 summary generator (haiku)
│
├── commands/                         # CLI commands
│   ├── save-memory.md                # Manual save command
│   ├── load-memory.md                # Memory load command
│   ├── search-memory.md              # Session search command
│   └── clear-memory.md               # Cleanup command
│
├── hooks/                            # Lifecycle hooks
│   ├── hooks.json                    # Hook config
│   └── run-hook.cmd                  # Windows hook execution wrapper
│
├── scripts/                          # Core implementation (Node.js)
│   ├── counter.js                    # Main engine
│   ├── load-memory.js                # Load memory on session start
│   ├── constants.js                  # Centralized configuration
│   ├── init.js                       # Project initialization
│   ├── search.js                     # L1/L2/L3 integrated search
│   ├── memory-rotation.js            # Token-based rotation
│   ├── legacy-migration.js           # Large file splitting
│   ├── refine-raw.js                 # raw.jsonl -> l1.jsonl conversion
│   ├── utils.js                      # Shared utilities
│   ├── generate-l2.js                # L2 prompt generation
│   ├── save-l2.js                    # L2 file saving
│   ├── update-concepts.js            # Concept index updates
│   ├── keyword-index.js              # Keyword indexing
│   ├── migrate-facts.js              # Facts migration
│   └── permanent-memory.js           # Permanent memory management
│
├── skills/                           # Slash command skills
│   ├── memory-save/SKILL.md          # Auto-trigger memory save
│   ├── save-memory/SKILL.md          # /memory-keeper:save-memory
│   ├── load-memory/SKILL.md          # /memory-keeper:load-memory
│   ├── search-memory/SKILL.md        # /memory-keeper:search-memory
│   ├── clear-memory/SKILL.md         # /memory-keeper:clear-memory
│   └── memory-rotate/SKILL.md        # Auto-trigger L3 generation
│
├── docs/                             # Documentation
│   ├── ARCHITECTURE.md               # System architecture
│   ├── USER-MANUAL.md                # User manual
│   └── plans/                        # Version design documents
│
├── CLAUDE.md                         # Project notes (Windows workarounds)
├── README.md                         # Project documentation
├── CHANGELOG.md                      # Version history
└── STRUCTURE.md                      # This file
```

## Core Scripts

### scripts/counter.js
Main automation engine with commands:
- `check`: Increment counter, trigger save at threshold, check rotation
- `final`: Session end handler
- `search-memory`: Search L1/L2/L3 layers
- `generate-l3`: Create L3 summary for archive
- `migrate-legacy`: Split oversized memory files
- `memory-set/get/list`: Hierarchical memory management
- `add-decision/pattern/issue`: Fact recording
- `search`: Legacy facts.json search
- `compress`: Archive old files

### scripts/constants.js
Centralized configuration:
- `ROTATION_THRESHOLD_TOKENS`: 23750 (25000 * 0.95)
- `CARRYOVER_TOKENS`: 2375 (2500 * 0.95)
- `MEMORY_DIR`, `SESSIONS_DIR`, `INDEX_FILE`, `MEMORY_FILE`

### scripts/memory-rotation.js
Token-based rotation logic:
- `checkAndRotate()`: Check threshold, archive if needed

### scripts/search.js
Multi-layer search:
- `searchMemory()`: Search across L1/L2/L3

### scripts/load-memory.js
Session start loader:
- Load hierarchical memory files
- Load L3 summaries
- Load rolling memory tail

### scripts/refine-raw.js
L1 generation:
- `refineRaw()`: Convert raw.jsonl to l1.jsonl

## Memory Hierarchy (v13.0.0)

| Layer | File | Description |
|-------|------|-------------|
| L1 | `sessions/*.l1.jsonl` | Raw session transcripts |
| L2 | `memory.md` | Active rolling memory (auto-rotates at 23,750 tokens) |
| L2 | `memory_*.md` | Archived memory files |
| L3 | `*.summary.json` | Haiku-generated JSON summaries |

## Hook Flow

```
1. SessionStart
   └─> load-memory.js
       └─> Load L2 + L3 + facts

2. PostToolUse
   └─> counter.js check
       ├─> Increment counter
       ├─> checkAndRotate()
       └─> Output [MEMORY_KEEPER] at threshold

3. Stop
   └─> counter.js final
       └─> Archive transcript + final save
```

## Version History

| Version | Key Changes |
|---------|-------------|
| 13.0.0 | Token-based memory rotation, L3 Haiku summaries, cleanup unused files |
| 12.3.0 | Clearer hook instructions |
| 8.2.0 | L4 permanent memory |
| 8.0.0 | L1 refined transcripts |
| 7.0.0 | Hierarchical memory structure |
