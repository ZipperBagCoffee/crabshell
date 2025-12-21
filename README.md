# Memory Keeper

Automatic session memory for Claude Code. Saves context when you exit, loads when you start.

## Features

- **Auto-save on exit**: Session summary saved automatically via Stop hook
- **Auto-load on start**: Previous context injected via SessionStart hook  
- **Cross-project memory**: Access memories from any project
- **Manual controls**: Commands for save/load/search/clear

## Installation

### From GitHub
```bash
/plugin marketplace add YOUR_USERNAME/memory-keeper
/plugin install memory-keeper
```

### Local Development
```bash
claude --plugin-dir /path/to/memory-keeper-plugin
```

## Commands

| Command | Description |
|---------|-------------|
| `/memory-keeper:save-memory` | Manually save current session |
| `/memory-keeper:load-memory` | Load recent session context |
| `/memory-keeper:search-memory [query]` | Search past sessions |
| `/memory-keeper:clear-memory [all\|old]` | Clean up old sessions |

## Agents

- **memory-keeper**: Compresses and saves session summaries
- **context-loader**: Synthesizes past sessions into briefings

## How It Works

### Session Start
1. `load-memory.sh` runs automatically
2. Finds sessions matching current project name
3. Also loads recent sessions from other projects
4. Outputs to Claude's context

### Session End  
1. Stop hook triggers prompt
2. Claude summarizes the session
3. Saves to `~/.claude/memory-keeper/sessions/[PROJECT]_[TIMESTAMP].md`

## Data Location

All memories stored in: `~/.claude/memory-keeper/sessions/`

File naming: `[ProjectName]_[YYYY-MM-DD_HH-MM].md`

## Configuration

No configuration needed. Works out of the box.

To disable temporarily:
```bash
/plugin disable memory-keeper
```

## License

MIT
