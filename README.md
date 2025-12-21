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
1. PostToolUse hook increments counter in facts.json._meta
2. At N tool uses (default: 5), outputs explicit save instructions
3. Claude sees instructions in hook output
4. Claude follows numbered steps: analyze, save memory.md, save session, update facts.json
5. Claude resets counter after saving

### Session End
1. Stop hook copies raw transcript to sessions/
2. Stop hook outputs comprehensive save instructions
3. Claude saves final session summary
4. Compression archives 30+ day files

## Storage Structure

Each project stores memory in its own `.claude/memory/` folder:

```
[project-root]/
└── .claude/
    └── memory/
        ├── config.json            # Project-local settings (optional)
        ├── memory.md              # Rolling summary (loaded at start)
        ├── facts.json             # Structured decisions/patterns/issues + counter in _meta
        └── sessions/
            ├── YYYY-MM-DD_HHMM.md      # Session summary
            ├── YYYY-MM-DD_HHMM.raw.jsonl # Raw transcript (on session end)
            └── archive/
                └── YYYY-MM.md          # Monthly archives
```

## facts.json Structure

```json
{
  "_meta": {
    "counter": 3,
    "lastSave": "2024-12-21_1430"
  },
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

Create `.claude/memory/config.json` in your project (or `~/.claude/memory-keeper/config.json` for global):

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

- **v6.0.1**: Fix stdin reading with async/await for proper transcript_path capture
- **v6.0.0**: Clear instruction output - hooks now output explicit step-by-step commands for Claude to follow
- **v5.0.1**: Counter moved to facts.json._meta, auto-create facts.json, transcript fallback search
- **v5.0.0**: SKILL.md auto-trigger system - Claude automatically executes save when triggered
- **v4.1.0**: Project-local storage (.claude/memory/), raw transcript copy on session end
- **v4.0.0**: Background agent summarization, original+summary saves, facts.json, tiered storage
- **v3.0.4**: Use Bash for saves (Windows compatibility fix)
- **v3.0.3**: Convert all text to English
- **v3.0.2**: JSON output format for hooks
- **v3.0.0**: Counter-based trigger system

## License

MIT
