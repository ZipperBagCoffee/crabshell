# Memory Keeper

Automatic background session memory for Claude Code. Saves context periodically during sessions, loads previous context on start.

## Features

- **Auto-save**: Background agent saves memory when context reaches 50%
- **Auto-load**: Previous session context loaded on start
- **Rolling summary**: Maintains `memory.md` with current project state
- **Knowledge extraction**: Extracts decisions/patterns/issues to searchable JSON
- **Tiered storage**: Recent sessions preserved, old ones compressed

## Installation

### From GitHub
```bash
/plugin marketplace add ZipperBagCoffee/memory-keeper-plugin
/plugin install memory-keeper
```

### Local Development
```bash
claude --plugin-dir /path/to/memory-keeper-plugin
```

## How It Works

### Session Start
1. SessionStart hook runs `load-memory.js`
2. Reads `memory.md` for current project
3. Outputs to Claude's context

### During Session
1. PostToolUse hook checks context usage
2. At ~50%, spawns background agent
3. Agent saves summary without interrupting work

### Session End
1. Stop hook triggers final save
2. Complete session summary saved
3. Tier compression runs (7+ days -> weekly, 30+ days -> archive)

## Storage Structure

```
~/.claude/memory-keeper/projects/[project]/
├── memory.md           # Rolling summary (loaded at start)
├── facts.json          # Searchable facts database
├── sessions/           # Session history
│   ├── YYYY-MM-DD_HHMM.md      # Recent summaries
│   ├── YYYY-MM-DD_HHMM.raw.md  # Recent raw backups
│   ├── week-NN.md              # Weekly summaries
│   └── archive/                # Monthly archives
└── index.json          # Keyword index
```

## Commands

| Command | Description |
|---------|-------------|
| `/memory-keeper:save` | Manual save (backup) |
| `/memory-keeper:recall [query]` | Search and load past context |
| `/memory-keeper:status` | Show memory status |
| `/memory-keeper:clear [all\|old]` | Clean up memory files |

## Configuration

No configuration needed. Works automatically.

To disable temporarily:
```bash
/plugin disable memory-keeper
```

## License

MIT
