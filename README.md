# Memory Keeper

Automatic session memory for Claude Code with structured fact extraction and tiered archiving.

## Documentation

- [User Manual](docs/USER-MANUAL.md) - Installation, usage, commands
- [Architecture](docs/ARCHITECTURE.md) - System design, data flow, components

## Quick Start

```bash
# Install from GitHub
/plugin marketplace add ZipperBagCoffee/memory-keeper-plugin
/plugin install memory-keeper

# That's it! Memory Keeper works automatically.
```

## Features

- **Auto-save**: Saves memory every 5 tool uses (configurable)
- **Hierarchical Memory** (v7.0.0): Separate project/architecture/conventions files
- **Structured Facts**: Decisions/patterns/issues with types, files, concepts
- **Concept Index**: Fast search by concept tags
- **Privacy Tags**: Exclude sensitive data from facts.json
- **Session Backup**: Raw transcript saved on session end
- **Tiered Archiving**: 30+ day files archived monthly
- **Auto-load**: Previous session context loaded on start
- **Project Isolation**: Each project has its own memory

## How It Works

```
Session Start ──> Load memory.md + facts.json
       │
       ▼
   Tool Use ──> Counter++ ──> At 5: Save trigger
       │                            │
       ▼                            ▼
   Tool Use                  Claude saves:
       │                     1. memory.md
       ▼                     2. session.md (structured)
   Session End               3. extract-facts
       │
       ▼
   Copy transcript + Final save + Compress
```

## Storage

```
.claude/memory/
├── memory.md              # Rolling summary (auto-created)
├── project.md             # Project overview (optional, create with memory-set)
├── architecture.md        # Architecture decisions (optional, create with memory-set)
├── conventions.md         # Coding conventions (optional, create with memory-set)
├── facts.json             # Structured facts + counter + concepts index (auto-created)
└── sessions/
    ├── YYYY-MM-DD_HHMM.md      # Session summary
    ├── YYYY-MM-DD_HHMM.raw.jsonl # Raw transcript (saved on session end)
    └── archive/
        └── YYYY-MM.md          # Monthly archive (created by compress)
```

**Note:** Hierarchical files (`project.md`, `architecture.md`, `conventions.md`) are **optional**. Create them with:
```bash
node scripts/counter.js memory-set project "Your project description"
node scripts/counter.js memory-set architecture "Your architecture notes"
node scripts/counter.js memory-set conventions "Your coding conventions"
```

## Commands

| Command | Description |
|---------|-------------|
| `/memory-keeper:save-memory` | Manual save |
| `/memory-keeper:load-memory` | Load memory |
| `/memory-keeper:search-memory [query]` | Search sessions |
| `/memory-keeper:clear-memory [all\|old]` | Clean up |

## CLI

```bash
# Search
node scripts/counter.js search "query"
node scripts/counter.js search              # Summary

# Hierarchical Memory (v7.0.0)
node scripts/counter.js memory-set project "Project description..."
node scripts/counter.js memory-set architecture "Architecture..."
node scripts/counter.js memory-set conventions "Conventions..."
node scripts/counter.js memory-get project
node scripts/counter.js memory-list

# Add facts
node scripts/counter.js add-decision "what" "why"
node scripts/counter.js add-pattern "pattern"
node scripts/counter.js add-issue "issue" "open"

# Extract from session file
node scripts/counter.js extract-facts 2025-12-21_0300

# Maintenance
node scripts/counter.js compress            # Archive old
node scripts/counter.js clear-facts         # Reset facts
```

## Session File Format

```markdown
# Session 2025-12-21_0300

## Summary
Implemented feature X.

## Decisions
- Use hooks: More reliable
- Skip Redux: Overkill

## Patterns
- Run tests before commit

## Issues
- Build fails: resolved
```

## Configuration

`.claude/memory/config.json`:
```json
{
  "saveInterval": 5
}
```

## Version History

| Version | Changes |
|---------|---------|
| 7.0.1 | clearFacts() bug fix, added missing slash command skills |
| 7.0.0 | Hierarchical memory (project/architecture/conventions.md) |
| 6.5.0 | File references + concept tagging |
| 6.4.0 | Observation types + privacy tags |
| 6.3.0 | Auto-extract facts from structured session files |
| 6.2.0 | Fix command paths, add search/clear-facts |
| 6.1.0 | CLI commands for facts.json |
| 6.0.x | Explicit instruction output, async stdin |
| 5.x | SKILL.md auto-trigger (deprecated) |
| 4.x | Background agent, project-local storage |
| 3.x | Counter-based trigger |

## License

MIT
