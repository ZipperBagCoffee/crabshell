# Memory Keeper Architecture

## Overview

Memory Keeper is a Claude Code plugin that automatically saves session context using hooks, structured fact extraction, and tiered storage.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude Code CLI                          │
├─────────────────────────────────────────────────────────────────┤
│  Hooks                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ SessionStart │  │ PostToolUse  │  │    Stop      │          │
│  │ load-memory  │  │   counter    │  │   counter    │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼─────────────────┼─────────────────┼───────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  scripts/                                                        │
│  ┌────────────────┐  ┌────────────────────────────────────────┐ │
│  │ load-memory.js │  │ counter.js                             │ │
│  │                │  │ - check: increment counter, trigger    │ │
│  │ Reads:         │  │ - final: save transcript, output instr │ │
│  │ - memory.md    │  │ - extract-facts: parse session.md      │ │
│  │ - facts.json   │  │ - add-decision/pattern/issue           │ │
│  │                │  │ - search: query facts.json             │ │
│  │ Outputs to     │  │ - compress: archive old files          │ │
│  │ Claude context │  │ - clear-facts: reset arrays            │ │
│  └────────────────┘  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  .claude/memory/ (Project Storage)                              │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────────────┐│
│  │ memory.md  │  │ facts.json │  │ sessions/                   ││
│  │            │  │            │  │ ├── YYYY-MM-DD_HHMM.md      ││
│  │ Rolling    │  │ _meta:     │  │ ├── YYYY-MM-DD_HHMM.raw.jsonl│
│  │ summary    │  │   counter  │  │ └── archive/                ││
│  │            │  │ decisions  │  │     └── YYYY-MM.md          ││
│  │            │  │ patterns   │  │                             ││
│  │            │  │ issues     │  │                             ││
│  └────────────┘  └────────────┘  └─────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Hook Flow

### 1. SessionStart Hook
```
User starts Claude Code session
        │
        ▼
┌─────────────────┐
│ load-memory.js  │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
memory.md  facts.json
    │         │
    └────┬────┘
         │
         ▼
   Output to Claude
   (additionalContext)
```

### 2. PostToolUse Hook (Counter Check)
```
Claude uses a tool
        │
        ▼
┌─────────────────────┐
│ counter.js check    │
└──────────┬──────────┘
           │
           ▼
    facts.json._meta.counter++
           │
           ▼
    counter >= 5?
    ┌──────┴──────┐
    │ YES         │ NO
    ▼             ▼
Output save     (silent)
instructions
    │
    ▼
Reset counter to 0
```

### 3. Stop Hook (Session End)
```
User ends session (Ctrl+C, /exit, etc.)
        │
        ▼
┌─────────────────────┐
│ counter.js final    │
└──────────┬──────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
Read stdin    Copy transcript
(hookData)    to sessions/
    │             │
    └──────┬──────┘
           │
           ▼
    Output final save
    instructions
```

## Data Flow

### Session File Format
```markdown
# Session 2025-12-21_0300

## Summary
[What was accomplished]

## Decisions
- Decision 1: Reason
- Decision 2: Reason

## Patterns
- Pattern discovered

## Issues
- Issue found: open/resolved
```

### Facts Extraction
```
session.md ──parse──> extractFacts() ──add──> facts.json
     │                     │                      │
     ▼                     ▼                      ▼
## Decisions          regex match           decisions: [
- Foo: Bar     ───>   ("Foo", "Bar")  ───>   {id, date,
                                               content: "Foo",
                                               reason: "Bar"}
                                             ]
```

## Component Details

### counter.js Commands

| Command | Description | Input | Output |
|---------|-------------|-------|--------|
| `check` | Increment counter, trigger at threshold | - | Instructions (if triggered) |
| `final` | Copy transcript, output final instructions | stdin (hookData) | Instructions |
| `reset` | Reset counter to 0 | - | Confirmation |
| `compress` | Archive 30+ day files | - | Archive status |
| `add-decision` | Add decision to facts.json | content, reason | Confirmation |
| `add-pattern` | Add pattern to facts.json | content | Confirmation |
| `add-issue` | Add issue to facts.json | content, status | Confirmation |
| `search` | Search facts.json | query | Matching facts |
| `clear-facts` | Clear facts arrays | - | Confirmation |
| `extract-facts` | Parse session.md for facts | filename | Extraction stats |

### facts.json Structure

```json
{
  "_meta": {
    "counter": 0,
    "lastSave": "2025-12-21_0300"
  },
  "decisions": [
    {
      "id": "d001",
      "date": "2025-12-21",
      "content": "Use structured markdown",
      "reason": "Easier to parse"
    }
  ],
  "patterns": [
    {
      "id": "p001",
      "date": "2025-12-21",
      "content": "Always use heredoc for bash"
    }
  ],
  "issues": [
    {
      "id": "i001",
      "date": "2025-12-21",
      "content": "JSON editing fails",
      "status": "resolved"
    }
  ]
}
```

## Configuration

### config.json (Optional)
```json
{
  "saveInterval": 5
}
```

Location priority:
1. `.claude/memory/config.json` (project)
2. `~/.claude/memory-keeper/config.json` (global)
3. Default: 5

## Version History

| Version | Key Changes |
|---------|-------------|
| 6.3.0 | Auto-extract facts from structured session files |
| 6.2.0 | Fix command paths, add search/clear-facts |
| 6.1.0 | CLI commands for facts.json |
| 6.0.x | Explicit instruction output, async stdin |
| 5.x | SKILL.md auto-trigger (deprecated) |
| 4.x | Background agent, project-local storage |
| 3.x | Counter-based trigger |
