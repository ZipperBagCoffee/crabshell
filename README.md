# Memory Keeper

Automatic session memory for Claude Code. Saves context every N tool uses, loads previous context on session start.

## Features

- **Auto-save**: Saves memory every 5 tool uses (configurable)
- **Auto-load**: Previous session context loaded on start
- **Rolling summary**: Maintains `memory.md` with current project state
- **Project isolation**: Each project has its own memory

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
1. PostToolUse hook increments counter
2. At N tool uses (default: 5), triggers save
3. Claude saves summary using Bash

### Session End
1. Stop hook triggers final save
2. Complete session summary saved

## Storage Structure

```
~/.claude/memory-keeper/
├── config.json                    # Global settings
└── projects/
    └── [project-name]/
        ├── memory.md              # Rolling summary (loaded at start)
        └── counter.txt            # Current counter value
```

## Configuration

Create `~/.claude/memory-keeper/config.json`:

```json
{
  "saveInterval": 5
}
```

## Commands

| Command | Description |
|---------|-------------|
| `/memory-keeper:save-memory` | Manual save |
| `/memory-keeper:load-memory` | Load memory |
| `/memory-keeper:search-memory [query]` | Search past sessions |
| `/memory-keeper:clear-memory [all\|old]` | Clean up memory |

## Version History

- **v3.0.4**: Use Bash for saves (Windows compatibility fix)
- **v3.0.3**: Convert all text to English
- **v3.0.2**: JSON output format for hooks
- **v3.0.0**: Counter-based trigger system

## License

MIT
