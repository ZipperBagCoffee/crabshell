# Memory-Keeper Plugin Structure

**Version**: 7.0.1 | **Author**: TaWa | **License**: MIT

## Overview

Memory Keeper is a Claude Code plugin that automatically saves and manages session memory. Supports background agent summarization, structured facts storage, tiered archiving, and hierarchical memory structure (v7.0.0).

## Directory Structure

```
memory-keeper-plugin/
├── .claude/                          # Claude Code local storage
│   ├── settings.local.json           # Local plugin settings
│   └── memory/                       # Project memory storage
│       ├── memory.md                 # Rolling session summary (auto-created)
│       ├── project.md                # Project overview (optional, via memory-set)
│       ├── architecture.md           # Architecture decisions (optional, via memory-set)
│       ├── conventions.md            # Coding conventions (optional, via memory-set)
│       ├── facts.json                # Structured decisions/patterns/issues + counter + concepts index
│       ├── debug-hook.json           # Hook execution debug info
│       └── sessions/                 # Per-session archive (auto-created)
│           ├── 2025-12-21_0233.md    # Session summary file example
│           ├── 2025-12-21_0234.raw.jsonl  # Raw transcript example
│           └── archive/              # Monthly archive (YYYY-MM.md)
│
├── .claude-plugin/                   # Plugin configuration
│   ├── plugin.json                   # Plugin metadata (v7.0.0)
│   └── marketplace.json              # Marketplace registration
│
├── agents/                           # Background agent definitions
│   ├── memory-keeper.md              # Session summarizer (haiku model)
│   └── context-loader.md             # Context search expert
│
├── commands/                         # CLI commands
│   ├── save-memory.md                # Manual save command
│   ├── load-memory.md                # Memory load command
│   ├── search-memory.md              # Session search command
│   └── clear-memory.md               # Cleanup command
│
├── hooks/                            # Lifecycle hooks
│   ├── hooks.json                    # Hook config (SessionStart, PostToolUse, Stop)
│   └── run-hook.cmd                  # Windows hook execution wrapper
│
├── scripts/                          # Core implementation (Node.js)
│   ├── counter.js                    # Main engine (counter, fact management, memory management)
│   ├── load-memory.js                # Load memory on session start
│   ├── save-prompt.js                # Save prompt formatter
│   └── utils.js                      # Shared utilities
│
├── skills/                           # Slash command skills
│   ├── memory-save/SKILL.md          # Auto-trigger memory save (on hook output)
│   ├── save-memory/SKILL.md          # /memory-keeper:save-memory manual save
│   ├── load-memory/SKILL.md          # /memory-keeper:load-memory memory load
│   ├── search-memory/SKILL.md        # /memory-keeper:search-memory search
│   └── clear-memory/SKILL.md         # /memory-keeper:clear-memory cleanup
│
├── docs/                             # Documentation
│   ├── ARCHITECTURE.md               # System architecture
│   ├── USER-MANUAL.md                # User manual
│   ├── CANDIDATES.md                 # Feature candidates
│   └── plans/                        # Version design documents
│       ├── 2024-12-21-memory-keeper-design.md
│       ├── 2024-12-21-memory-keeper-v3-design.md
│       ├── 2024-12-21-memory-keeper-v4-design.md
│       ├── 2024-12-21-memory-keeper-v4-implementation.md
│       ├── 2025-12-21-v6.4.0-design.md
│       ├── 2025-12-21-v6.5.0-design.md
│       └── 2025-12-21-v7.0.0-design.md
│
├── .gitignore                        # Git ignore rules
├── README.md                         # Project documentation
└── STRUCTURE.md                      # This file (project structure)
```

## Core Files

### scripts/counter.js
- Main automation engine
- Manages `facts.json._meta.counter`
- `check`: Increment counter after tool use, output `[MEMORY_KEEPER]` save instruction at threshold
- `final`: Session end handler, copy raw transcript
- `reset`: Reset counter
- `compress`: Archive files older than 30 days to monthly archives
- `memory-set`: Set hierarchical memory file content (v7.0.0+)
- `memory-get`: Read hierarchical memory file (v7.0.0+)
- `memory-list`: List memory files (v7.0.0+)
- `add-decision`: Add decision (type, files, concepts support)
- `add-pattern`: Add pattern (type, files, concepts support)
- `add-issue`: Add issue (type, files, concepts support)
- `search`: Search facts.json (--type, --concept, --file filters)
- `extract-facts`: Auto-extract facts from session file
- `clear-facts`: Clear facts arrays

### scripts/utils.js
- Shared utility functions
- `getProjectDir()`: Return `.claude/memory/` path
- `ensureDir()`: Recursive directory creation
- `readJsonOrDefault()`: Safe JSON reading
- `writeJson()`: JSON saving
- `getTimestamp()`: Timestamp generation

### scripts/load-memory.js
- Runs on session start
- Load hierarchical memory files (project.md, architecture.md, conventions.md)
- Read last N lines of memory.md
- Provide previous context to Claude

### agents/memory-keeper.md
- Uses haiku model
- Outputs JSON after session analysis (summary, decisions, patterns, issues)

### agents/context-loader.md
- Uses haiku model
- facts.json search expert
- Find related decisions/patterns/issues

## Hook Flow

```
1. SessionStart
   └─> load-memory.js runs
       └─> Output hierarchical memory + memory.md + facts summary

2. PostToolUse (after every tool use)
   └─> counter.js check runs
       ├─> Increment facts.json._meta.counter
       ├─> Output [MEMORY_KEEPER] at threshold
       └─> Auto-reset counter after trigger

3. Stop (session end)
   └─> counter.js final runs
       └─> Archive raw transcript + final save instruction
```

## facts.json Schema (v6.5.0+)

```json
{
  "_meta": {
    "counter": 0,
    "lastSave": "2025-12-21_1430"
  },
  "decisions": [
    {
      "id": "d001",
      "type": "architecture",
      "date": "2025-12-21",
      "content": "Use structured markdown",
      "reason": "Easier to parse",
      "files": ["src/parser.ts"],
      "concepts": ["parsing", "architecture"]
    }
  ],
  "patterns": [
    {
      "id": "p001",
      "type": "convention",
      "date": "2025-12-21",
      "content": "Always use heredoc for bash",
      "concepts": ["bash", "workflow"]
    }
  ],
  "issues": [
    {
      "id": "i001",
      "type": "bugfix",
      "date": "2025-12-21",
      "content": "JSON editing fails",
      "status": "resolved",
      "files": ["scripts/counter.js"],
      "concepts": ["json", "cli"]
    }
  ],
  "concepts": {
    "architecture": ["d001"],
    "parsing": ["d001"],
    "bash": ["p001"]
  }
}
```

## Hierarchical Memory Structure (v7.0.0)

**Note:** `project.md`, `architecture.md`, `conventions.md` are **optional**. Create with `memory-set` command.

| File | Purpose | Creation | Auto-updated |
|------|---------|----------|--------------|
| `project.md` | Project overview, goals, tech stack | `memory-set project` | No |
| `architecture.md` | Architecture decisions, diagrams | `memory-set architecture` | No |
| `conventions.md` | Coding style, naming rules | `memory-set conventions` | No |
| `memory.md` | Session summary (rolling) | Auto-created | Yes |

### CLI Commands (v7.0.0)

```bash
# Hierarchical memory management
node counter.js memory-set project "This is a React app..."
node counter.js memory-set architecture "Uses MVC pattern..."
node counter.js memory-set conventions "Use camelCase for..."
node counter.js memory-get project
node counter.js memory-get            # View all memory files
node counter.js memory-list           # List memory files
```

## Session File Format (v6.5.0+)

```markdown
# Session 2025-12-21_0300

## Summary
[Work summary]

## Decisions
- [architecture|technology|approach] Decision content: Reason
  - files: path/to/file1.ts, path/to/file2.ts
  - concepts: concept1, concept2

## Patterns
- [convention|best-practice|anti-pattern] Pattern description
  - concepts: testing, workflow

## Issues
- [bugfix|performance|security|feature] Issue content: open|resolved
  - files: path/to/fixed-file.ts
  - concepts: performance
```

**Privacy Tags:** `<private>sensitive info</private>` excludes from facts.json

## Configuration

`config.json` (optional):
```json
{
  "saveInterval": 5
}
```

Priority:
1. `.claude/memory/config.json` (project)
2. `~/.claude/memory-keeper/config.json` (global)
3. Default: 5

## Key Features

- **Project Isolation**: Independent memory storage per project
- **Hierarchical Memory (v7.0.0)**: Separate project/architecture/conventions storage
- **Auto-save Trigger**: Counter-based (default 5)
- **Structured Facts**: type, files, concepts tagging support (v6.5.0+)
- **Concepts Index**: Fast search by concepts
- **Privacy Tags**: Exclude sensitive info from facts.json (v6.4.0+)
- **Dual Storage**: Summary (memory.md) + raw transcript (jsonl) + structured facts
- **Auto-reset After Trigger**: Counter resets after save instruction output
- **Tiered Archiving**: Auto-archive sessions older than 30 days monthly
- **Windows Compatible**: Node.js solves Windows path issues

## Dependencies

- Node.js v18+ (only built-in fs, path modules)
- Claude Code framework (hooks, agents, commands, skills)
- No external npm packages

## Version History

| Version | Key Changes |
|---------|-------------|
| 7.0.1 | Fix concepts index clearing in clearFacts, complete skills folder |
| 7.0.0 | Hierarchical memory structure (project/architecture/conventions.md) |
| 6.5.0 | File references + concept tagging (files, concepts) |
| 6.4.0 | Observation types (type) + Privacy tags |
| 6.3.0 | Auto-extract facts from structured session files |
| 6.2.0 | Fix command paths, add search/clear-facts |
| 6.1.0 | CLI commands for safe facts.json updates |
| 6.0.1 | Async stdin reading to capture transcript_path |
| 6.0.0 | Explicit instruction output, auto counter reset after trigger |
| 5.0.1 | facts.json._meta.counter based save trigger |
