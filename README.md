# Memory Keeper

Automatic session memory for Claude Code with background agent summarization, structured facts storage, and tiered archiving.

## Features

- **Auto-save**: Saves memory every 5 tool uses (configurable)
- **Background Agent**: Spawns agent to analyze and summarize session
- **Dual Storage**: Saves both summary and raw conversation
- **Structured Facts**: decisions/patterns/issues stored in facts.json
- **Tiered Archiving**: 30+ day files archived monthly
- **Auto-load**: Previous session context loaded on start
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
3. Claude spawns background agent for summarization
4. Agent returns structured JSON
5. Claude saves to memory.md, facts.json, sessions/*.md, sessions/*.raw.md

### Session End
1. Stop hook triggers final save
2. Background agent creates complete session summary
3. Tier compression runs (archives 30+ day files)

## Storage Structure

```
~/.claude/memory-keeper/
├── config.json                    # Global settings
└── projects/
    └── [project-name]/
        ├── memory.md              # Rolling summary (loaded at start)
        ├── facts.json             # Structured decisions/patterns/issues
        ├── counter.txt            # Current counter value
        └── sessions/
            ├── YYYY-MM-DD_HHMM.md     # Session summary
            ├── YYYY-MM-DD_HHMM.raw.md # Raw conversation backup
            └── archive/
                └── YYYY-MM.md         # Monthly archives
```

## facts.json Structure

```json
{
  "decisions": [
    {"id": "d001", "date": "2024-12-21", "content": "Use hooks for auto-save", "reason": "More reliable than manual"}
  ],
  "patterns": [
    {"id": "p001", "date": "2024-12-21", "content": "JSON output required for hook visibility"}
  ],
  "issues": [
    {"id": "i001", "date": "2024-12-21", "content": "Write tool fails on Windows", "status": "resolved"}
  ]
}
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

- **v4.0.0**: Background agent summarization, original+summary saves, facts.json, tiered storage
- **v3.0.4**: Use Bash for saves (Windows compatibility fix)
- **v3.0.3**: Convert all text to English
- **v3.0.2**: JSON output format for hooks
- **v3.0.0**: Counter-based trigger system

## License

MIT
