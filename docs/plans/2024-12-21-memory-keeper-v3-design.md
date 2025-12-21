# Memory Keeper v3 Design

## Overview

Counter-based automatic save. Main Claude handles all file operations directly.

## Requirements

| Item | Decision |
|------|----------|
| Save trigger | Every N tool uses (configurable, default: 5) |
| Save method | Main Claude saves directly using Bash |
| Load | Load memory.md on session start |
| Projects | Completely separated per project |

## Flow

```
[PostToolUse hook]
       │
       ▼
[Node.js counter script]
       │
       ├─ Counter < 5 → Do nothing
       │
       └─ Counter >= 5 → Output JSON with additionalContext
                              │
                              ▼
                     [Main Claude sees message]
                              │
                              ▼
                     [Claude saves memory using Bash]
                              │
                              ▼
                     [Claude resets counter]
```

## File Structure

```
scripts/
├── counter.js      # Counter management (increment, check, reset)
├── load-memory.js  # Load memory on session start
└── utils.js        # Common utilities

hooks/
└── hooks.json      # Hook configuration
```

## Storage Structure

```
~/.claude/memory-keeper/
├── config.json                    # Global settings
└── projects/
    └── [project-name]/
        ├── memory.md              # Rolling summary
        ├── counter.txt            # Current counter value
        └── sessions/
            └── YYYY-MM-DD_HHMM.md # Individual sessions
```

## Hooks Configuration

```json
{
  "hooks": {
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
    ],
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
    ],
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
}
```

## Counter Script Behavior

**counter.js check:**
- Increment counter
- If counter >= threshold, output JSON with additionalContext
- Claude sees message and saves memory

**counter.js final:**
- Output final save trigger message
- Reset counter

**counter.js reset:**
- Reset counter to 0

## Config File

```json
{
  "saveInterval": 5,
  "summaryMaxLength": 500
}
```

## Memory Format

```markdown
# Project Memory: [project-name]

## Core Decisions
- [key decisions]

## Current State
- Last updated: [timestamp]
- Status: [current status]

## Recent Context
- [recent work summary]

## Known Issues
- [known issues]
```

## Hook Output Format

PostToolUse hooks must output JSON for Claude to see the message:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "[MEMORY_KEEPER_SAVE] 5 tool uses. Save memory now.\n\nUse Bash to save..."
  }
}
```

## Key Design Decisions

1. **Bash over Write tool**: Write tool has path issues on Windows. Bash echo works reliably.
2. **Counter-based trigger**: Simpler than token-based, more predictable.
3. **JSON output format**: Required for hook output to be visible to Claude.
4. **Direct save by main Claude**: No background agent permission issues.
