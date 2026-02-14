# Memory-Keeper Plugin Structure

**Version**: 13.9.25 | **Author**: TaWa | **License**: MIT

## Overview

Memory Keeper is a Claude Code plugin that automatically saves and manages session memory. Supports token-based rotation, L3 Haiku summaries, hierarchical L1-L2-L3 structure, and integrated search.

## Directory Structure

```
memory-keeper-plugin/
├── .claude/                          # Claude Code local storage
│   ├── settings.local.json           # Local plugin settings
│   └── memory/                       # Project memory storage
│       ├── memory.md                 # Rolling session summary (auto-rotates)
│       ├── memory_*.md               # Rotated archives (L2)
│       ├── *.summary.json            # L3 summaries (Haiku-generated)
│       ├── memory-index.json         # Rotation tracking & counter
│       ├── project.md                # Project overview (optional)
│       ├── architecture.md           # Architecture decisions (optional)
│       ├── conventions.md            # Coding conventions (optional)
│       ├── logs/                     # Refine logs
│       └── sessions/                 # Per-session archive
│           └── *.l1.jsonl            # L1 session transcripts (deduplicated)
│
├── .claude-plugin/                   # Plugin configuration
│   ├── plugin.json                   # Plugin metadata
│   └── marketplace.json              # Marketplace registration
│
├── agents/                           # Background agent definitions
│   ├── memory-summarizer.md          # L3 summary generator (haiku)
│   └── delta-summarizer.md           # Delta content summarizer (haiku)
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
│   ├── inject-rules.js               # UserPromptSubmit rules injection
│   ├── extract-delta.js              # L1 delta extraction
│   ├── constants.js                  # Centralized configuration
│   ├── init.js                       # Project initialization
│   ├── search.js                     # L1/L2/L3 integrated search
│   ├── memory-rotation.js            # Token-based rotation
│   ├── legacy-migration.js           # Large file splitting
│   ├── migrate-timezone.js           # Legacy timestamp migration (local → UTC)
│   ├── refine-raw.js                 # raw.jsonl -> l1.jsonl conversion
│   ├── sync-rules-to-claude.js       # Manual CLAUDE.md sync (standalone)
│   └── utils.js                      # Shared utilities
│
├── skills/                           # Slash command skills
│   ├── memory-save/SKILL.md          # Auto-trigger memory save
│   ├── memory-delta/SKILL.md         # Auto-trigger delta summarization
│   ├── save-memory/SKILL.md          # /memory-keeper:save-memory
│   ├── load-memory/SKILL.md          # /memory-keeper:load-memory
│   ├── search-memory/SKILL.md        # /memory-keeper:search-memory
│   ├── clear-memory/SKILL.md         # /memory-keeper:clear-memory
│   └── memory-rotate/SKILL.md        # Auto-trigger L3 generation
│
├── templates/                        # Auto-init templates (v13.9.20)
│   ├── workflow.md                   # Understanding-First workflow template
│   └── lessons-README.md             # Lessons system README template
│
├── docs/                             # Documentation
│   ├── ARCHITECTURE.md               # System architecture
│   ├── USER-MANUAL.md                # User manual
│   └── plans/                        # Version design documents
│
├── CLAUDE.md                         # Critical rules (auto-managed by plugin)
├── README.md                         # Project documentation
├── CHANGELOG.md                      # Version history
└── STRUCTURE.md                      # This file
```

## Core Scripts

### scripts/counter.js
Main automation engine with commands:
- `check`: Increment counter, trigger save at threshold, check rotation
- `final`: Session end handler, create L1, cleanup duplicates
- `reset`: Reset counter to 0
- `search-memory`: Search L1/L2/L3 layers (--deep for L1)
- `generate-l3`: Create L3 summary for archive
- `migrate-legacy`: Split oversized memory files
- `compress`: Archive old files (30+ days)
- `refine-all`: Process raw.jsonl to L1
- `dedupe-l1`: Remove duplicate L1 files (keep largest per session)
- `memory-set/get/list`: Hierarchical memory management

### scripts/constants.js
Centralized configuration:
- `ROTATION_THRESHOLD_TOKENS`: 23750 (25000 * 0.95)
- `CARRYOVER_TOKENS`: 2375 (2500 * 0.95)
- `MEMORY_DIR`, `SESSIONS_DIR`, `INDEX_FILE`, `MEMORY_FILE`
- `DELTA_TEMP_FILE`, `HAIKU_SAFE_TOKENS`, `FIRST_RUN_MAX_ENTRIES`

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
- `ensureAutoMemoryWarning()`: Write distinction warning to Claude Code's built-in MEMORY.md

### scripts/inject-rules.js
UserPromptSubmit hook:
- Inject critical rules every prompt via `additionalContext`
- Configurable frequency via `rulesInjectionFrequency`
- Auto-sync rules to CLAUDE.md via `syncRulesToClaudeMd()` (marker-based)
- Detect pending delta → inject DELTA_INSTRUCTION
- Detect pending rotation → inject ROTATION_INSTRUCTION

### scripts/extract-delta.js
L1 delta extraction:
- `extractDelta()`: Extract changes since last memory.md update
- `markMemoryUpdated()`: Update timestamp watermark
- `cleanupDeltaTemp()`: Remove temp file after processing

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
       └─> Load memory.md + L3 summaries + project files

2. UserPromptSubmit (every prompt)
   └─> inject-rules.js
       ├─> Inject critical rules via additionalContext
       ├─> Check for pending delta (delta_temp.txt exists)
       │   └─> If yes: Inject DELTA_INSTRUCTION → Claude executes memory-delta skill
       ├─> Check for pending rotation (summaryGenerated: false)
       │   └─> If yes: Inject ROTATION_INSTRUCTION → Claude executes memory-rotate skill
       └─> Output indicator: [rules injected], [rules + delta pending], [rules + rotation pending]

3. PostToolUse
   └─> counter.js check
       ├─> Increment counter
       ├─> checkAndRotate() - archive if > 23,750 tokens
       └─> At threshold (5): extractDelta() → creates delta_temp.txt

4. Stop
   └─> counter.js final
       ├─> Create L1 session transcript
       ├─> Cleanup duplicate L1 files
       └─> extractDelta() for remaining content
```

## Version History

| Version | Key Changes |
|---------|-------------|
| 13.9.25 | Workflow: Orchestrator vs Agent role division |
| 13.9.24 | Counter-based delta gating, interval 25→100 |
| 13.9.23 | UNDERSTANDING-FIRST rule: gap-based verification |
| 13.9.22 | Timestamp double-escaping fix, MEMORY.md auto-warning |
| 13.9.21 | Session restart context recovery rule |
| 13.9.20 | Workflow & lessons system with auto-init templates |
| 13.9.19 | CLAUDE.md marker-based sync (preserves project-specific content) |
| 13.9.18 | Marker-based CLAUDE.md sync (initial implementation) |
| 13.9.16 | Restore CLAUDE.md auto-sync, "Unclear → Ask first", Example 2, new rules |
| 13.9.12 | Understanding-first principle, criticism handling 4-step process |
| 13.9.11 | Delta trigger pattern fix (lastMemoryUpdateTs null) |
| 13.9.10 | Commands path resolution fix, legacy cleanup |
| 13.9.9 | 30-second thinking rule with date command verification |
| 13.9.7 | lastMemoryUpdateTs preservation fix in init.js |
| 13.9.5 | Dual timestamp headers (UTC + local) |
| 13.9.4 | Delta extraction append mode, UTC timestamp headers |
| 13.9.3 | Delta cleanup blocked unless memory.md physically updated |
| 13.9.2 | UTC timestamp unification, migrate-timezone.js, interval 5→25 |
| 13.8.7 | Removed experimental context warning feature |
| 13.8.6 | Proportional delta summarization (1 sentence per ~200 words) |
| 13.8.5 | Stronger delta instruction blocking language |
| 13.8.4 | Script path resolution for all skills |
| 13.8.3 | Added 'don't cut corners' rule |
| 13.8.2 | Fixed memory-index.json field preservation on parse errors |
| 13.8.1 | Windows `echo -e` → `printf` fix |
| 13.8.0 | Auto-trigger L3 after rotation via inject-rules.js |
| 13.7.0 | Path detection fix for plugin cache |
| 13.6.0 | UserPromptSubmit-based delta triggers |
| 13.5.0 | Delta-based auto-save, rules injection via UserPromptSubmit |
| 13.0.0 | Token-based memory rotation, L3 Haiku summaries |
| 12.x | Stop hook blocking, L2/L3/L4 workflow |
| 8.x | L1-L4 hierarchical memory system |
