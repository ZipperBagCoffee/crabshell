# Memory Keeper Plugin Design

## Overview

Automatic background memory save plugin. Automatically saves context during sessions and loads previous context on session start.

## Requirements

| Item | Decision |
|------|----------|
| Save trigger | Counter-based (every N tool uses, configurable) |
| Save content | Summary only |
| Indexing | Keyword-based search |
| Load | Load memory.md on session start |
| Commands | Automatic + manual backup |
| Projects | Completely separated per project |

## Architecture

### Storage Structure

```
~/.claude/memory-keeper/projects/[project-name]/
├── memory.md           # Rolling summary - loaded on session start
├── counter.txt         # Current counter value
└── sessions/           # Session history
    └── YYYY-MM-DD_HHMM.md  # Individual sessions
```

### Rolling Summary (memory.md)

```markdown
# Project Memory: [project-name]

## Core Decisions (permanently preserved)
- [key decisions]

## Current State (updated each session)
- Last updated: [timestamp]
- Status: [current status]

## Recent Context (last 3 sessions)
- [date]: [summary]

## Known Issues
- [known issues]
```

## Hook Configuration

### PostToolUse - Counter-based auto-save

```json
{
  "PostToolUse": [
    {
      "matcher": ".*",
      "hooks": [
        {
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/counter.js\" check"
        }
      ]
    }
  ]
}
```

### SessionStart - Memory load

```json
{
  "SessionStart": [
    {
      "matcher": "startup",
      "hooks": [
        {
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/load-memory.js\""
        }
      ]
    }
  ]
}
```

### Stop - Final save

```json
{
  "Stop": [
    {
      "matcher": ".*",
      "hooks": [
        {
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/counter.js\" final"
        }
      ]
    }
  ]
}
```

## Data Flow

```
[Session Start]
    │
    └── SessionStart hook
            │
            └── load-memory.js runs
                    │
                    └── memory.md content output → injected into Claude context

[During Session - PostToolUse hook]
    │
    └── counter.js increments counter
            │
            └── If counter >= threshold
                    │
                    └── Output JSON with additionalContext
                            │
                            └── Claude saves memory and resets counter

[Session End - Stop hook]
    │
    └── Final save
            │
            └── Claude saves complete session summary
```

## Commands

| Command | Description |
|---------|-------------|
| `/memory-keeper:save` | Manual save (backup) |
| `/memory-keeper:recall [query]` | Search and load past sessions |
| `/memory-keeper:status` | Check current memory status |
| `/memory-keeper:clear [all\|old]` | Clean up memory |

## Implementation Notes

### Windows Compatibility
- Uses Node.js (instead of bash)
- Cross-platform path handling

### File Operations
- Uses Node.js fs module
- Path: `os.homedir() + '/.claude/memory-keeper/'`

### Error Handling
- Auto-create directories if missing
- Start with empty state on read failure
- Log only on save failure, continue execution
